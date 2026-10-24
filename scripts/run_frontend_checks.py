"""Запустить frontend-тесты с настоящим API во временной базе, без внешней модели."""

import os
from pathlib import Path
import shutil
import socket
import subprocess
from tempfile import TemporaryDirectory
import threading
import time

import uvicorn

from backend.assistant import DemoAssistant
from backend.main import create_app


def main():
    root = Path(__file__).resolve().parent.parent
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("Установите Node.js 24+ и npm.")
    # Contract scenarios issue loans. Never let them change the profile used by
    # the React journey running in another worker.
    for suite in ("api.integration.test.ts", "cabinet.integration.test.tsx", "followup.integration.test.tsx"):
        code = run_suite(root, npm, suite)
        if code:
            return code
    return 0


def run_suite(root, npm, suite):
    with TemporaryDirectory() as directory, socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        listener.close()
        app = create_app(Path(directory) / "test.sqlite3", assistant=DemoAssistant())
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
        worker = threading.Thread(target=server.run, daemon=True)
        worker.start()
        try:
            deadline = time.monotonic() + 10
            while not server.started:
                if not worker.is_alive() or time.monotonic() > deadline:
                    raise RuntimeError("Тестовый API не запустился.")
                time.sleep(.05)
            env = {**os.environ, "CABINET_TEST_URL": f"http://127.0.0.1:{port}"}
            command = (["cmd.exe", "/d", "/c", "npm"] if os.name == "nt" else [npm]) + ["exec", "--", "vitest", "run", f"src/integration/{suite}", "--testTimeout=30000"]
            result = subprocess.run(command, cwd=root / "frontend", env=env)
        finally:
            server.should_exit = True
            worker.join(timeout=10)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
