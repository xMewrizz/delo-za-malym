"""One command: isolated populated cabinet, optionally a real local keyless LLM."""
import argparse
from datetime import datetime, timezone, timedelta
import os
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--luma", action="store_true", help="Download and run Qwen3-4B locally (about 2.5 GB).")
    parser.add_argument("--project", default="alfa-showcase", help="New name creates a separate data volume; existing data is preserved.")
    parser.add_argument("--port", type=int, default=18007)
    parser.add_argument("--llm-port", type=int, default=11436)
    parser.add_argument("--date", default=datetime.now(timezone(timedelta(hours=3))).date().isoformat())
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", args.project) or not all(1024 <= port <= 65535 for port in (args.port,args.llm_port)):
        parser.error("Use a lowercase Docker project name and a port from 1024 to 65535.")
    root = Path(__file__).resolve().parent.parent
    env = {**os.environ, "DEMO_CHAT_MODE": "model" if args.luma else "demo", "DEMO_PORT": str(args.port), "DEMO_LLM_PORT":str(args.llm_port), "DEMO_DATE": args.date}
    command = ["docker", "compose", "--env-file", os.devnull, "-p", args.project, "-f", str(root / "compose.demo.yaml")]
    def run(*arguments):
        subprocess.run([*command, *arguments], cwd=root, env=env, check=True)
    run("build", "api")
    if args.luma:
        run("--profile", "luma", "up", "-d", "--wait", "ollama")
        run("--profile", "luma", "run", "--rm", "model-init")
        installed = subprocess.check_output([*command,"--profile","luma","exec","-T","ollama","ollama","list"],cwd=root,env=env,text=True)
        if not any(line.split()[:2] == ["qwen3:4b-instruct-2507-q4_K_M", "0edcdef34593"] for line in installed.splitlines()):
            raise RuntimeError("Unexpected local model digest. Check the upstream model; the API was not started.")
    run("up", "-d", "--wait", "api")
    print(f"Demo: http://localhost:{args.port}/cabinet?mode=business")
    print(f"Stop: docker compose -p {args.project} -f compose.demo.yaml down")
    print("Existing cabinet data has not been changed.")


if __name__ == "__main__":
    main()
