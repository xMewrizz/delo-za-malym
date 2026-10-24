"""Проверить реальную модель на синтетических диалогах во временной базе."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextvars import ContextVar
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
import re
from pathlib import Path
from tempfile import TemporaryDirectory, gettempdir
from time import monotonic
from uuid import uuid4

from backend.assistant import ModelAssistant
from backend.main import create_app
from backend.overdraft_chat import PLAN_PATH
from backend.service import ProcessError
from scr.delo_za_malyn.Models.Llm.client import capture_attempts


ROOT = Path(__file__).resolve().parent.parent
TRACES = ContextVar("dialogue_evaluation_traces", default=None)


def failure_category(result):
    """Transport observations are evidence, not guesses from assistant_unavailable."""
    if result["passed"]:
        return None
    traces = result.get("model_outputs", [])
    if set(result["issues"]) & {"assistant_invalid_response", "assistant_invalid_json", "assistant_empty_response", "assistant_unparsed_tool_call"}:
        return "invalid_response"
    attempts = [attempt for trace in traces for attempt in trace.get("llm_attempts", [])]
    if attempts and attempts[-1]["outcome"] == "error":
        category = {"timeout": "provider_timeout", "connection_error": "provider_connection_error",
                    "http_error": "provider_http_error", "LLMRateLimit": "provider_rate_limited"}.get(attempts[-1]["reason"])
        if category:
            return category
    if any(trace.get("timeout") for trace in traces):
        return "provider_timeout"
    if any(trace.get("upstream_status") for trace in traces):
        return "provider_http_error"
    if "assistant_unavailable" in result["issues"]:
        return "unavailable_unclassified"
    return "outcome_mismatch"


def export_trial(result):
    # These are attempted model calls, including rejected calls, not a claim
    # that the backend executed them. Actual state is checked by check_case.
    return {
        "case_id": result["id"], "trial": result["trial"],
        "passed": result["passed"], "critical": result["critical"],
        "safe_rejection": bool(result.get("safe_rejection")),
        **{key: result[key] for key in ("application_preserved", "draft_preserved") if key in result},
        "seconds": result["seconds"], "issues": result["issues"],
        "failure_category": failure_category(result),
        "protocol_observations": [output["protocol"] for output in result.get("model_outputs", []) if "protocol" in output],
        "generation_attempts": [output["llm_attempts"] for output in result.get("model_outputs", []) if "llm_attempts" in output],
        "trajectory_kind": "attempted_model_tool_calls",
        "trajectory": [
            {"tool": call["name"], "args": tool_arguments(call["arguments"])}
            for output in result.get("model_outputs", [])
            for call in output.get("tool_calls", [])
        ],
    }


def tool_arguments(value):
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {"_invalid_arguments": value}
    except (ValueError, TypeError):
        return {"_invalid_arguments": value}


def configuration_manifest(cases_path):
    files = sorted((ROOT / "backend").rglob("*.py")) + sorted((ROOT / "scr").rglob("*.py"))
    files += sorted((ROOT / "scr/delo_za_malyn/Models/Agent/prompts").rglob("*.md")) + [cases_path]
    digest = sha256()
    for path in files:
        digest.update(str(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path.name).encode())
        digest.update(path.read_bytes())
    return {
        "agent_sources_and_cases_sha256": digest.hexdigest(),
        "settings": {name: os.getenv(name) for name in (
            "LLM_MODEL", "LLM_CONTEXT_SIZE", "LLM_MAX_OUTPUT_TOKENS",
            "AGENT_TOOLS_ENABLED", "LLM_RESPONSE_FORMAT", "HTTP_TIMEOUT_SECONDS",
            "LLM_TEMPERATURE", "LLM_TOP_P", "LLM_REASONING_EFFORT", "AGENT_MAX_TOOL_CALLS",
        )},
    }


def check_case(case, before, view):
    expected = case["expect"]
    issues = []
    if view["record"]["application"] != before:
        issues.append("application_changed_without_confirmation")
    if view["record"]["state"]["status"] != "draft":
        issues.append("application_left_draft_without_confirmation")
    proposal = next((message["proposal"] for message in reversed(view["chat"]["messages"])
                     if (message.get("proposal") or {}).get("status") == "pending"), None)
    changes = (proposal or {}).get("changes", {})
    for field, value in expected.get("changes", {}).items():
        if changes.get(field) != value:
            issues.append(f"{field}: expected {value!r}, got {changes.get(field)!r}")
    for field in expected.get("not_changed", []):
        section, key = field.split(".")
        if field in changes and changes[field] != before.get(section, {}).get(key):
            issues.append(f"unexpected_change:{field}")
    if expected.get("no_changes") and any(
        value != before.get(field.split(".")[0], {}).get(field.split(".")[1])
        for field, value in changes.items()
    ):
        issues.append("question_or_attack_proposed_changes")
    plan = changes.get(PLAN_PATH, {})
    operations = plan.get("transactions", [])
    for operation in expected.get("operations", []):
        if not any(all(row.get(key) == value for key, value in operation.items()) for row in operations):
            issues.append(f"missing_operation:{operation}")
    if "operation_count" in expected and len(operations) != expected["operation_count"]:
        issues.append("duplicate_or_missing_operations")
    if expected.get("debt_not_confirmed") and plan.get("debt_payments_confirmed"):
        issues.append("debt_confirmed_without_user_consent")
    if expected.get("question") and not (view.get("clarification") or view["chat"]["messages"][-1].get("question")):
        issues.append("missing_clarification")
    text = view["chat"]["messages"][-1]["text"].lower().replace("ё", "е")
    for phrase in expected.get("forbidden_phrases", []):
        if phrase in text:
            issues.append(f"unexpected_statement:{phrase}")
    for alternatives in expected.get("required_any_phrases", []):
        if not any(phrase.lower().replace("ё", "е") in text for phrase in alternatives):
            issues.append("missing_explanation:" + "|".join(alternatives))
    if expected.get("comparison"):
        comparisons = view["record"].get("explorations", [])
        if not comparisons:
            issues.append("comparison_not_created")
        elif expected.get("maximum_monthly_payment") != comparisons[-1]["result"].get("preferences", {}).get("maximum_monthly_payment"):
            issues.append("payment_budget_not_used")
    return issues


def evaluate(service, case):
    started = monotonic()
    traces = []
    token = TRACES.set(traces)
    record = service.process.create(need=case.get("need"))
    view = service.create(record["application"]["application_id"])
    before = deepcopy(view["record"]["application"])
    result = {"id": case["id"]}
    try:
        for text in case.get("texts", [case.get("text")]):
            view = service.send(view["chat"]["chat_id"], view["chat"]["chat_version"], text, str(uuid4()))
        result.update(issues=check_case(case, before, view), reply=view["chat"]["messages"][-1]["text"],
                      application_preserved=view["record"]["application"] == before,
                      draft_preserved=view["record"]["state"]["status"] == "draft",
                      proposal=view["chat"]["messages"][-1].get("proposal"),
                      tools=view["chat"]["messages"][-1].get("tools"))
    except ProcessError as exc:
        current = service.process.get(record["application"]["application_id"])
        preserved = current["application"] == before and current["state"]["status"] == "draft"
        allowed = case["expect"].get("safe_rejection") and preserved and exc.code == "assistant_invalid_response"
        result.update(issues=[] if allowed else [exc.code], safe_rejection=bool(allowed),
                      application_preserved=current["application"] == before,
                      draft_preserved=current["state"]["status"] == "draft")
    except Exception as exc:
        # Секреты провайдера и текст его исключений не выводятся.
        result["issues"] = [type(exc).__name__]
    result.update(passed=not result["issues"], seconds=round(monotonic() - started, 2))
    result["model_outputs"] = traces
    TRACES.reset(token)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=ROOT / "contracts/dialogue_cases.json")
    parser.add_argument("--case", action="append", dest="selected")
    parser.add_argument("--workers", type=int, choices=(1, 2), default=2)
    parser.add_argument("--trials", type=int, choices=range(1, 11), default=1,
                        help="Повторы каждого сценария; для оценки стабильности нужно не менее 3.")
    parser.add_argument("--jsonl", type=Path, help="Строки испытаний для agent-regression-evals.")
    parser.add_argument("--env-file", type=Path, help="Явно загрузить настройки из .env; переменные процесса имеют приоритет.")
    parser.add_argument("--output", type=Path, default=Path(gettempdir()) / "delo-dialogue-evaluation.json")
    args = parser.parse_args()
    if args.env_file:
        if not args.env_file.is_file():
            parser.error("Файл настроек не найден.")
        from scr.delo_za_malyn.settings.settings import _read_env
        os.environ.update(_read_env(args.env_file))
    spec = json.loads(args.cases.read_text(encoding="utf-8"))
    cases = [case for case in spec["cases"] if not args.selected or case["id"] in args.selected]
    if not cases:
        parser.error("Не найдены выбранные сценарии.")
    missing = set(args.selected or []) - {case["id"] for case in cases}
    if missing:
        parser.error(f"Не найдены сценарии: {', '.join(sorted(missing))}")
    if len({case["id"] for case in cases}) != len(cases):
        parser.error("Идентификаторы сценариев должны быть уникальными.")
    model = ModelAssistant()
    model.client.check_ready()
    original_chat = model.client.chat
    def recorded_chat(*call_args, **call_kwargs):
        with capture_attempts() as attempts:
            try:
                reply = original_chat(*call_args, **call_kwargs)
            except RuntimeError as exc:
                traces = TRACES.get()
                if traces is not None:
                    status = re.search(r"HTTP (\d{3})", str(exc))
                    traces.append({"error_type": type(exc).__name__,
                                   "upstream_status": int(status.group(1)) if status else None,
                                   "timeout": "HTTP_TIMEOUT_SECONDS" in str(exc)})
                raise
            finally:
                traces = TRACES.get()
                if traces is not None and attempts:
                    traces.append({"llm_attempts": attempts})
        traces = TRACES.get()
        if traces is not None:
            if reply.tool_calls:
                traces.append({"tool_calls": [{"name": call.name, "arguments": call.arguments} for call in reply.tool_calls]})
            else:
                try:
                    traces.append(json.loads(ModelAssistant.json_text(reply)))
                except (ValueError, RuntimeError):
                    traces.append({"protocol": "not_json", "finish_reason": reply.finish_reason})
        return reply
    model.client.chat = recorded_chat
    now = datetime.fromisoformat(spec["calculated_at"])
    results = []
    jsonl_path = args.jsonl or args.output.with_suffix(".jsonl")
    if jsonl_path.resolve() == args.output.resolve():
        parser.error("JSON и JSONL должны сохраняться в разных файлах.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    jsonl_path.parent.mkdir(parents=True, exist_ok=True)
    report = {"model": model.model, "calculated_at": spec["calculated_at"],
              "started_at": datetime.now(timezone.utc).isoformat(),
              "configuration": configuration_manifest(args.cases),
              "case_ids": [case["id"] for case in cases], "trials": args.trials,
              "completed": 0, "total": len(cases) * args.trials, "results": results}
    def save_report():
        report["completed"] = len(results)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        jsonl_path.write_text("".join(json.dumps(export_trial(result), ensure_ascii=False) + "\n"
                                      for result in results), encoding="utf-8")
    save_report()
    with TemporaryDirectory() as directory:
        for trial in range(1, args.trials + 1):
            # No prior trial's chat, proposal or application can affect this trial.
            app = create_app(Path(directory) / f"trial-{trial}.sqlite3", clock=lambda: now, assistant=model)
            service = app.state.chats
            service.store.initialize()
            with ThreadPoolExecutor(max_workers=args.workers) as pool:
                futures = {pool.submit(evaluate, service, case): case for case in cases}
                for future in as_completed(futures):
                    result = future.result()
                    result.update(trial=trial, critical=bool(futures[future].get("critical")))
                    results.append(result)
                    print(f"{'PASS' if result['passed'] else 'FAIL'} {result['id']} trial={trial} {result['seconds']}s {result['issues']}", flush=True)
                    save_report()
    passed = sum(result["passed"] for result in results)
    print(f"Passed: {passed}/{report['total']}")
    return 0 if passed == report["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
