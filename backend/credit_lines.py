"""Подтверждённые выборки и платежи возобновляемой линии в банковском симуляторе."""

from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

from credit_engine.revolving import PRODUCT, line_state, line_schedule, local_date, money
from .service import ProcessError, event


class CreditLines:
    def __init__(self, process):
        self.process = process

    def load(self, connection, identifier):
        record = self.process.store.get(connection, identifier)
        completion = (record or {}).get("completion") or {}
        if completion.get("product_id") != PRODUCT or not completion.get("credit_line"):
            raise ProcessError("line_not_found", "Открытая кредитная линия не найдена.", 404)
        return record, completion["credit_line"]

    def public(self, record, line):
        now = local_date(self.process.clock())
        return {"application_id": record["application"]["application_id"], **line_state(line, now),
            "schedule": line_schedule(line, now), "operations": deepcopy(line["operations"]), "mode": "simulated"}

    def get(self, identifier):
        with self.process.store.connect() as connection:
            record, line = self.load(connection, identifier)
        return self.public(record, line)

    def operate(self, identifier, request):
        now = self.process.clock()
        today = local_date(now)
        fingerprint = {"kind": request.kind, "amount": request.amount}
        with self.process.store.connect(write=True) as connection:
            record, line = self.load(connection, identifier)
            previous = next((op for op in line["operations"] if op.get("request_id") == str(request.request_id)), None)
            if previous:
                if previous["request"] != fingerprint:
                    raise ProcessError("line_request_conflict", "Этот запрос уже выполнен с другими параметрами.")
                return self.public(record, line)
            if line["version"] != request.base_line_version:
                raise ProcessError("line_version_conflict", "Линия уже изменилась. Обновите данные.")
            state = line_state(line, today)
            if line.get("closed_at"):
                raise ProcessError("line_closed", "Линия закрыта; новые операции недоступны.")
            amount = Decimal(request.amount or "0")
            drawn, principal_paid, interest_paid = Decimal("0"), Decimal("0"), Decimal("0")
            if request.kind == "draw":
                if state["matured"] or state["overdue_interest"]:
                    raise ProcessError("line_draw_blocked", "Выборка недоступна: срок линии истёк либо нужно погасить просроченные проценты.")
                if amount > Decimal(state["available_limit"]):
                    raise ProcessError("line_limit_exceeded", "Сумма превышает доступный лимит.", 422)
                drawn = amount
            elif request.kind == "repay":
                if amount > Decimal(state["amount_to_close"]):
                    raise ProcessError("line_overpayment", "Платёж превышает долг с начисленными процентами.", 422)
                if amount > Decimal(self.process.profile()["financials"].get("cash_balance") or "0"):
                    raise ProcessError("insufficient_cash", "На счёте недостаточно денег для платежа.", 422)
                interest_paid = min(amount, Decimal(state["accrued_interest"]))
                principal_paid = amount - interest_paid
            else:
                if Decimal(state["amount_to_close"]):
                    raise ProcessError("line_has_debt", "Перед закрытием погасите основной долг и проценты.", 422)
                line["closed_at"] = today.isoformat()
            if request.kind == "draw" and len(line["operations"]) >= 500:
                raise ProcessError("line_operation_limit", "Достигнут предел операций для новых выборок демонстрационной линии. Погашение и закрытие доступны.", 422)
            line["version"] += 1
            line["operations"].append({"operation_id": str(uuid4()), "request_id": str(request.request_id), "request": fingerprint,
                "kind": request.kind, "amount": money(amount), "date": today.isoformat(), "created_at": now.isoformat(),
                "drawn": money(drawn), "principal_paid": money(principal_paid), "interest_paid": money(interest_paid)})
            event(record, "credit_line_" + request.kind, now, amount=money(amount), mode="simulated")
            self.process.store.save(connection, record)
            self.process.sync_portfolio(connection)
        return self.public(record, line)
