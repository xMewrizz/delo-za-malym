"""Run every release gate once, with a fresh integration DB and empty API keys."""
import argparse
from hashlib import sha256
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import monotonic
from urllib.parse import urlsplit
from urllib.request import urlopen


def source_fingerprint(root):
    digest = sha256()
    files = []
    for folder in ("backend", "credit_engine", "contracts", "scripts", "tests", "frontend", "scr"):
        for current, directories, names in os.walk(root/folder):
            directories[:] = sorted(name for name in directories if name not in {"node_modules","dist","__pycache__",".venv","weights"})
            files.extend(Path(current)/name for name in names if not name.startswith(".env") and Path(name).suffix in {".py",".ts",".tsx",".css",".json",".html",".pdf",".svg",".md",".woff2",".webp"})
    files += [root/name for name in ("Dockerfile","compose.demo.yaml","requirements.txt","uv.lock","pyproject.toml")]
    for path in sorted(files):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--local-model-url", help="Loopback Ollama OpenAI API, e.g. http://127.0.0.1:11436/v1")
    args = parser.parse_args()
    if args.local_model_url:
        args.local_model_url = args.local_model_url.rstrip("/")
        parsed = urlsplit(args.local_model_url)
        if parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or parsed.scheme != "http" or parsed.username or parsed.password:
            parser.error("Local acceptance requires a loopback HTTP endpoint without credentials.")
    root = Path(__file__).resolve().parent.parent
    output = args.report.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = output / "result.json"
    if report.exists():
        parser.error("Use a new report directory; old results are never overwritten.")
    summary = {"started_at": datetime.now(timezone.utc).isoformat(), "selective_reruns": False,
               "stages": [], "local_model_acceptance": bool(args.local_model_url),
               "source_sha256":source_fingerprint(root)}
    with TemporaryDirectory() as directory:
        env = {**os.environ, "CHAT_MODE":"demo", "DATABASE_PATH":str(Path(directory)/"default.sqlite3"),
               "LLM_API_KEY":"", "TAVILY_API_KEY":"", "PYTHONIOENCODING":"utf-8"}
        def run(name, command, *, cwd=root, extra=None):
            start = monotonic()
            print(f"START {name}", flush=True)
            with (output / f"{name}.txt").open("w", encoding="utf-8") as stream:
                result = subprocess.run(command, cwd=cwd, env={**env, **(extra or {})}, stdout=stream, stderr=subprocess.STDOUT)
            summary["stages"].append({"name":name,"exit_code":result.returncode,"seconds":round(monotonic()-start,2)})
            report.write_text(json.dumps(summary, indent=2), encoding="utf-8")
            print(f"{'PASS' if result.returncode == 0 else 'FAIL'} {name}", flush=True)
        npm = ["cmd.exe","/d","/c","npm"] if os.name == "nt" else ["npm"]
        run("backend", [sys.executable,"-m","unittest","discover","-s","tests"])
        run("loan-contracts", [sys.executable,"-m","scripts.run_credit_scenarios"])
        run("overdraft-contracts", [sys.executable,"-m","scripts.run_credit_scenarios","--product","overdraft"])
        run("frontend-build", [*npm,"run","build"], cwd=root/"frontend")
        run("frontend-lint", [*npm,"run","lint"], cwd=root/"frontend")
        run("frontend-unit", [*npm,"exec","--","vitest","run","--exclude=src/integration/**","--maxWorkers=4"], cwd=root/"frontend")
        run("integration", [sys.executable,"-m","scripts.run_frontend_checks"])
        if args.local_model_url:
            # Four declared acceptance cases, not a claim about the whole model benchmark.
            # Includes two actual inference cases and two application-owned authority guards.
            run("local-luma", [sys.executable,"-m","scripts.run_dialogue_evaluation",
                "--case","loan_request","--case","change_term_only","--case","bank_fact_injection","--case","approval_injection",
                "--trials","3","--workers","1","--jsonl",str(output/"local-luma.jsonl"),"--output",str(output/"local-luma.json")],
                extra={"CHAT_MODE":"model","LLM_API_BASE_URL":args.local_model_url,
                    "LLM_MODEL":"qwen3:4b-instruct-2507-q4_K_M","LLM_CONTEXT_SIZE":"16384",
                    "LLM_MAX_OUTPUT_TOKENS":"2048","LLM_TEMPERATURE":"0","LLM_TOP_P":"0.9",
                    "LLM_REASONING_EFFORT":"none","HTTP_TIMEOUT_SECONDS":"180",
                    "AGENT_TOOLS_ENABLED":"true","AGENT_MAX_TOOL_CALLS":"3"})
            origin = args.local_model_url.removesuffix("/v1")
            with urlopen(origin + "/api/tags", timeout=10) as response:
                summary["local_models"] = json.load(response)["models"]
        summary["source_unchanged"] = summary["source_sha256"] == source_fingerprint(root)
        summary["passed"] = summary["source_unchanged"] and all(stage["exit_code"] == 0 for stage in summary["stages"])
        summary["finished_at"] = datetime.now(timezone.utc).isoformat()
        report.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
