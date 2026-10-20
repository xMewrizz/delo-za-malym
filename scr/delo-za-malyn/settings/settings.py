import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

ENV_FILE = Path(__file__).resolve().with_name(".env")


def _read_env(path: Path) -> dict[str, str]:
    values = {}
    if path.exists():
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            key, separator, value = line.partition("=")
            if not separator or not key.strip().isidentifier():
                raise ValueError(f"Неверная запись в {path.name}, строка {number}")
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key.strip()] = value
    return {**values, **os.environ}


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_host: str
    app_port: int
    api_prefix: str
    debug: bool
    log_level: str
    llm_api_base_url: str
    llm_model: str
    http_timeout_seconds: float
    llama_server_bin: str
    llm_model_path: Path | None
    llm_context_size: int
    llm_gpu_layers: int
    llm_temperature: float
    llm_top_p: float
    llm_top_k: int
    llm_repeat_penalty: float
    llm_max_output_tokens: int
    llm_reasoning_effort: str
    app_api_key: str = field(repr=False)
    llm_api_key: str = field(repr=False)

    @classmethod
    def load(cls, env_file: Path = ENV_FILE) -> "Settings":
        env = _read_env(env_file)
        api_url = env["LLM_API_BASE_URL"].strip().rstrip("/")
        parsed_url = urlsplit(api_url)
        if (parsed_url.scheme not in {"http", "https"} or not parsed_url.hostname
                or parsed_url.username or parsed_url.password or parsed_url.query
                or parsed_url.fragment or not parsed_url.path.endswith("/v1")):
            raise ValueError("LLM_API_BASE_URL должен иметь вид http://127.0.0.1:11434/v1")
        try:
            parsed_url.port
        except ValueError:
            raise ValueError("Некорректный порт в LLM_API_BASE_URL") from None
        log_level = env["LOG_LEVEL"].upper()
        if not isinstance(logging.getLevelName(log_level), int):
            raise ValueError("LOG_LEVEL должен быть DEBUG, INFO, WARNING, ERROR или CRITICAL")
        debug = env["DEBUG"].lower()
        if debug not in {"true", "false"}:
            raise ValueError("DEBUG должен быть true или false")
        port = int(env["APP_PORT"])
        timeout = float(env["HTTP_TIMEOUT_SECONDS"])
        raw_model_path = env["LLM_MODEL_PATH"].strip()
        model_path = Path(raw_model_path).expanduser() if raw_model_path else None
        if model_path is not None and not model_path.is_absolute():
            model_path = env_file.resolve().parent.parent / model_path
        context_size = int(env["LLM_CONTEXT_SIZE"])
        gpu_layers = int(env["LLM_GPU_LAYERS"])
        temperature = float(env["LLM_TEMPERATURE"])
        top_p = float(env["LLM_TOP_P"])
        top_k = int(env["LLM_TOP_K"])
        repeat_penalty = float(env["LLM_REPEAT_PENALTY"])
        max_output_tokens = int(env["LLM_MAX_OUTPUT_TOKENS"])
        if not 1 <= port <= 65535:
            raise ValueError("APP_PORT должен быть от 1 до 65535")
        if not 0 < timeout < float("inf"):
            raise ValueError("HTTP_TIMEOUT_SECONDS должен быть конечным положительным числом")
        if context_size <= 0 or gpu_layers < 0 or top_k < 0:
            raise ValueError("Некорректные LLM_CONTEXT_SIZE, LLM_GPU_LAYERS или LLM_TOP_K")
        if not (0 <= temperature < float("inf") and 0 < top_p <= 1
                and 0 < repeat_penalty < float("inf")):
            raise ValueError("Некорректные параметры генерации LLM")
        if max_output_tokens <= 0:
            raise ValueError("LLM_MAX_OUTPUT_TOKENS должен быть положительным")
        return cls(
            app_name=env["APP_NAME"], app_host=env["APP_HOST"], app_port=port,
            api_prefix=env["API_PREFIX"], debug=debug == "true",
            log_level=log_level,
            llm_api_base_url=api_url,
            llm_model=env["LLM_MODEL"].strip(), http_timeout_seconds=timeout,
            app_api_key=env["APP_API_KEY"], llm_api_key=env["LLM_API_KEY"],
            llama_server_bin=env["LLAMA_SERVER_BIN"],
            llm_model_path=model_path.resolve() if model_path is not None else None,
            llm_context_size=context_size,
            llm_gpu_layers=gpu_layers, llm_temperature=temperature,
            llm_top_p=top_p, llm_top_k=top_k, llm_repeat_penalty=repeat_penalty,
            llm_max_output_tokens=max_output_tokens,
            llm_reasoning_effort=env["LLM_REASONING_EFFORT"],
        )


settings = Settings.load()
