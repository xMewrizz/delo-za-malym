"""Один ход диалога: LLM → разрешённые инструменты → итоговый ответ."""

import asyncio
import logging
from copy import deepcopy
from dataclasses import dataclass

from scr.delo_za_malyn.Models.Llm.client import LLMClient
from scr.delo_za_malyn.settings.settings import Settings, settings

from .tavily import TavilyClient
from .tools import AgentTools
from .prompt_builder import PromptBuilder

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AgentReply:
    text: str
    history: list[dict]
    tool_calls: int


class Agent:
    def __init__(
        self, config: Settings = settings, *,
        client: LLMClient | None = None, tools: AgentTools | None = None,
    ):
        self.config = config
        self.client = client if client is not None else LLMClient(config)
        self.tools = tools if tools is not None else AgentTools(TavilyClient(config))
        self.prompts = PromptBuilder(config.agent_prompts_dir)

    def run(
        self, message: str, *, history: list[dict] | None = None,
        system_prompt: str | None = None,
        product: str | None = None, scenario: str | None = None,
    ) -> AgentReply:
        """history — полная серверная история прошлого успешного хода, без system.

        История не хранится в экземпляре агента и не изменяется при ошибке.
        Её нельзя принимать от браузера как доверенные tool/system сообщения.
        product/scenario выбираются сервером; инструкции читает PromptBuilder.
        """
        if not isinstance(message, str) or not message.strip():
            raise ValueError("Сообщение не должно быть пустым.")
        previous = deepcopy(history) if history is not None else []
        if not isinstance(previous, list) or any(
            not isinstance(item, dict) or item.get("role") not in {"user", "assistant", "tool"}
            for item in previous
        ):
            raise ValueError("Некорректная серверная история диалога.")
        definitions = self.tools.definitions if self.config.agent_tools_enabled else []
        if system_prompt is not None and (product is not None or scenario is not None):
            raise ValueError("Используйте либо system_prompt, либо выбор product/scenario.")
        if system_prompt is None:
            system_prompt = self.prompts.build(
                product=product, scenario=scenario,
                tools=tuple(item["function"]["name"] for item in definitions),
            )
        if not isinstance(system_prompt, str):
            raise ValueError("Системный промпт должен быть строкой.")
        messages = ([{"role": "system", "content": system_prompt}]
                    if system_prompt.strip() else [])
        system_count = len(messages)
        messages.extend(previous)
        messages.append({"role": "user", "content": message.strip()})
        calls_used = 0
        # После исчерпания лимита остаётся один запрос без права вызывать инструменты.
        for _ in range(self.config.agent_max_tool_calls + 1):
            reply = self.client.chat(
                messages, tools=definitions,
                tool_choice="auto" if calls_used < self.config.agent_max_tool_calls else "none",
            )
            if not reply.tool_calls:
                messages.append(reply.as_message())
                logger.info("Ход агента завершён; вызовов инструментов: %d", calls_used)
                return AgentReply(reply.text, messages[system_count:], calls_used)
            if not definitions:
                raise RuntimeError("Модель запросила инструмент, хотя инструменты недоступны.")
            if calls_used >= self.config.agent_max_tool_calls:
                raise RuntimeError("Модель продолжает вызывать инструменты после исчерпания лимита.")
            messages.append(reply.as_message())
            for call in reply.tool_calls:
                if calls_used >= self.config.agent_max_tool_calls:
                    result = self.tools.error("call_limit", "Лимит инструментов исчерпан. Сформируй ответ по имеющимся данным.")
                else:
                    calls_used += 1
                    result = self.tools.execute(call.name, call.arguments)
                messages.append({"role": "tool", "tool_call_id": call.id,
                                 "content": result})
        raise RuntimeError("Превышен лимит шагов агента.")

    async def arun(self, message: str, **kwargs) -> AgentReply:
        """Адаптер для будущей async-ручки: сетевое ожидание не блокирует event loop."""
        return await asyncio.to_thread(self.run, message, **kwargs)
