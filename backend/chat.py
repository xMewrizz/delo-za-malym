"""Сохраняемый диалог и атомарное подтверждение предложений ассистента."""

from copy import deepcopy
import logging
import os
from threading import BoundedSemaphore
from uuid import uuid4

from .assistant import AssistantReply, AssistantResponseError, build_messages, validate_changes
from .models import LoanPreferences
from .service import ProcessError
from scr.delo_za_malyn.Models.Llm.client import LLMContextLimit, LLMOutputLimit, LLMProtocolError, LLMRateLimit, request_budget

logger = logging.getLogger(__name__)


class ChatService:
    def __init__(self, process, assistant, catalog, *, workspace=None):
        self.process, self.store, self.clock = process, process.store, process.clock
        self.assistant, self.catalog = assistant, catalog
        self.workspace = workspace
        limit = int(os.getenv("CHAT_MAX_CONCURRENT_GENERATIONS", "2"))
        if not 1 <= limit <= 8:
            raise ValueError("CHAT_MAX_CONCURRENT_GENERATIONS должен быть от 1 до 8.")
        self.generation_slots = BoundedSemaphore(limit)

    def settings(self):
        return {"mode": self.assistant.mode, "model": self.assistant.model,
                "max_message_length": 8000, "max_turns": 40}

    def _load(self, connection, chat_id):
        chat = self.store.get_chat(connection, chat_id)
        if chat is None:
            raise ProcessError("chat_not_found", "Диалог не найден.", 404)
        return chat

    @staticmethod
    def _version(chat, version):
        if chat["chat_version"] != version:
            raise ProcessError("chat_version_conflict", "Диалог изменился. Обновите страницу.")

    def _public(self, chat, record):
        public = deepcopy(chat)
        for message in public["messages"]:
            proposal = message.get("proposal")
            if proposal and proposal["status"] == "pending":
                proposal["conflicts"] = self.conflicts(proposal, record)
        return {"chat": public, "record": self.process.public(record), "assistant": self.settings()}

    @staticmethod
    def value(record, path):
        section, field = path.split(".")
        return deepcopy(record["application"].get(section, {}).get(field))

    def conflicts(self, proposal, record):
        if "base_values" not in proposal:
            return list(proposal["changes"]) if proposal["base_application_version"] != record["application"]["application_version"] else []
        return [path for path, value in proposal["changes"].items()
                if path in proposal.get("review_fields", []) or self.value(record, path) not in (proposal["base_values"].get(path), value)]

    def create(self, application_id=None):
        record = self.process.get(application_id) if application_id else self.process.create()
        chat = {"chat_id": str(uuid4()), "application_id": record["application"]["application_id"],
                "chat_version": 1, "created_at": self.clock().isoformat(), "messages": []}
        with self.store.connect(write=True) as connection:
            self.store.save_chat(connection, chat)
        return self._public(chat, record)

    def get(self, chat_id):
        with self.store.connect() as connection:
            chat = self._load(connection, chat_id)
            record = self.store.get(connection, chat["application_id"])
        return self._public(chat, record)

    def send(self, chat_id, version, text, request_id):
        request_id = str(request_id)
        with self.store.connect() as connection:
            chat = self._load(connection, chat_id)
            record = self.store.get(connection, chat["application_id"])
        previous = next((message for message in chat["messages"] if message.get("request_id") == request_id), None)
        if previous:
            if previous["text"] != text:
                raise ProcessError("request_id_conflict", "Этот идентификатор уже использован для другого сообщения.")
            return self._public(chat, record)
        self._version(chat, version)
        application_version = record["application"]["application_version"]
        if len(chat["messages"]) >= 80:
            raise ProcessError("chat_limit", "Начните новый диалог: достигнут лимит 40 сообщений пользователя.", 422)
        try:
            messages = build_messages(chat, record, text, self.catalog())
        except ValueError as exc:
            raise ProcessError("context_limit", str(exc), 422) from None
        if not self.generation_slots.acquire(blocking=False):
            raise ProcessError("assistant_busy", "Ассистент занят другими запросами. Повторите позже или продолжите через форму.", 503)
        try:
            tools = ()
            explorations = ()
            with request_budget(getattr(self.assistant, "request_timeout", 180)):
                if hasattr(self.assistant, "reply_with_tools"):
                    turn = self.assistant.reply_with_tools(messages, process=self.process,
                                                           record=record, now=self.clock())
                    reply, tools = turn.reply, turn.tools
                    explorations = turn.explorations
                else:
                    reply = self.assistant.reply(messages)
            reply = AssistantReply.model_validate(reply)
        except LLMRateLimit as exc:
            raise ProcessError("assistant_rate_limited", str(exc), 503) from None
        except LLMProtocolError as exc:
            logger.warning("Assistant protocol failed: reason=%s", exc.reason)
            raise ProcessError("assistant_" + exc.reason, str(exc), 502) from None
        except (LLMContextLimit, LLMOutputLimit) as exc:
            code = "context_limit" if isinstance(exc, LLMContextLimit) else "assistant_output_limit"
            logger.warning("Assistant request rejected: code=%s", code)
            raise ProcessError(code, str(exc), 422) from None
        except (ValueError, RuntimeError, ConnectionError, TimeoutError) as exc:
            # Не сохраняем неполную пару сообщений и не возвращаем секреты провайдера.
            invalid = isinstance(exc, (AssistantResponseError, ValueError))
            code = "assistant_invalid_response" if invalid else "assistant_unavailable"
            logger.warning("Assistant request failed: code=%s error_type=%s", code, type(exc).__name__)
            message = (
                "Модель ответила в неверном формате. Сообщение не сохранено; попробуйте отправить его ещё раз."
                if invalid else
                "Не удалось получить ответ сервера модели. Сообщение не сохранено; повторите попытку."
            )
            raise ProcessError(code, message, 503) from None
        finally:
            self.generation_slots.release()
        now = self.clock().isoformat()
        proposal = None
        if reply.changes:
            pending = next((message["proposal"] for message in reversed(chat["messages"])
                            if message.get("proposal") and message["proposal"]["status"] == "pending"), None)
            changes = {**(pending["changes"] if pending else {}), **reply.changes}
            base_values = deepcopy(pending.get("base_values", {})) if pending else {}
            review_fields = list(pending.get("review_fields", [])) if pending else []
            if pending and "base_values" not in pending and pending["base_application_version"] != application_version:
                review_fields.extend(pending["changes"])
            for path in changes:
                base_values.setdefault(path, self.value(record, path))
            proposal = {"proposal_id": str(uuid4()), "application_id": chat["application_id"],
                        "base_application_version": record["application"]["application_version"],
                        "base_values": base_values, "review_fields": review_fields, "changes": changes, "status": "pending"}
        user = {"message_id": str(uuid4()), "role": "user", "text": text, "created_at": now, "request_id": request_id}
        answer = {"message_id": str(uuid4()), "role": "assistant", "text": reply.text,
                  "intent": reply.intent, "question": reply.question, "proposal": proposal,
                  "model_content": reply.model_dump_json(), "created_at": now,
                  "mode": self.assistant.mode, "model": self.assistant.model,
                  "tools": list(tools)}
        # Не держим блокировку SQLite, пока модель генерирует ответ.
        with self.store.connect(write=True) as connection:
            current = self._load(connection, chat_id)
            previous = next((message for message in current["messages"] if message.get("request_id") == request_id), None)
            if previous:
                if previous["text"] != text:
                    raise ProcessError("request_id_conflict", "Повторный запрос содержит другой текст.")
            else:
                self._version(current, version)
                comparison_attempted = any(tool.get("name") == "compare_options" for tool in tools)
                if explorations or (reply.intent == "compare_options" and not comparison_attempted):
                    record = self.store.get(connection, current["application_id"])
                    self.process._version(record, application_version)
                    if explorations:
                        for exploration in explorations:
                            self.workspace.save_exploration_record(record, exploration, self.clock())
                    else:
                        product = record["application"]["need"].get("preferred_product") or "working_capital_loan"
                        preferences = (reply.preferences or LoanPreferences()).model_dump(exclude_none=True)
                        if product == "overdraft" and reply.preferences is not None and reply.preferences.model_fields_set:
                            raise ProcessError("invalid_comparison", "Для овердрафта нужен дневной план; настройки платежа и срока относятся к разовому кредиту.", 422)
                        self.workspace.explore_record(record, self.clock(), product,
                            preferences=preferences if product == "working_capital_loan" else None)
                    self.store.save(connection, record)
                if proposal:
                    for message in current["messages"]:
                        if message.get("proposal") and message["proposal"]["status"] == "pending":
                            message["proposal"]["status"] = "superseded"
                current["messages"].extend([user, answer])
                current["chat_version"] += 1
                self.store.save_chat(connection, current)
            record = self.store.get(connection, current["application_id"])
        return self._public(current, record)

    def resolve(self, chat_id, proposal_id, version, *, apply):
        with self.store.connect(write=True) as connection:
            chat = self._load(connection, chat_id)
            self._version(chat, version)
            proposal = next((message["proposal"] for message in chat["messages"]
                             if (message.get("proposal") or {}).get("proposal_id") == proposal_id), None)
            if not proposal or proposal["status"] != "pending":
                raise ProcessError("proposal_not_pending", "Предложение уже обработано или заменено новым.")
            record = self.store.get(connection, chat["application_id"])
            if apply:
                if self.conflicts(proposal, record):
                    raise ProcessError("version_conflict", "Некоторые предложенные поля уже изменены в форме. Проверьте и сохраните исправленный черновик.")
                self.process.patch_record(record, proposal["changes"], self.clock())
                self.store.save(connection, record)
                proposal["status"] = "applied"
            else:
                proposal["status"] = "rejected"
            chat["chat_version"] += 1
            self.store.save_chat(connection, chat)
        return self._public(chat, record)

    def edit(self, chat_id, proposal_id, version, application_version, changes):
        try:
            validate_changes(changes)
        except ValueError as exc:
            raise ProcessError("invalid_proposal", str(exc), 422) from None
        with self.store.connect(write=True) as connection:
            chat = self._load(connection, chat_id)
            self._version(chat, version)
            record = self.store.get(connection, chat["application_id"])
            self.process._version(record, application_version)
            proposal = next((message["proposal"] for message in chat["messages"]
                if (message.get("proposal") or {}).get("proposal_id") == proposal_id), None)
            if not proposal or proposal["status"] != "pending":
                raise ProcessError("proposal_not_pending", "Черновик уже обработан или заменён.")
            proposal.update(changes=deepcopy(changes), base_application_version=application_version,
                            base_values={path: self.value(record, path) for path in changes},
                            review_fields=[],
                            status="pending" if changes else "rejected")
            chat["chat_version"] += 1
            self.store.save_chat(connection, chat)
        return self._public(chat, record)
