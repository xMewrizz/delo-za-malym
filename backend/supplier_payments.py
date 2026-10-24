"""Оплата конкретного счёта поставщика в банковском симуляторе."""

from datetime import timedelta
from decimal import Decimal
import json
from uuid import uuid4

from credit_engine.revolving import local_date, money
from .overdrafts import account_version, append, overdraft_state, settlement_cash
from .portfolio import belongs_to_client, calendar_data, refinanced_loans
from .service import ProcessError
from . import demo

ZERO = Decimal("0.00")
PAYMENT_KINDS = {"loan_payment", "loan_final_payment", "existing_loan_payment", "line_interest", "line_final_payment", "overdraft_payment_due"}


def validate_requisites(request):
    inn = [int(digit) for digit in request.recipient_inn]
    weights = ([2, 4, 10, 3, 5, 9, 4, 6, 8],) if len(inn) == 10 else (
        [7, 2, 4, 10, 3, 5, 9, 4, 6, 8], [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8])
    if not any(inn) or any(sum(a * b for a, b in zip(inn, row)) % 11 % 10 != inn[len(row)] for row in weights):
        raise ValueError("Проверьте ИНН получателя: не сходятся контрольные цифры.")
    account, bik = request.recipient_account, request.recipient_bik
    if not account.startswith("40") or not bik.startswith("04") or sum(int(d) * [7, 1, 3][i % 3] for i, d in enumerate(bik[-3:] + account)) % 10:
        raise ValueError("Проверьте расчётный счёт и БИК получателя.")
    if len(request.recipient_name.strip()) < 2 or len(request.purpose.strip()) < 5:
        raise ValueError("Укажите получателя и назначение платежа.")


class SupplierPayments:
    def __init__(self, process):
        self.process = process

    def state(self, connection, overdraft_id=None):
        records = self.process.store.records(connection)
        payments = self.process.store.account_payments(connection)
        today = local_date(self.process.clock())
        limits = [state for record in records if belongs_to_client(record)
                  if (state := overdraft_state(record, today))]
        limits.sort(key=lambda item: (-Decimal(item["available_limit"]), item["application_id"]))
        selected = next((item for item in limits if item["application_id"] == overdraft_id), None) if overdraft_id else next((item for item in limits if Decimal(item["available_limit"]) > 0), None)
        if overdraft_id and not selected:
            raise ProcessError("overdraft_not_found", "Выбранный овердрафт недоступен. Обновите продукты.", 404)
        return {"cash_balance": money(settlement_cash(records, self.process.clock(), payments)),
                "account_version": account_version(records, payments), "today": today.isoformat(),
                "overdraft": selected, "payments": list(reversed(payments))}

    def get(self, overdraft_id=None):
        with self.process.store.connect() as connection:
            return self.state(connection, overdraft_id)

    def projection(self, connection, request):
        state = self.state(connection, request.overdraft_application_id)
        if request.base_account_version != state["account_version"]:
            raise ProcessError("account_version_conflict", "Остаток или лимит изменился. Проверьте платёж ещё раз.")
        amount, cash = Decimal(request.amount), Decimal(state["cash_balance"])
        need = max(ZERO, amount - cash)
        limit = state["overdraft"]
        available = Decimal(limit["available_limit"]) if limit else ZERO
        drawn = min(need, available)
        shortfall = need - drawn
        cash_after = max(ZERO, cash - amount)
        now = self.process.clock()
        today, until = local_date(now), local_date(now) + timedelta(days=30)
        records = self.process.store.records(connection)
        events = calendar_data(records, now)["events"]
        profile, _ = demo.profile(now)
        closed = refinanced_loans(records)
        for loan in profile["financials"].get("existing_loans", []):
            if loan.get("application_id") or loan["loan_id"] in closed:
                continue
            for row in loan.get("schedule", []):
                events.append({"date": row["date"], "amount": row["total_payment"], "forecast": True,
                               "kind": "existing_loan_payment", "title": "Платёж по действующему кредиту"})
        repay_by = min(limit["maturity_date"], limit["repay_by"] or (today + timedelta(days=limit["max_debt_days"])).isoformat()) if drawn else None
        if drawn:
            from datetime import date
            days = max(0, (date.fromisoformat(repay_by) - today).days)
            extra_due = drawn + drawn * Decimal(limit["annual_rate_percent"]) / 100 * days / 365
            existing = next((item for item in events if item["kind"] == "overdraft_payment_due" and item.get("application_id") == limit["application_id"]), None)
            if existing:
                existing["amount"] = money(Decimal(existing["amount"]) + extra_due)
            else:
                events.append({"date": repay_by, "amount": money(extra_due), "forecast": True,
                               "kind": "overdraft_payment_due", "title": "Вернуть овердрафт с процентами"})
        upcoming = sorted([{"date": item["date"], "amount": item["amount"], "title": item["title"]}
                           for item in events if item["forecast"] and item["kind"] in PAYMENT_KINDS and item["date"] <= until.isoformat()],
                          key=lambda item: item["date"])
        total = sum((Decimal(item["amount"]) for item in upcoming), ZERO)
        return {"amount": money(amount), "own_money": money(min(cash, amount)), "overdraft_used": money(drawn),
                "shortfall": money(shortfall), "can_pay": shortfall == 0, "cash_after": money(cash_after),
                "upcoming_payments": upcoming, "upcoming_total": money(total), "upcoming_until": until.isoformat(),
                "cash_after_upcoming": money(cash_after - total), "account_version": state["account_version"],
                "calculated_on": today.isoformat(), "overdraft_application_id": limit["application_id"] if drawn else None,
                "overdraft_rate": limit["annual_rate_percent"] if drawn else None,
                "overdraft_daily_interest": money((drawn + Decimal(limit["principal"])) * Decimal(limit["annual_rate_percent"]) / 100 / 365) if drawn else "0.00",
                "overdraft_repay_by": repay_by,
                "mode": "simulated"}

    def preview(self, request):
        with self.process.store.connect() as connection:
            return self.projection(connection, request)

    def operate(self, request):
        payload = request.model_dump(mode="json", exclude={"base_account_version", "request_id", "calculated_on", "confirmed"})
        now = self.process.clock()
        with self.process.store.connect(write=True) as connection:
            row = connection.execute("SELECT payload FROM account_payments WHERE request_id=?", (str(request.request_id),)).fetchone()
            if row:
                previous = json.loads(row[0])
                if previous["request"] != payload:
                    raise ProcessError("payment_request_conflict", "Этот запрос уже выполнен с другими реквизитами.")
                return previous
            if request.calculated_on != local_date(now):
                raise ProcessError("payment_quote_expired", "Дата изменилась. Проверьте платёж ещё раз.")
            quote = self.projection(connection, request)
            if not quote["can_pay"]:
                raise ProcessError("insufficient_cash", "Для оплаты не хватает денег. Пополните счёт или подберите финансирование.", 422)
            identifier = str(uuid4())
            drawn, amount = Decimal(quote["overdraft_used"]), Decimal(request.amount)
            if drawn:
                record = self.process.store.get(connection, quote["overdraft_application_id"])
                append(record, now, "expense", amount, drawn=drawn, cash_delta=drawn - amount,
                       supplier_payment_id=identifier, purpose="supplier", recipient=payload)
                self.process.store.save(connection, record)
            receipt = {"payment_id": identifier, "request_id": str(request.request_id), "request": payload,
                       "date": local_date(now).isoformat(), "created_at": now.isoformat(), "quote": quote,
                       "cash_delta": "0.00" if drawn else money(-amount), "mode": "simulated"}
            connection.execute("INSERT INTO account_payments(request_id,payload) VALUES (?,?)",
                               (str(request.request_id), json.dumps(receipt, ensure_ascii=False)))
            self.process.sync_portfolio(connection)
            return receipt
