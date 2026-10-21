"""Сохранённые варианты, независимые сценарии и подтверждение импорта."""

from copy import deepcopy
from datetime import timedelta
from uuid import uuid4
import csv
from io import StringIO

from credit_engine.checks import parse_timestamp
from credit_engine.options import loan_options, overdraft_options

from . import demo
from .imports import HEADERS, preview_csv
from .service import EDITABLE_STATES, ProcessError, event


class ProductWorkspace:
    def __init__(self, process):
        self.process = process

    def explore(self, application_id, version, product_id, *, preferences=None, delay=None):
        return self.process.change(application_id, version, lambda record, now:
            self.explore_record(record, now, product_id, preferences=preferences, delay=delay))

    def explore_record(self, record, now, product_id, *, preferences=None, delay=None):
        if record["state"]["status"] not in EDITABLE_STATES:
            raise ProcessError("exploration_not_allowed", "Для новой потребности создайте заявку.")
        history = record.setdefault("explorations", [])
        previous = history[-1]["result"] if history else {}
        checks = demo.simulate_checks(record["application"], record["simulator"], now,
            retry=previous.get("status") in ("needs_checks", "check_retry_pending"))
        identifier = str(uuid4())
        try:
            if product_id == "working_capital_loan":
                result = loan_options(record["application"], checks, calculated_at=now, preferences=preferences, exploration_id=identifier)
            elif product_id == "overdraft":
                result = overdraft_options(record["application"], checks, calculated_at=now, delay=delay, exploration_id=identifier)
            else:
                raise ValueError("Продукт не поддерживается.")
        except ValueError as exc:
            raise ProcessError("invalid_exploration", str(exc), 422) from None
        self.save_exploration_record(record, {"exploration_id": identifier,
            "application_version": record["application"]["application_version"], "created_at": now.isoformat(),
            "valid_until": (now + timedelta(days=7)).isoformat(), "product_id": product_id, "result": result}, now)

    def save_exploration_record(self, record, exploration, now):
        self.process._version(record, exploration["application_version"])
        if record["state"]["status"] not in EDITABLE_STATES:
            raise ProcessError("exploration_not_allowed", "Оформление уже завершено. Создайте новую заявку.")
        record["explorations"] = [*record.get("explorations", []), deepcopy(exploration)][-10:]
        event(record, "options_explored", now, exploration_id=exploration["exploration_id"],
              product_id=exploration["product_id"], status=exploration["result"]["status"])

    def apply(self, application_id, version, exploration_id, option_id):
        def select(record, now):
            exploration = next((item for item in record.get("explorations", []) if item["exploration_id"] == exploration_id), None)
            if not exploration:
                raise ProcessError("exploration_not_found", "Расчёт не найден. Обновите подбор.", 404)
            if exploration["application_version"] != version:
                raise ProcessError("exploration_stale", "Заявка изменилась. Пересчитайте варианты.")
            if parse_timestamp(exploration["valid_until"]) <= now:
                raise ProcessError("exploration_expired", "Расчёт устарел. Обновите подбор.")
            option = next((item for item in exploration["result"]["options"] if item["option_id"] == option_id), None)
            if not option:
                raise ProcessError("option_not_found", "Вариант не найден в выбранном расчёте.", 404)
            changes = {"need.preferred_product": option["product_id"], "need.requested_amount": option["amount"],
                       "need.term_months": option["term_months"]}
            if option["product_id"] == "overdraft":
                changes["product_details"] = {"overdraft": deepcopy(exploration["result"]["projected_plan"])}
                changes["need.financing_pattern"] = "cash_gap"
            self.process.patch_record(record, changes, now)
            event(record, "explored_option_applied", now, exploration_id=exploration_id, option_id=option_id)
        return self.process.change(application_id, version, select)

    def import_csv(self, application_id, version, filename, content):
        def inspect(record, now):
            if record["state"]["status"] not in EDITABLE_STATES:
                raise ProcessError("import_not_allowed", "Данные завершённой заявки менять нельзя.")
            try:
                imported = preview_csv(record["application"], filename, content, now)
            except (ValueError, csv.Error) as exc:
                raise ProcessError("invalid_csv", str(exc), 422) from None
            record["imports"] = [*record.get("imports", []), imported][-5:]
            event(record, "document_imported", now, import_id=imported["import_id"], status=imported["status"])
        return self.process.change(application_id, version, inspect)

    def edit_import(self, application_id, version, import_id, revision, monthly):
        def correct(record, now):
            if record["state"]["status"] not in EDITABLE_STATES:
                raise ProcessError("import_not_editable", "Финансовые данные завершённой заявки не меняются.")
            imported = next((item for item in record.get("imports", []) if item["import_id"] == import_id), None)
            if not imported or imported["status"] == "applied":
                raise ProcessError("import_not_editable", "Этот импорт недоступен для исправления.")
            if imported["application_version"] != version or imported.get("revision", 1) != revision:
                raise ProcessError("import_stale", "Предпросмотр изменился. Загрузите актуальные данные.")
            output = StringIO()
            writer = csv.DictWriter(output, fieldnames=HEADERS)
            writer.writeheader()
            for row in monthly:
                if set(row) != set(HEADERS) or any(not isinstance(value, str) for value in row.values()):
                    raise ProcessError("invalid_import_row", "Нужны месяц и три денежные строки.", 422)
                writer.writerow(row)
            try:
                corrected = preview_csv(record["application"], imported["filename"], output.getvalue(), now)
            except (ValueError, csv.Error) as exc:
                raise ProcessError("invalid_csv", str(exc), 422) from None
            source = imported.get("source_rows", imported["rows"])
            imported.update(rows=corrected["rows"], issues=corrected["issues"], period=corrected["period"],
                            status=corrected["status"], revision=revision+1, reviewed_values_sha256=corrected["sha256"])
            for index, row in enumerate(imported["rows"]):
                row["source_line"] = source[index]["line"] if index < len(source) else None
                row["source_values"] = source[index]["values"] if index < len(source) else None
            event(record, "import_corrected", now, import_id=import_id, revision=revision+1)
        return self.process.change(application_id, version, correct)

    def confirm_import(self, application_id, version, import_id, revision):
        def apply(record, now):
            imported = next((item for item in record.get("imports", []) if item["import_id"] == import_id), None)
            if not imported:
                raise ProcessError("import_not_found", "Импорт не найден.", 404)
            if imported["status"] != "ready":
                raise ProcessError("import_not_ready", "Исправьте файл перед подтверждением.")
            if imported["application_version"] != version:
                raise ProcessError("import_stale", "Данные изменились. Загрузите файл заново для сравнения.")
            if imported.get("revision", 1) != revision:
                raise ProcessError("import_stale", "Предпросмотр файла изменился. Проверьте актуальную редакцию.")
            values = [row["values"] for row in imported["rows"]]
            self.process.patch_record(record, {"financials.monthly": values}, now)
            imported["status"] = "applied"
            imported["applied_version"] = record["application"]["application_version"]
            event(record, "import_confirmed", now, import_id=import_id, filename=imported["filename"], sha256=imported["sha256"])
        return self.process.change(application_id, version, apply)
