import json
import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from settings.settings import settings
from settings.logging_config import configure_logging

logger = logging.getLogger(__name__)


def build_command() -> list[str]:
    if not settings.llm_model:
        raise RuntimeError("Модель не выбрана. Заполните LLM_MODEL в settings/.env.")
    if settings.llm_model_path is None:
        raise RuntimeError("Укажите путь к GGUF-файлу в LLM_MODEL_PATH.")
    binary = shutil.which(settings.llama_server_bin)
    if binary is None:
        raise RuntimeError("llama-server не найден. Установите llama.cpp и проверьте LLAMA_SERVER_BIN.")
    if not settings.llm_model_path.is_file():
        raise RuntimeError(f"Файл модели не найден: {settings.llm_model_path}")
    with settings.llm_model_path.open("rb") as model_file:
        if model_file.read(4) != b"GGUF":
            raise RuntimeError("LLM_MODEL_PATH не указывает на GGUF-файл.")
    source_file = settings.llm_model_path.with_name("source.json")
    if source_file.is_file():
        source = json.loads(source_file.read_text(encoding="utf-8"))["file"]
        if (source["rfilename"] == settings.llm_model_path.name
                and settings.llm_model_path.stat().st_size != source["size"]):
            raise RuntimeError("Файл модели скачан не полностью. Дождитесь окончания загрузки.")

    url = urlsplit(settings.llm_api_base_url)
    if (url.scheme != "http" or not url.hostname or url.username or url.password
            or url.path.rstrip("/") != "/v1" or url.query or url.fragment):
        raise RuntimeError("Для запуска llama.cpp нужен HTTP-адрес, например http://127.0.0.1:18080/v1")

    command = [
        binary, "--model", str(settings.llm_model_path),
        "--alias", settings.llm_model,
        "--host", url.hostname, "--port", str(url.port or 80),
        "--ctx-size", str(settings.llm_context_size),
        "--n-gpu-layers", str(settings.llm_gpu_layers),
        "--parallel", "1", "--jinja",
        "--temp", str(settings.llm_temperature),
        "--top-p", str(settings.llm_top_p),
        "--top-k", str(settings.llm_top_k),
        "--repeat-penalty", str(settings.llm_repeat_penalty),
    ]
    return command


def main() -> int:
    configure_logging()
    try:
        command = build_command()
    except (RuntimeError, OSError, ValueError, KeyError, TypeError) as exc:
        logger.error("Не удалось подготовить запуск модели: %s", exc)
        return 1
    logger.info("Модель: %s; API: %s", settings.llm_model, settings.llm_api_base_url)
    env = os.environ.copy()
    if settings.llm_api_key:
        env["LLAMA_API_KEY"] = settings.llm_api_key
    try:
        return subprocess.run(command, env=env, check=False).returncode
    except OSError as exc:
        logger.error("Не удалось запустить llama-server: %s", exc)
        return 1
    except KeyboardInterrupt:
        logger.info("Запуск остановлен пользователем.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
