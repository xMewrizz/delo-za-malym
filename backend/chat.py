"""Сохраняемый диалог и атомарное подтверждение предложений ассистента."""

from copy import deepcopy
import logging
import os
from threading import BoundedSemaphore
from uuid import uuid4

from .assistant import AssistantReply, AssistantResponseError, build_messages, validate_changes
from .models import LoanPreferences, OverdraftPlanUpdate
from .service import EDITABLE_STATES, ProcessError
from .overdraft_chat import PLAN_PATH, engine_plan, merge_plan, plan_issues
from .clarifications import next_clarification, pending_proposal, public_clarification, resolve_answer
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
                if PLAN_PATH in proposal["changes"]:
                    proposal["plan_issues"] = plan_issues(record, proposal["changes"][PLAN_PATH], self.clock(), proposal["changes"])
        pending = pending_proposal(chat)
        clarification = None if pending and self.conflicts(pending, record) else next_clarification(chat, record, self.clock())
        return {"chat": public, "record": self.process.public(record), "assistant": self.settings(),
                "clarification": public_clarification(clarification)}

    @staticmethod
    def value(record, path):
        section, field = path.split(".")
        return deepcopy(record["application"].get(section, {}).get(field))

    def conflicts(self, proposal, record):
        if "base_values" not in proposal:
            return list(proposal["changes"]) if proposal["base_application_version"] != record["application"]["application_version"] else []
        changed = [path for path, value in proposal["changes"].items()
                if path in proposal.get("review_fields", []) or self.value(record, path) not in (proposal["base_values"].get(path), value)]
        return list(dict.fromkeys(changed + [path for path, value in proposal.get("dependencies", {}).items()
                                           if self.value(record, path) != value]))

    def _new_proposal(self, record, changes, pending=None):
        version = record["application"]["application_version"]
        base_values = deepcopy((pending or {}).get("base_values", {}))
        review_fields = list((pending or {}).get("review_fields", []))
        if pending and "base_values" not in pending and pending["base_application_version"] != version:
            review_fields.extend(pending["changes"])
        for path in changes:
            base_values.setdefault(path, self.value(record, path))
        proposal = {"proposal_id": str(uuid4()), "application_id": record["application"]["application_id"],
                    "base_application_version": version, "base_values": base_values, "review_fields": review_fields,
                    "changes": deepcopy(changes), "status": "pending"}
        if pending and pending.get("field_sources"):
            proposal["field_sources"] = deepcopy(pending["field_sources"])
        if PLAN_PATH in changes:
            proposal["dependencies"] = deepcopy((pending or {}).get("dependencies", {}))
            for path in ("financials.cash_balance", "financials.existing_loans"):
                proposal["dependencies"].setdefault(path, self.value(record, path))
        return proposal

    def answer_clarification(self, chat_id, question_id, body):
        identity = {"question_id": question_id, "choice_id": body.choice_id, "value": body.value}
        request_id = str(body.request_id)
        with self.store.connect(write=True) as connection:
            chat = self._load(connection, chat_id)
            record = self.store.get(connection, chat["application_id"])
            previous = next((message for message in chat["messages"] if message.get("request_id") == request_id), None)
            if previous:
                if previous.get("clarification_answer") != identity:
                    raise ProcessError("request_id_conflict", "Этот идентификатор уже использован для другого ответа.")
                return self._public(chat, record)
            self._version(chat, body.base_chat_version)
            self.process._version(record, body.base_application_version)
            pending = pending_proposal(chat)
            if record["state"]["status"] not in EDITABLE_STATES or (pending and self.conflicts(pending, record)):
                raise ProcessError("clarification_stale", "Данные изменились. Обновите вопрос и проверьте значения.")
            card = next_clarification(chat, record, self.clock())
            if card is None or card["question_id"] != question_id:
                raise ProcessError("clarification_stale", "Этот вопрос уже изменился. Используйте актуальную карточку.")
            if len(chat["messages"]) >= 80:
                raise ProcessError("chat_limit", "Начните новый диалог: достигнут лимит 40 ответов.", 422)
            try:
                fields, plan, label = resolve_answer(card, record, choice_id=body.choice_id, value=body.value,
                                                     now=self.clock(), operation_id="answer-" + request_id)
                changes = {**(pending or {}).get("changes", {}), **fields}
                if plan is not None:
                    self._plan_changes(record, changes, OverdraftPlanUpdate.model_validate(plan))
            except ValueError as exc:
                raise ProcessError("invalid_clarification", str(exc), 422) from None
            proposal = self._new_proposal(record, changes, pending)
            if pending:
                pending["status"] = "superseded"
            now = self.clock().isoformat()
            chat["messages"].extend([
                {"message_id": str(uuid4()), "role": "user", "text": label, "created_at": now,
                 "request_id": request_id, "clarification_answer": identity, "clarification_question": card["title"]},
                {"message_id": str(uuid4()), "role": "assistant", "text": "Учёл ответ в черновике.",
                 "intent": "propose_changes", "question": None, "proposal": proposal,
                 "created_at": now, "mode": "form", "model": None, "tools": []}])
            chat["chat_version"] += 1
            following = next_clarification(chat, record, self.clock())
            chat["messages"][-1]["question"] = following["title"] if following else None
            self.store.save_chat(connection, chat)
        return self._public(chat, record)

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

    def preview(self, chat_id, proposal_id, version):
        """Расчёт предложенного сценария на копии, без сохранения или вызова модели."""
        with self.store.connect() as connection:
            chat = self._load(connection, chat_id)
            self._version(chat, version)
            record = self.store.get(connection, chat["application_id"])
        proposal = next((message["proposal"] for message in chat["messages"]
                         if (message.get("proposal") or {}).get("proposal_id") == proposal_id), None)
        if not proposal or proposal["status"] != "pending":
            raise ProcessError("proposal_not_pending", "Предложение уже обработано или заменено новым.")
        if self.conflicts(proposal, record):
            raise ProcessError("version_conflict", "Данные изменились. Проверьте предложенные значения.")
        projection = deepcopy(record)
        changes = deepcopy(proposal["changes"])
        issues = []
        if PLAN_PATH in changes:
            issues = plan_issues(record, changes[PLAN_PATH], self.clock(), changes)
            changes[PLAN_PATH] = engine_plan(changes[PLAN_PATH])
        self.process.patch_record(projection, changes, self.clock())
        need = projection["application"]["need"]
        product = need.get("preferred_product") or ("refinancing" if need.get("purpose") == "refinancing" else None) or (
            "overdraft" if need.get("financing_pattern") == "cash_gap" else "working_capital_loan")
        self.workspace.explore_record(projection, self.clock(), product)
        result = projection["explorations"][-1]["result"]
        # Неполный денежный план можно визуализировать, но не выдавать за доступное предложение.
        if issues:
            result["options"] = []
            result["status"] = "needs_information"
        return {"proposal_id": proposal_id, "chat_version": version,
                "application_version": record["application"]["application_version"],
                "confirmed": False, "issues": issues, "result": result}

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
            messages = build_messages(chat, record, text, self.catalog(), now=self.clock())
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
        if reply.changes or reply.overdraft_plan is not None:
            pending = next((message["proposal"] for message in reversed(chat["messages"])
                            if message.get("proposal") and message["proposal"]["status"] == "pending"), None)
            changes = {**(pending["changes"] if pending else {}), **reply.changes}
            if reply.overdraft_plan is not None:
                try:
                    self._plan_changes(record, changes, reply.overdraft_plan)
                except ValueError as exc:
                    raise ProcessError("invalid_plan_proposal", str(exc), 422) from None
            proposal = self._new_proposal(record, changes, pending)
        user = {"message_id": str(uuid4()), "role": "user", "text": text, "created_at": now, "request_id": request_id}
        answer = {"message_id": str(uuid4()), "role": "assistant", "text": reply.text,
                  "intent": reply.intent, "question": reply.question, "proposal": proposal,
                  "model_content": reply.model_dump_json(), "created_at": now,
                  "mode": self.assistant.mode, "model": self.assistant.model,
                  "tools": list(tools)}
        if reply.overdraft_plan is not None:
            issues = plan_issues(record, proposal["changes"][PLAN_PATH], self.clock(), proposal["changes"])
            answer["text"] = "Собрал будущие операции. Проверьте суммы и даты в карточке."
            answer["question"] = issues[0]["message"] if issues else None
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
                        need = record["application"]["need"]
                        product = need.get("preferred_product") or ("refinancing" if need.get("purpose") == "refinancing" else None) or (
                            "overdraft" if need.get("financing_pattern") == "cash_gap" else "working_capital_loan")
                        preferences = (reply.preferences or LoanPreferences()).model_dump(exclude_none=True, exclude_unset=True)
                        if product == "overdraft" and reply.preferences is not None and reply.preferences.model_fields_set:
                            raise ProcessError("invalid_comparison", "Для овердрафта нужен дневной план; настройки платежа и срока относятся к разовому кредиту.", 422)
                        self.workspace.explore_record(record, self.clock(), product,
                            preferences=preferences if product in ("working_capital_loan", "refinancing", "revolving_credit_line", "investment_loan") else None)
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
                changes = deepcopy(proposal["changes"])
                if PLAN_PATH in changes:
                    issues = plan_issues(record, changes[PLAN_PATH], self.clock(), changes)
                    if issues:
                        raise ProcessError("plan_incomplete", issues[0]["message"], 422)
                    changes[PLAN_PATH] = engine_plan(changes[PLAN_PATH])
                self.process.patch_record(record, changes, self.clock())
                from .sources import attach_sources
                attach_sources(record, proposal.get("field_sources", {}))
                need = record["application"]["need"]
                if PLAN_PATH in changes:
                    product = need.get("preferred_product") or ("refinancing" if need.get("purpose") == "refinancing" else None) or ("overdraft" if need.get("financing_pattern") == "cash_gap" else "working_capital_loan")
                    if product == "overdraft" or need.get("requested_amount") is not None:
                        self.workspace.explore_record(record, self.clock(), product)
                elif (record["application"]["need"].get("purpose") in ("working_capital", "investment")
                      and record["application"]["need"].get("requested_amount") is not None
                      and record["application"]["need"].get("financing_pattern") != "cash_gap"
                      and record["application"]["need"].get("preferred_product") != "overdraft"):
                    self.workspace.explore_record(record, self.clock(), need["preferred_product"] if need.get("preferred_product") in ("revolving_credit_line", "investment_loan") else "working_capital_loan")
                self.store.save(connection, record)
                proposal["status"] = "applied"
            else:
                proposal["status"] = "rejected"
            chat["chat_version"] += 1
            self.store.save_chat(connection, chat)
        return self._public(chat, record)

    def _plan_changes(self, record, changes, update):
        previous = changes.get(PLAN_PATH)
        if previous is None:
            previous = record["application"].get("product_details", {}).get("overdraft")
            # Новый список из нового диалога не дополняет старый пример молча.
            # Добавление к сохранённому плану требует явного mode=merge.
            saved_ids = {row["transaction_id"] for row in (previous or {}).get("transactions", [])}
            new_ids = {row.transaction_id for row in update.transactions}
            if previous and new_ids and not new_ids & saved_ids and not update.removed_transaction_ids and "mode" not in update.model_fields_set:
                update = update.model_copy(update={"mode": "replace"})
        changes[PLAN_PATH] = merge_plan(record, previous, update, self.clock())
        preferred = changes.get("need.preferred_product", record["application"]["need"].get("preferred_product"))
        for field, default in (("purpose", "working_capital"), ("financing_pattern", "gradual_repayment" if preferred == "working_capital_loan" else "cash_gap")):
            if changes.get("need." + field, record["application"]["need"].get(field)) is None:
                changes["need." + field] = default

    def edit(self, chat_id, proposal_id, version, application_version, changes, *, plan_update=None, remove_plan=False):
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
            changes = deepcopy(changes)
            if not remove_plan and PLAN_PATH in proposal["changes"]:
                changes[PLAN_PATH] = deepcopy(proposal["changes"][PLAN_PATH])
            if plan_update is not None:
                try:
                    self._plan_changes(record, changes, plan_update)
                except ValueError as exc:
                    raise ProcessError("invalid_plan_proposal", str(exc), 422) from None
            proposal.update(changes=deepcopy(changes), base_application_version=application_version,
                            base_values={path: self.value(record, path) for path in changes},
                            review_fields=[],
                            status="pending" if changes else "rejected")
            proposal["dependencies"] = {path: self.value(record, path) for path in
                ("financials.cash_balance", "financials.existing_loans")} if PLAN_PATH in changes else {}
            for message in chat["messages"]:
                if message.get("proposal") is proposal:
                    issues = plan_issues(record, changes[PLAN_PATH], self.clock(), changes) if PLAN_PATH in changes else []
                    message["question"] = issues[0]["message"] if issues else None
            chat["chat_version"] += 1
            self.store.save_chat(connection, chat)
        return self._public(chat, record)
