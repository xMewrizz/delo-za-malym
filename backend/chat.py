"""Сохраняемый диалог и атомарное подтверждение предложений ассистента."""

from copy import deepcopy
from uuid import uuid4

from .assistant import AssistantReply, build_messages
from .service import ProcessError


class ChatService:
    def __init__(self, process, assistant, catalog):
        self.process, self.store, self.clock = process, process.store, process.clock
        self.assistant, self.catalog = assistant, catalog

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
        return {"chat": deepcopy(chat), "record": self.process.public(record), "assistant": self.settings()}

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
        if len(chat["messages"]) >= 80:
            raise ProcessError("chat_limit", "Начните новый диалог: достигнут лимит 40 сообщений пользователя.", 422)
        try:
            messages = build_messages(chat, record, text, self.catalog())
        except ValueError as exc:
            raise ProcessError("context_limit", str(exc), 422) from None
        try:
            reply = AssistantReply.model_validate(self.assistant.reply(messages))
        except (ValueError, RuntimeError, ConnectionError, TimeoutError):
            # Не сохраняем неполную пару сообщений и не возвращаем секреты провайдера.
            raise ProcessError("assistant_unavailable", "Не удалось получить корректный ответ модели. Повторите сообщение или заполните потребность вручную.", 503) from None
        now = self.clock().isoformat()
        proposal = None
        if reply.changes:
            proposal = {"proposal_id": str(uuid4()), "application_id": chat["application_id"],
                        "base_application_version": record["application"]["application_version"],
                        "changes": reply.changes, "status": "pending"}
        user = {"message_id": str(uuid4()), "role": "user", "text": text, "created_at": now, "request_id": request_id}
        answer = {"message_id": str(uuid4()), "role": "assistant", "text": reply.text,
                  "intent": reply.intent, "question": reply.question, "proposal": proposal,
                  "model_content": reply.model_dump_json(), "created_at": now,
                  "mode": self.assistant.mode, "model": self.assistant.model}
        # Не держим блокировку SQLite, пока модель генерирует ответ.
        with self.store.connect(write=True) as connection:
            current = self._load(connection, chat_id)
            previous = next((message for message in current["messages"] if message.get("request_id") == request_id), None)
            if previous:
                if previous["text"] != text:
                    raise ProcessError("request_id_conflict", "Повторный запрос содержит другой текст.")
            else:
                self._version(current, version)
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
                self.process._version(record, proposal["base_application_version"])
                self.process.patch_record(record, proposal["changes"], self.clock())
                self.store.save(connection, record)
                proposal["status"] = "applied"
            else:
                proposal["status"] = "rejected"
            chat["chat_version"] += 1
            self.store.save_chat(connection, chat)
        return self._public(chat, record)
