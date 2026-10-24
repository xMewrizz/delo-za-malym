"""Фактические расходы расчётного счёта и автопогашение овердрафта симулятора."""

from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal
import hashlib
import json
from uuid import uuid4

from credit_engine.revolving import add_months, local_date, money
from . import demo
from .portfolio import belongs_to_client, calendar_date, cash_disbursed
from .service import ProcessError, event

ZERO = Decimal("0.00")


def contract(record):
    """Старые подписанные лимиты читаются без изменения их истории."""
    completion = record.get("completion") or {}
    if completion.get("product_id") != "overdraft" or completion.get("type") != "limit_opening":
        return None
    if completion.get("overdraft_account"):
        return completion["overdraft_account"]
    offer = next((offer for offer in (record.get("result") or {}).get("assessment", {}).get("offers", [])
                  if offer["offer_id"] == completion.get("offer_id")), None)
    if not offer or not offer.get("annual_rate_percent"):
        return None
    opened = date.fromisoformat(calendar_date(completion["completed_at"]))
    return {"limit": completion["amount"], "annual_rate_percent": offer["annual_rate_percent"],
            "opened_at": opened.isoformat(), "maturity_date": add_months(opened, offer.get("agreement_months", 12)).isoformat(),
            "max_debt_days": offer.get("max_debt_days", 60), "version": 1, "operations": []}


def overdraft_state(record, today):
    account = contract(record)
    if account is None:
        return None
    principal, interest, started = ZERO, ZERO, None
    previous = date.fromisoformat(account["opened_at"])
    rate = Decimal(account["annual_rate_percent"])
    for operation in account["operations"]:
        day = date.fromisoformat(operation["date"])
        if day > today:
            break
        interest += principal * rate / 100 * Decimal((day - previous).days) / 365
        principal += Decimal(operation.get("drawn", "0")) - Decimal(operation.get("principal_paid", "0"))
        interest -= Decimal(operation.get("interest_paid", "0"))
        if principal > 0 and started is None:
            started = day
        elif principal == 0:
            started = None
        previous = day
    interest = max(ZERO, Decimal(money(interest + principal * rate / 100 * Decimal((today - previous).days) / 365)))
    maturity = date.fromisoformat(account["maturity_date"])
    deadline = min(maturity, started + timedelta(days=account["max_debt_days"])) if started else maturity
    blocked = today >= maturity or bool(started and today >= deadline)
    available = ZERO if blocked else max(ZERO, Decimal(account["limit"]) - principal)
    return {"application_id": record["application"]["application_id"], "version": account["version"],
            "limit": account["limit"], "available_limit": money(available), "principal": money(principal),
            "accrued_interest": money(interest), "amount_to_repay": money(principal + interest),
            "annual_rate_percent": account["annual_rate_percent"], "interest_per_day": money(principal * rate / 100 / 365),
            "maturity_date": maturity.isoformat(), "repay_by": deadline.isoformat() if principal or interest else None,
            "max_debt_days": account["max_debt_days"], "blocked": blocked,
            "status": "expired" if today >= maturity else "overdue" if blocked else "active", "today": today.isoformat(),
            "operations": deepcopy(account["operations"]), "mode": "simulated"}


def settlement_cash(records, now, payments=()):
    profile, _ = demo.profile(now)
    return Decimal(profile["financials"].get("cash_balance") or "0") + cash_disbursed(records, payments)


def account_version(records, payments=()):
    # Учитываем все фактические проводки счёта, включая выдачи и платежи других продуктов.
    value = [(record["application"]["application_id"], record.get("completion")) for record in records if belongs_to_client(record) and record.get("completion")]
    return hashlib.sha256(json.dumps([sorted(value), list(payments)], sort_keys=True).encode()).hexdigest()


def append(record, now, kind, amount, *, drawn=ZERO, principal_paid=ZERO, interest_paid=ZERO, cash_delta=ZERO, **extra):
    account = record["completion"].setdefault("overdraft_account", contract(record))
    operation = {"operation_id": str(uuid4()), "kind": kind, "amount": money(amount), "date": local_date(now).isoformat(),
                 "created_at": now.isoformat(), "drawn": money(drawn), "principal_paid": money(principal_paid),
                 "interest_paid": money(interest_paid), "cash_delta": money(cash_delta), **extra}
    account["operations"].append(operation)
    account["version"] += 1
    event(record, "overdraft_" + kind, now, amount=money(amount), mode="simulated")
    return operation


def sweep(process, connection):
    """Любые реальные зачисления погашают долг; прогнозы не создают проводок."""
    records = process.store.records(connection)
    cash = settlement_cash(records, process.clock(), process.store.account_payments(connection))
    if cash <= 0:
        return
    now = process.clock()
    for record in sorted(records, key=lambda record: ((record.get("completion") or {}).get("completed_at", ""), record["application"]["application_id"])):
        if not belongs_to_client(record):
            continue
        state = overdraft_state(record, local_date(now))
        if not state or not Decimal(state["amount_to_repay"]):
            continue
        paid = min(cash, Decimal(state["amount_to_repay"]))
        interest = min(paid, Decimal(state["accrued_interest"]))
        append(record, now, "auto_repayment", paid, principal_paid=paid - interest, interest_paid=interest, cash_delta=-paid)
        process.store.save(connection, record)
        cash -= paid
        if cash <= 0:
            break


class Overdrafts:
    def __init__(self, process):
        self.process = process

    def load(self, connection, identifier):
        record = self.process.store.get(connection, identifier)
        if not record or not belongs_to_client(record) or contract(record) is None:
            raise ProcessError("overdraft_not_found", "Открытый овердрафт не найден.", 404)
        return record

    def public(self, record, records, payments=()):
        state = overdraft_state(record, local_date(self.process.clock()))
        state.update(cash_balance=money(settlement_cash(records, self.process.clock(), payments)), account_version=account_version(records, payments))
        return state

    def get(self, identifier):
        with self.process.store.connect() as connection:
            return self.public(self.load(connection, identifier), self.process.store.records(connection), self.process.store.account_payments(connection))

    def projection(self, record, records, request, payments=()):
        state = self.public(record, records, payments)
        if request.base_account_version != state["account_version"]:
            raise ProcessError("account_version_conflict", "Остаток или долг изменился. Обновите расчёт.")
        amount, cash = Decimal(request.amount), Decimal(state["cash_balance"])
        drawn = max(ZERO, amount - cash) if request.kind == "expense" else ZERO
        if request.kind == "expense" and drawn > Decimal(state["available_limit"]):
            raise ProcessError("overdraft_unavailable", "Не хватает денег и доступного лимита. Уменьшите платёж или пополните счёт.", 422)
        receipt_cash = cash + amount if request.kind == "receipt" else max(ZERO, cash - amount)
        allocations = []
        for item in sorted(records, key=lambda item: ((item.get("completion") or {}).get("completed_at", ""), item["application"]["application_id"])):
            debt = overdraft_state(item, local_date(self.process.clock())) if belongs_to_client(item) else None
            if not debt or receipt_cash <= 0:
                continue
            paid = min(receipt_cash, Decimal(debt["amount_to_repay"]))
            interest = min(paid, Decimal(debt["accrued_interest"]))
            if paid:
                allocations.append({"application_id": debt["application_id"], "principal_paid": money(paid - interest), "interest_paid": money(interest)})
            receipt_cash -= paid
        own = next((item for item in allocations if item["application_id"] == state["application_id"]), {})
        return {"kind": request.kind, "amount": money(amount), "purpose": request.purpose,
                "own_money": money(min(cash, amount)) if request.kind == "expense" else "0.00", "overdraft_used": money(drawn),
                "principal_paid": money(sum((Decimal(item["principal_paid"]) for item in allocations), ZERO)),
                "interest_paid": money(sum((Decimal(item["interest_paid"]) for item in allocations), ZERO)), "allocations": allocations,
                "cash_after": money(receipt_cash), "principal_after": money(Decimal(state["principal"]) + drawn - Decimal(own.get("principal_paid", "0"))),
                "available_after": money(max(ZERO, Decimal(state["limit"]) - Decimal(state["principal"]) - drawn + Decimal(own.get("principal_paid", "0")))) if not state["blocked"] else "0.00",
                "account_version": state["account_version"], "calculated_on": state["today"]}

    def preview(self, identifier, request):
        with self.process.store.connect() as connection:
            return self.projection(self.load(connection, identifier), self.process.store.records(connection), request, self.process.store.account_payments(connection))

    def operate(self, identifier, request):
        now = self.process.clock()
        fingerprint = {"kind": request.kind, "amount": request.amount, "purpose": request.purpose}
        with self.process.store.connect(write=True) as connection:
            record = self.load(connection, identifier)
            prior = next((item for item in contract(record)["operations"] if item.get("request_id") == str(request.request_id)), None)
            if prior:
                if prior["request"] != fingerprint:
                    raise ProcessError("overdraft_request_conflict", "Этот запрос уже выполнен с другими параметрами.")
                return {"state": self.public(record, self.process.store.records(connection), self.process.store.account_payments(connection)), "receipt": prior["receipt"]}
            if request.calculated_on != local_date(now):
                raise ProcessError("overdraft_quote_expired", "Дата расчёта изменилась. Рассчитайте операцию ещё раз.")
            receipt = self.projection(record, self.process.store.records(connection), request, self.process.store.account_payments(connection))
            amount, drawn = Decimal(request.amount), Decimal(receipt["overdraft_used"])
            append(record, now, request.kind, amount, drawn=drawn, cash_delta=drawn - amount if request.kind == "expense" else amount,
                   request_id=str(request.request_id), request=fingerprint, receipt=receipt, purpose=request.purpose)
            self.process.store.save(connection, record)
            self.process.sync_portfolio(connection)
            record = self.load(connection, identifier)
            return {"state": self.public(record, self.process.store.records(connection), self.process.store.account_payments(connection)), "receipt": receipt}
