"""Счёт поставщика: проверка, источники полей и явное применение."""

from copy import deepcopy
from hashlib import sha256
from uuid import uuid4
from threading import BoundedSemaphore
import re

from .clarifications import pending_proposal
from .invoice_pdf import InvoiceError, parse_invoice
from .models import OverdraftPlanUpdate
from .overdraft_chat import PLAN_PATH, local_now, merge_plan
from .service import EDITABLE_STATES, ProcessError, event
from .sources import attach_sources, operation_path


class InvoiceDocuments:
    def __init__(self, process, chats):
        self.process, self.chats, self.store = process, chats, process.store
        self.parsers = BoundedSemaphore(2)

    def editable(self, record, version):
        self.process._version(record, version)
        if record["state"]["status"] not in EDITABLE_STATES:
            raise ProcessError("document_not_editable", "Оформление завершено. Для новой потребности начните отдельный подбор.")

    def upload(self, application_id, version, filename, content):
        record = self.process.get(application_id)
        self.editable(record, version)
        filename = re.sub(r"[\x00-\x1f\x7f]", "", filename.replace("\\", "/").split("/")[-1])
        if not filename.lower().endswith(".pdf"):
            raise ProcessError("unsupported_document", "Поддерживаются счета в PDF с текстовым слоем.", 422)
        if not self.parsers.acquire(blocking=False):
            raise ProcessError("document_processing_busy", "Сейчас читаем другие документы. Повторите загрузку через несколько секунд.", 429)
        try:
            try:
                parsed = parse_invoice(content)
            except InvoiceError as exc:
                raise ProcessError(exc.code, str(exc), 422) from None
        finally:
            self.parsers.release()
        with self.store.connect(write=True) as connection:
            record = self.store.get(connection, application_id)
            self.editable(record, version)
            documents = record.setdefault("documents", [])
            digest = sha256(content).hexdigest()
            if any(item["sha256"] == digest for item in documents):
                return self.process.public(record)
            if len(documents) >= 10:
                raise ProcessError("document_limit", "Для одной заявки поддерживается до 10 счетов.", 422)
            identifier = str(uuid4())
            documents.append({"document_id": identifier, "filename": filename, "sha256": digest,
                              "revision": 1, "status": "extracted", "created_at": self.process.clock().isoformat(),
                              "values": None, **parsed})
            connection.execute("INSERT INTO documents(document_id, application_id, content) VALUES (?, ?, ?)",
                               (identifier, application_id, content))
            event(record, "invoice_uploaded", self.process.clock(), document_id=identifier)
            self.store.save(connection, record)
        return self.process.public(record)

    def content(self, application_id, document_id):
        record = self.process.get(application_id)
        document = self.find(record, document_id)
        with self.store.connect() as connection:
            row = connection.execute("SELECT content FROM documents WHERE document_id=? AND application_id=?", (document_id, application_id)).fetchone()
        if row is None:
            raise ProcessError("document_not_found", "Оригинал счёта не найден.", 404)
        return document["filename"], row[0]

    @staticmethod
    def find(record, document_id):
        document = next((item for item in record.get("documents", []) if item["document_id"] == document_id), None)
        if not document:
            raise ProcessError("document_not_found", "Счёт не найден в этой заявке.", 404)
        return document

    @staticmethod
    def source(document, field, value):
        candidates = document["extracted"][field]
        original = next((item for item in candidates if item["value"] == value), candidates[0] if len(candidates) == 1 else None)
        return {"document_id": document["document_id"], "filename": document["filename"],
                "value": value, "original": deepcopy(original), "user_corrected": not original or original["value"] != value}

    def use(self, application_id, document_id, body, *, chat_id=None):
        now = self.process.clock()
        with self.store.connect(write=True) as connection:
            record = self.store.get(connection, application_id)
            if record is None:
                raise ProcessError("application_not_found", "Заявка не найдена.", 404)
            self.editable(record, body.base_application_version)
            document = self.find(record, document_id)
            if document["revision"] != body.document_revision:
                raise ProcessError("document_revision_conflict", "Сведения по счёту уже обновлены. Проверьте актуальную карточку.")
            chat = self.chats._load(connection, chat_id) if chat_id else None
            if chat and chat["application_id"] != application_id:
                raise ProcessError("document_chat_mismatch", "Диалог относится к другой заявке.", 422)
            if chat:
                if body.base_chat_version is None:
                    raise ProcessError("chat_version_required", "Обновите диалог перед использованием счёта.", 422)
                self.chats._version(chat, body.base_chat_version)
                if len(chat["messages"]) >= 80:
                    raise ProcessError("chat_limit", "Начните новый диалог: достигнут лимит сообщений.", 422)
            pending = pending_proposal(chat) if chat else None
            if pending and self.chats.conflicts(pending, record):
                raise ProcessError("version_conflict", "Сначала проверьте конфликтующие изменения диалога.")
            changes = deepcopy((pending or {}).get("changes", {})) if chat else {}
            need = {**record["application"]["need"], **{path[5:]: value for path, value in changes.items() if path.startswith("need.")}}
            sources = deepcopy((pending or {}).get("field_sources", {})) if chat else {}
            identifier = body.transaction_id or "invoice-" + document_id
            conflicts = []
            if body.target == "loan_amount":
                existing = need.get("requested_amount")
                if existing is not None and existing != body.amount:
                    conflicts.append("сумма кредита")
                changes["need.requested_amount"] = body.amount
                sources["need.requested_amount"] = self.source(document, "amount", body.amount)
            elif body.target == "planned_expense":
                if need.get("purpose") not in (None, "working_capital"):
                    raise ProcessError("invoice_plan_not_applicable", "Денежный план доступен для финансирования оборотных расходов.", 422)
                if body.due_date is None or body.due_date < local_now(now).date().isoformat():
                    raise ProcessError("invoice_payment_date_required", "Укажите будущую дату оплаты счёта.", 422)
                previous = changes.get(PLAN_PATH, (record["application"].get("product_details") or {}).get("overdraft"))
                operation = next((row for row in (previous or {}).get("transactions", []) if row["transaction_id"] == identifier), None)
                if body.transaction_id and operation is None:
                    raise ProcessError("invoice_operation_not_found", "Выбранная оплата уже изменилась. Обновите карточку.")
                if operation and operation.get("direction") != "outflow":
                    raise ProcessError("invoice_operation_not_expense", "Счёт поставщика можно связать только с расходом.", 422)
                if operation:
                    for field, value in (("amount", body.amount), ("date", body.due_date)):
                        if operation.get(field) is not None and operation[field] != value:
                            conflicts.append("сумма оплаты" if field == "amount" else "дата оплаты")
                plan = merge_plan(record, previous, OverdraftPlanUpdate(transactions=[{
                    "transaction_id": identifier, "direction": "outflow", "amount": body.amount, "date": body.due_date,
                }]), now)
                changes[PLAN_PATH] = plan
                if need.get("purpose") is None:
                    changes["need.purpose"] = "working_capital"
                if need.get("financing_pattern") is None:
                    changes["need.financing_pattern"] = "gradual_repayment" if need.get("preferred_product") == "working_capital_loan" else "cash_gap"
                for field, value in (("amount", body.amount), ("date", body.due_date)):
                    sources[operation_path(identifier, field)] = self.source(document, "amount" if field == "amount" else "due_date", value)
            if conflicts and not body.replace_existing:
                raise ProcessError("invoice_conflict", "Со счётом расходятся: " + ", ".join(conflicts) + ". Подтвердите замену или оставьте прежние данные.")
            document.update(status="reviewed", revision=document["revision"] + 1,
                            values={"amount": body.amount, "due_date": body.due_date},
                            last_use={"target": body.target, "transaction_id": identifier if body.target == "planned_expense" else None})
            if chat:
                proposal = None
                if body.target != "evidence":
                    proposal = self.chats._new_proposal(record, changes, pending)
                    proposal["field_sources"] = sources
                    if pending:
                        pending["status"] = "superseded"
                chat["messages"].append({"message_id": str(uuid4()), "role": "assistant", "created_at": now.isoformat(),
                                         "text": "Проверенный счёт сохранён." if proposal is None else "Учёл данные счёта в рабочем черновике. Проверьте значения рядом.",
                                         "mode": "document", "proposal": proposal, "document_id": document_id})
                chat["chat_version"] += 1
                self.store.save_chat(connection, chat)
            elif changes:
                self.process.patch_record(record, changes, now)
                attach_sources(record, sources)
            event(record, "invoice_reviewed", now, document_id=document_id, target=body.target, proposed=bool(chat and body.target != "evidence"))
            self.store.save(connection, record)
        return self.chats._public(chat, record) if chat else self.process.public(record)
