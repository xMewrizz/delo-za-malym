"""Start the saved hackathon cabinet with the same Dahl API configuration."""
import argparse
from getpass import getpass
import os
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default="alfa-hackathon", help="Dedicated Compose project and persistent volume.")
    parser.add_argument("--port", type=int, default=18007)
    parser.add_argument("--env-file", type=Path, help="Defaults to the ignored .env.api file.")
    parser.add_argument("--no-build", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", args.project) or not 1024 <= args.port <= 65535:
        parser.error("Use a lowercase Docker project name and port 1024–65535.")
    root = Path(__file__).resolve().parent.parent
    config = (args.env_file or root / ".env.api").resolve()
    if not config.exists():
        key = getpass("Dahl API key (saved locally in .env.api): ").strip()
        if not key or any(character in key for character in "\r\n'\"$"):
            parser.error("A non-empty API key without quotes, newlines or dollar signs is required.")
        template = (root / ".env.api.example").read_text(encoding="utf-8")
        # Single quotes prevent Compose interpolation; no key appears in CLI arguments.
        with config.open("x", encoding="utf-8") as output:
            output.write(template.replace("LLM_API_KEY=\n", f"LLM_API_KEY='{key}'\n"))
        config.chmod(0o600)
    env = {**os.environ, "DEMO_PORT": str(args.port)}
    # The selected env file is authoritative, even in a developer shell with another LLM configured.
    for key in list(env):
        if key.startswith(("LLM_", "TAVILY_", "DEMO_BUSINESS_")) or key in ("HTTP_TIMEOUT_SECONDS", "CHAT_MAX_CONCURRENT_GENERATIONS"):
            del env[key]
    command = ["docker", "compose", "--env-file", str(config), "-p", args.project]
    for name in ("compose.demo.yaml", "compose.api.yaml", "compose.hackathon.yaml"):
        command.extend(["-f", str(root / name)])
    arguments = ["up", "-d", "--wait", "--no-build" if args.no_build else "--build", "api"]
    subprocess.run([*command, *arguments], cwd=root, env=env, check=True)
    print(f"Cabinet: http://localhost:{args.port}/cabinet?mode=business")
    print("Dahl API mode. The saved snapshot is restored only on the first launch into an empty volume.")


if __name__ == "__main__":
    main()
