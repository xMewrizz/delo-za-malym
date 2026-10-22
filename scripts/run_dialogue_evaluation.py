"""Проверить реальную модель на синтетических диалогах во временной базе."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextvars import ContextVar
from copy import deepcopy
from datetime import datetime
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory, gettempdir
from time import monotonic
from uuid import uuid4

from backend.assistant import ModelAssistant
from backend.main import create_app
from backend.overdraft_chat import PLAN_PATH
from backend.service import ProcessError


ROOT = Path(__file__).resolve().parent.parent
TRACES = ContextVar("dialogue_evaluation_traces", default=None)


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
                      proposal=view["chat"]["messages"][-1].get("proposal"),
                      tools=view["chat"]["messages"][-1].get("tools"))
    except ProcessError as exc:
        preserved = service.process.get(record["application"]["application_id"])["application"] == before
        allowed = case["expect"].get("safe_rejection") and preserved and exc.code == "assistant_invalid_response"
        result.update(issues=[] if allowed else [exc.code], safe_rejection=bool(allowed))
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
    parser.add_argument("--output", type=Path, default=Path(gettempdir()) / "delo-dialogue-evaluation.json")
    args = parser.parse_args()
    spec = json.loads(args.cases.read_text(encoding="utf-8"))
    cases = [case for case in spec["cases"] if not args.selected or case["id"] in args.selected]
    if not cases:
        parser.error("Не найдены выбранные сценарии.")
    model = ModelAssistant()
    model.client.check_ready()
    original_chat = model.client.chat
    def recorded_chat(*call_args, **call_kwargs):
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
    with TemporaryDirectory() as directory:
        app = create_app(Path(directory) / "evaluation.sqlite3", clock=lambda: now, assistant=model)
        service = app.state.chats
        service.store.initialize()
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(evaluate, service, case) for case in cases]
            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                print(f"{'PASS' if result['passed'] else 'FAIL'} {result['id']} {result['seconds']}s {result['issues']}", flush=True)
                report = {"model": model.model, "calculated_at": spec["calculated_at"],
                          "completed": len(results), "total": len(cases), "results": results}
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    passed = sum(result["passed"] for result in results)
    print(f"Passed: {passed}/{len(cases)}")
    return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    raise SystemExit(main())
