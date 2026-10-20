"""Клиент локального OpenAI-совместимого API. Только стандартная библиотека."""

import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from settings.settings import Settings, settings


@dataclass(frozen=True)
class Reply:
    text: str
    finish_reason: str


class LLMClient:
    def __init__(self, config: Settings = settings):
        self.config = config

    def list_models(self) -> list[str]:
        data = self._request("/models")
        try:
            models = data["data"]
            if not isinstance(models, list):
                raise ValueError("invalid model list")
            names = [model["id"] for model in models]
            if not all(isinstance(name, str) and name for name in names):
                raise ValueError("invalid model name")
            return names
        except (KeyError, TypeError, ValueError):
            raise RuntimeError("API вернул некорректный список моделей.") from None

    def require_model(self) -> str:
        model = self.config.llm_model.strip()
        if not model:
            raise RuntimeError("Модель не выбрана. Укажите LLM_MODEL в settings/.env.")
        return model

    def check_ready(self) -> None:
        model = self.require_model()
        if model not in self.list_models():
            raise RuntimeError(
                "LLM_MODEL отсутствует в списке моделей сервера. Проверьте имя и установку модели."
            )

    def chat(self, messages: list[dict[str, str]]) -> Reply:
        payload = {
            "model": self.require_model(),
            "messages": messages,
            "stream": False,
            "temperature": self.config.llm_temperature,
            "top_p": self.config.llm_top_p,
            "max_tokens": self.config.llm_max_output_tokens,
        }
        if self.config.llm_reasoning_effort:
            payload["reasoning_effort"] = self.config.llm_reasoning_effort
        data = self._request("/chat/completions", payload)
        try:
            choice = data["choices"][0]
            text = choice["message"].get("content") or ""
            finish_reason = choice.get("finish_reason") or ""
            if not isinstance(text, str) or not text.strip():
                raise ValueError("empty response")
            return Reply(text.strip(), finish_reason)
        except (KeyError, IndexError, TypeError, ValueError, AttributeError):
            raise RuntimeError(
                "API не вернул текст ответа. Проверьте лимит токенов и режим рассуждений."
            ) from None

    def _request(self, endpoint: str, payload: dict | None = None) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.config.llm_api_key:
            headers["Authorization"] = f"Bearer {self.config.llm_api_key}"
        request = Request(
            self.config.llm_api_base_url + endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None,
            headers=headers, method="POST" if payload is not None else "GET",
        )
        try:
            with urlopen(request, timeout=self.config.http_timeout_seconds) as response:
                data = json.load(response)
        except HTTPError as exc:
            descriptions = {
                401: "Проверьте LLM_API_KEY.",
                403: "Сервер запретил доступ к API.",
                404: "Проверьте LLM_API_BASE_URL и имя модели.",
                503: "Сервер модели пока не готов.",
            }
            hint = descriptions.get(exc.code, "Проверьте состояние сервера модели.")
            raise RuntimeError(f"LLM API вернул HTTP {exc.code}. {hint}") from None
        except TimeoutError:
            raise RuntimeError("Истекло HTTP_TIMEOUT_SECONDS при ожидании LLM API.") from None
        except (URLError, ConnectionError):
            raise RuntimeError(
                "LLM API недоступен. Проверьте, что Ollama запущена и LLM_API_BASE_URL указан верно."
            ) from None
        except (ValueError, UnicodeError):
            raise RuntimeError("LLM API вернул некорректный JSON.") from None
        if not isinstance(data, dict):
            raise RuntimeError("LLM API вернул некорректную структуру JSON.")
        return data
