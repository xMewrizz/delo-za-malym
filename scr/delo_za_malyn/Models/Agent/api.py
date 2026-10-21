"""Локальный тестовый HTTP-чат с промптами, без инструментов и RAG."""

import hmac
import logging
from dataclasses import replace
from threading import Lock
from time import monotonic
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
import uvicorn

from scr.delo_za_malyn.settings.logging_config import configure_logging
from scr.delo_za_malyn.settings.settings import Settings, settings

from .agent import Agent

logger = logging.getLogger(__name__)


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)

    @field_validator("content")
    @classmethod
    def nonempty_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Сообщение не должно быть пустым.")
        return value


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [{
        "messages": [{"role": "user", "content": "Привет! Кратко объясни, чем можешь помочь."}],
        "product": None, "scenario": None,
    }]})
    messages: list[ChatMessage] = Field(min_length=1, description="История диалога; последнее сообщение от user.")
    product: Literal["working_capital_loan", "overdraft"] | None = None
    scenario: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{0,63}$")

    @model_validator(mode="after")
    def check_last_message(self) -> "ChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("Последнее сообщение должно иметь role=user.")
        if self.scenario is not None and self.product is None:
            raise ValueError("Для scenario нужно указать product.")
        return self


class ChatResponse(BaseModel):
    response: str
    messages: list[ChatMessage]
    model: str
    elapsed_seconds: float
    tool_calls: int


def create_app(config: Settings = settings, *, agent: Agent | None = None) -> FastAPI:
    # Этот endpoint предназначен только для проверки диалога и промптов.
    # Даже при смене глобального режима тестовая ручка не включает внешние инструменты.
    chat_config = replace(config, agent_tools_enabled=False)
    runtime = agent if agent is not None else Agent(chat_config)
    busy = Lock()
    app = FastAPI(
        title="Gemma: тестовый чат", version="0.1.0",
        description=("Локальная проверка промптов и контекста. Без RAG и инструментов. "
                     "История передаётся в messages; сервер её не хранит. "
                     "Запуск API не загружает модель, генерацию запускает POST /chat."),
    )
    app.state.agent = runtime
    api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

    def authorize(key: Annotated[str | None, Depends(api_key_header)]):
        if chat_config.app_api_key and (
            key is None or not hmac.compare_digest(key.encode(), chat_config.app_api_key.encode())
        ):
            raise HTTPException(status_code=401, detail="Неверный X-API-Key.")

    @app.get("/", include_in_schema=False)
    def index():
        return RedirectResponse("/docs")

    @app.get("/health", tags=["Проверка API"])
    def health():
        return {"status": "ok", "model": chat_config.llm_model,
                "tools_enabled": False, "rag_enabled": False}

    @app.post(
        chat_config.api_prefix + "/chat", response_model=ChatResponse,
        tags=["Диалог"], dependencies=[Depends(authorize)],
        description=("Отправьте сообщения user/assistant. Системный промпт подставляется из файлов. "
                     "Для следующего хода скопируйте messages из ответа и добавьте новое сообщение user. "
                     "product/scenario необязательны; их отсутствие подключает только основной промпт."),
    )
    def chat(body: ChatRequest):
        if len(body.messages) > chat_config.chat_max_messages:
            raise HTTPException(status_code=422, detail="Превышен CHAT_MAX_MESSAGES. Начните новый диалог или сократите историю.")
        if sum(len(item.content) for item in body.messages) > chat_config.chat_max_input_chars:
            raise HTTPException(status_code=422, detail="Превышен CHAT_MAX_INPUT_CHARS. Сократите историю.")
        if body.product is not None:
            product = chat_config.agent_prompts_dir / "products" / body.product
            requested = product / "scenarios" / f"{body.scenario}.md" if body.scenario else product / "common.md"
            if not requested.is_file():
                raise HTTPException(status_code=422, detail="Неизвестный продукт или сценарий.")
        if not busy.acquire(blocking=False):
            raise HTTPException(status_code=429, detail="Модель уже обрабатывает запрос. Дождитесь ответа.")
        started = monotonic()
        try:
            messages = [item.model_dump() for item in body.messages]
            reply = runtime.run(messages[-1]["content"], history=messages[:-1],
                                product=body.product, scenario=body.scenario)
            response_messages = messages + [{"role": "assistant", "content": reply.text}]
            return ChatResponse(response=reply.text, messages=response_messages,
                                model=chat_config.llm_model,
                                elapsed_seconds=round(monotonic() - started, 3),
                                tool_calls=reply.tool_calls)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        except RuntimeError as exc:
            logger.warning("Запрос тестового чата завершился ошибкой")
            raise HTTPException(status_code=502, detail=str(exc)) from None
        finally:
            busy.release()

    return app


def main() -> None:
    configure_logging()
    logger.info("Тестовый чат: http://%s:%d/docs", settings.app_host, settings.app_port)
    uvicorn.run(create_app(), host=settings.app_host, port=settings.app_port,
                log_level=settings.log_level.lower(), workers=1)


if __name__ == "__main__":
    main()
