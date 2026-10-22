"""Клиент локального OpenAI-совместимого API. Только стандартная библиотека."""

import json
from contextlib import contextmanager
from contextvars import ContextVar
from time import monotonic, sleep
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import logging
from dataclasses import dataclass
from http.client import HTTPException
from typing import TYPE_CHECKING
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

if TYPE_CHECKING:
    from scr.delo_za_malyn.settings.settings import Settings

logger = logging.getLogger(__name__)


class LLMContextLimit(RuntimeError):
    """Safe error: request cannot fit in the configured model context."""


class LLMOutputLimit(RuntimeError):
    """Safe error: the model did not complete its answer within the output budget."""


class LLMProtocolError(RuntimeError):
    """Fixed diagnostics; never expose raw provider text or reasoning."""

    MESSAGES = {
        "empty_response": "Сервер модели ответил, но не вернул текст или вызов инструмента. Проверьте шаблон и парсер Ollama.",
        "unparsed_tool_call": "Модель вернула вызов инструмента текстом; Ollama не разобрала его. Вызов не выполнен.",
        "invalid_response": "Ответ сервера модели не соответствует протоколу API. Изменения не применены.",
        "invalid_json": "Сервер модели вернул некорректный JSON протокола API. Изменения не применены.",
    }

    def __init__(self, reason):
        self.reason = reason
        logger.warning("LLM protocol rejected: reason=%s", reason)
        super().__init__(self.MESSAGES[reason])


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: str

    def as_dict(self) -> dict:
        return {"id": self.id, "type": "function", "function": {
            "name": self.name, "arguments": self.arguments,
        }}


@dataclass(frozen=True)
class Reply:
    text: str
    finish_reason: str
    tool_calls: tuple[ToolCall, ...] = ()

    def as_message(self) -> dict:
        message = {"role": "assistant", "content": self.text}
        if self.tool_calls:
            message["tool_calls"] = [call.as_dict() for call in self.tool_calls]
        return message


_deadline = ContextVar("llm_deadline", default=None)
_attempt_records = ContextVar("llm_attempt_records", default=None)


@contextmanager
def request_budget(seconds):
    parent = _deadline.get()
    deadline = monotonic() + seconds
    token = _deadline.set(min(parent, deadline) if parent is not None else deadline)
    try:
        yield
    finally:
        _deadline.reset(token)


@contextmanager
def capture_attempts():
    """Optional per-call diagnostics, without prompts, provider bodies or keys."""
    records = []
    token = _attempt_records.set(records)
    try:
        yield records
    finally:
        _attempt_records.reset(token)


class LLMTransientError(RuntimeError):
    def __init__(self, reason, *, status=None, retry_after=None):
        self.reason, self.status, self.retry_after = reason, status, retry_after
        messages = {
            "timeout": "Истекло HTTP_TIMEOUT_SECONDS при ожидании LLM API.",
            "connection_error": "LLM API недоступен. Проверьте сервер модели и LLM_API_BASE_URL.",
            "http_error": f"LLM API вернул HTTP {status}. Проверьте состояние сервера модели.",
        }
        super().__init__(messages[reason])


def retry_after_seconds(value):
    if value is None:
        return 0.5
    if value.strip().isdigit():
        return int(value.strip())
    try:
        return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
    except (TypeError, ValueError, OverflowError):
        return 0.5


class LLMRateLimit(RuntimeError):
    pass


class LLMClient:
    def __init__(self, config: "Settings | None" = None):
        if config is None:
            from scr.delo_za_malyn.settings.settings import settings

            config = settings
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

    def chat(
        self, messages: list[dict], *, tools: list[dict] | None = None,
        tool_choice: str = "auto", response_format: dict | None = None,
    ) -> Reply:
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
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice
        if response_format is not None:
            payload["response_format"] = response_format
        context_size = getattr(self.config, "llm_context_size", 4096)
        # Approximation only, not a tokenizer. Reject clearly oversized requests
        # before inference; preserve all history instead of silently dropping facts.
        serialized = json.dumps({key: payload[key] for key in ("messages", "tools", "response_format") if key in payload}, ensure_ascii=False, separators=(",", ":"))
        estimated_input = (len(serialized.encode("utf-8")) + 3) // 4 + 8 * len(messages)
        reserve = self.config.llm_max_output_tokens
        if estimated_input + reserve > context_size:
            logger.info("LLM context preflight rejected: estimated_input=%s reserve=%s context=%s", estimated_input, reserve, context_size)
            raise LLMContextLimit("Диалог не помещается в контекст модели с запасом на ответ. Начните новый диалог; сохранённая заявка останется.")
        return self._complete(payload, context_size)

    def _complete(self, payload, context_size):
        # Only generation is repeated. Tool execution and chat persistence live
        # outside this method and therefore cannot be replayed by this retry.
        with request_budget(self.config.http_timeout_seconds):
            deadline = _deadline.get()
            for attempt in (1, 2):
                started = monotonic()
                remaining = deadline - started
                if remaining <= 0:
                    raise LLMTransientError("timeout")
                try:
                    # Reserve time for one retry, including when the first
                    # attempt times out. Nested budgets never extend the turn.
                    with request_budget(remaining / (3 - attempt)):
                        data = self._request("/chat/completions", payload)
                        reply = self._parse_response(data, context_size)
                except RuntimeError as exc:
                    reason = exc.reason if isinstance(exc, (LLMTransientError, LLMProtocolError)) else type(exc).__name__
                    records = _attempt_records.get()
                    if records is not None:
                        records.append({"attempt": attempt, "outcome": "error", "reason": reason,
                                        "upstream_status": getattr(exc, "status", None),
                                        "seconds": round(monotonic() - started, 3)})
                    retryable = isinstance(exc, LLMTransientError) or (
                        isinstance(exc, LLMProtocolError) and exc.reason == "empty_response")
                    delay = exc.retry_after if isinstance(exc, LLMTransientError) and exc.retry_after is not None else 0.5
                    if not retryable or attempt == 2 or delay > 2 or deadline - monotonic() <= delay:
                        raise
                    logger.warning("LLM request retry: reason=%s attempt=2 max_attempts=2", reason)
                    sleep(delay)
                else:
                    records = _attempt_records.get()
                    if records is not None:
                        records.append({"attempt": attempt, "outcome": "success",
                                        "seconds": round(monotonic() - started, 3)})
                    return reply

    def _parse_response(self, data, context_size):
        try:
            choice = data["choices"][0]
            message = choice["message"]
            text = message.get("content")
            if text is None:
                text = ""
            finish_reason = choice.get("finish_reason") or ""
            raw_calls = message.get("tool_calls") or []
            if not isinstance(raw_calls, list) or not isinstance(text, str):
                raise ValueError("invalid response")
            calls = []
            for raw in raw_calls:
                function = raw["function"]
                call = ToolCall(raw["id"], function["name"], function["arguments"])
                if raw.get("type") != "function" or not all(
                    isinstance(value, str) and value.strip()
                    for value in (call.id, call.name, call.arguments)
                ):
                    raise ValueError("invalid tool call")
                calls.append(call)
            if len({call.id for call in calls}) != len(calls):
                raise ValueError("duplicate tool call id")
            if finish_reason == "length":
                usage = data.get("usage") or {}
                prompt_tokens, completion_tokens = usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)
                logger.info("LLM response truncated: prompt_tokens=%s completion_tokens=%s context=%s", prompt_tokens, completion_tokens, context_size)
                if isinstance(prompt_tokens, int) and isinstance(completion_tokens, int) and prompt_tokens + completion_tokens >= context_size - 1:
                    raise LLMContextLimit("Контекст модели заполнен, ответ обрезан. Начните новый диалог; сохранённая заявка останется.")
                raise LLMOutputLimit("Модель не завершила ответ в пределах лимита генерации. Сократите запрос или проверьте LLM_MAX_OUTPUT_TOKENS; сообщение не сохранено.")
            if not text.strip() and not calls:
                logger.warning("LLM empty response: has_reasoning=%s", bool(message.get("reasoning") or message.get("reasoning_content")))
                raise LLMProtocolError("empty_response")
            if not calls and "<|tool_call>" in text:
                raise LLMProtocolError("unparsed_tool_call")
            return Reply(text.strip(), finish_reason, tuple(calls))
        except (KeyError, IndexError, TypeError, ValueError, AttributeError):
            raise LLMProtocolError("invalid_response") from None

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
            deadline = _deadline.get()
            timeout = self.config.http_timeout_seconds
            if deadline is not None:
                timeout = min(timeout, deadline - monotonic())
                if timeout <= 0:
                    raise TimeoutError()
            with urlopen(request, timeout=timeout) as response:
                data = json.load(response)
        except HTTPError as exc:
            retry_after = retry_after_seconds(exc.headers.get("Retry-After") if exc.headers else None)
            exc.close()
            if exc.code == 429:
                raise LLMRateLimit("Достигнут лимит запросов сервера модели. Повторите позже или продолжите через форму.") from None
            if exc.code in {408, 500, 502, 503, 504}:
                raise LLMTransientError("http_error", status=exc.code, retry_after=retry_after) from None
            descriptions = {
                401: "Проверьте LLM_API_KEY.",
                403: "Сервер запретил доступ к API.",
                404: "Проверьте LLM_API_BASE_URL и имя модели.",
                402: "У провайдера нет бесплатной квоты. Подключите доступный бесплатный или собственный API модели.",
                503: "Сервер модели пока не готов.",
            }
            hint = descriptions.get(exc.code, "Проверьте состояние сервера модели.")
            raise RuntimeError(f"LLM API вернул HTTP {exc.code}. {hint}") from None
        except TimeoutError:
            raise LLMTransientError("timeout") from None
        except (URLError, ConnectionError, HTTPException) as exc:
            reason = "timeout" if isinstance(getattr(exc, "reason", None), TimeoutError) else "connection_error"
            raise LLMTransientError(reason) from None
        except (ValueError, UnicodeError):
            raise LLMProtocolError("invalid_json") from None
        if not isinstance(data, dict):
            raise LLMProtocolError("invalid_response")
        return data
