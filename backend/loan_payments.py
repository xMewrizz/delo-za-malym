"""Досрочные платежи выданных кредитов в локальном банковском симуляторе."""

from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from credit_engine.loans import calculate_loan
from credit_engine.revolving import local_date
from .portfolio import calendar_date, belongs_to_client
from .service import ProcessError, event

ZERO = Decimal("0.00")


def money(value):
    return f'{value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP):.2f}'


def loan_schedule(completion):
    return (completion.get("servicing") or {}).get("schedule", completion.get("schedule") or [])


def loan_principal(completion):
    return (completion.get("servicing") or {}).get("principal", completion["amount"])


def earned_interest(completion, principal, start, end, rate):
    """Месячная ставка договора, внутри периода — пропорционально его дням."""
    total, previous = ZERO, date.fromisoformat(calendar_date(completion["completed_at"]))
    for row in completion["schedule"]:
        due = date.fromisoformat(row["date"])
        days = (min(due, end) - max(previous, start)).days
        if days > 0:
            total += principal * rate / 1200 * Decimal(days) / Decimal((due - previous).days)
        previous = due
        if due >= end:
            break
    if end > previous:
        # После срока — простое начисление, без капитализации и без выдуманных пеней.
        total += principal * rate / 100 * Decimal((end - max(previous, start)).days) / 365
    return Decimal(money(total))


def current_state(record, today):
    completion = record["completion"]
    servicing = completion.get("servicing") or {}
    offer = next((item for item in (record.get("result") or {}).get("assessment", {}).get("offers", [])
                  if item["offer_id"] == completion["offer_id"]), None)
    if not offer or not offer.get("annual_rate_percent"):
        raise ProcessError("loan_terms_missing", "Не удалось найти ставку подписанного предложения.", 422)
    principal = Decimal(loan_principal(completion))
    rate = Decimal(offer["annual_rate_percent"])
    start = date.fromisoformat(servicing.get("interest_date") or calendar_date(completion["completed_at"]))
    interest = Decimal(servicing.get("accrued_interest", "0.00")) + earned_interest(completion, principal, start, today, rate)
    return {"application_id": record["application"]["application_id"], "version": servicing.get("version", 1),
            "principal": money(principal), "original_amount": completion["amount"], "accrued_interest": money(interest),
            "amount_to_close": money(principal + interest), "annual_rate_percent": money(rate),
            "status": "closed" if servicing.get("closed_at") else "active", "today": today.isoformat(),
            "schedule": deepcopy(loan_schedule(completion)), "operations": deepcopy(servicing.get("operations", [])),
            "orders": deepcopy(servicing.get("orders", [])),
            "mode": "simulated", "strategy": "reduce_payment_keep_dates"}


def reduced_schedule(completion, principal, interest, today, rate, strategy="reduce_payment"):
    dates = [row for row in loan_schedule(completion) if row["date"] >= today.isoformat()]
    if not principal and not interest:
        return []
    if not dates:
        return [{"date": today.isoformat(), "total_payment": money(principal + interest),
                 "principal_payment": money(principal), "interest_payment": money(interest), "closing_balance": "0.00"}]
    grace_dates = {row["date"] for row in completion["schedule"] if Decimal(row.get("principal_payment", "0")) == 0}
    grace = sum(row["date"] in grace_dates for row in dates)
    term = max(1, len(dates) - grace)
    monthly = Decimal(calculate_loan(money(principal), term, money(rate)).to_dict()["calculation"]["monthly_payment"]) if principal else ZERO
    if strategy == "reduce_term":
        monthly = max((Decimal(row["total_payment"]) for row in dates
                       if row["date"] not in grace_dates), default=monthly)
    result, previous = [], today
    for index, row in enumerate(dates):
        due = date.fromisoformat(row["date"])
        charge = earned_interest(completion, principal, previous, due, rate) + (interest if index == 0 else ZERO)
        paid = principal if index == len(dates) - 1 else min(principal, max(ZERO, monthly - charge)) if row["date"] not in grace_dates else ZERO
        opening = principal
        principal -= paid
        result.append({"date": row["date"], "month_number": index + 1, "opening_balance": money(opening),
                       "principal_payment": money(paid), "interest_payment": money(charge),
                       "total_payment": money(paid + charge), "closing_balance": money(principal)})
        previous = due
        if not principal:
            break
    return [row for row in result if Decimal(row["total_payment"]) > 0]


class LoanPayments:
    def __init__(self, process):
        self.process = process

    def load(self, connection, identifier):
        record = self.process.store.get(connection, identifier)
        completion = (record or {}).get("completion") or {}
        if not record or not belongs_to_client(record) or completion.get("type") != "disbursement" or not completion.get("schedule"):
            raise ProcessError("loan_not_found", "Выданный в кабинете кредит не найден.", 404)
        from .portfolio import refinanced_loans, PREFIX
        if completion.get("refinanced_by") or PREFIX + completion["operation_id"] in refinanced_loans(self.process.store.records(connection)):
            raise ProcessError("loan_refinanced", "Кредит уже погашен рефинансированием.")
        return record

    def get(self, identifier):
        with self.process.store.connect() as connection:
            return current_state(self.load(connection, identifier), local_date(self.process.clock()))

    def projection(self, record, request, *, executing=False):
        today = local_date(self.process.clock())
        execution = request.execution_date or today
        if not today <= execution <= today + timedelta(days=366):
            raise ProcessError("loan_invalid_date", "Выберите дату от сегодня до года вперёд.", 422)
        state = current_state(record, execution)
        if request.base_loan_version != state["version"]:
            raise ProcessError("loan_version_conflict", "Кредит уже изменился. Обновите расчёт платежа.")
        if not executing and any(order["status"] == "pending" for order in state["orders"]):
            raise ProcessError("loan_order_pending", "По кредиту уже запланирован платёж. Отмените его или дождитесь исполнения.")
        amount = Decimal(request.amount)
        if request.full_repayment:
            if executing and amount != Decimal(state["amount_to_close"]):
                raise ProcessError("loan_close_amount_changed", "Сумма полного погашения изменилась. Нужен новый расчёт и подтверждение.")
            amount = Decimal(state["amount_to_close"])
        if state["status"] == "closed" or amount > Decimal(state["amount_to_close"]):
            raise ProcessError("loan_overpayment", "Сумма превышает текущий долг с начисленными процентами.", 422)
        interest_paid = min(amount, Decimal(state["accrued_interest"]))
        principal_paid = amount - interest_paid
        principal = Decimal(state["principal"]) - principal_paid
        interest = Decimal(state["accrued_interest"]) - interest_paid
        original = state["schedule"]
        nearest = original[0] if original else None
        if request.payment_kind == "regular":
            if not nearest or execution.isoformat() < nearest["date"]:
                raise ProcessError("loan_regular_date", "Платёж по графику исполняется в дату платежа или позже. Для списания раньше выберите досрочное погашение.", 422)
            expected = Decimal(nearest["principal_payment"]) + Decimal(state["accrued_interest"])
            if amount != expected:
                raise ProcessError("loan_regular_amount", "Сумма платежа по графику изменилась. Обновите расчёт.", 409)
            schedule = deepcopy(original[1:])
            # При оплате с задержкой проценты до фактической даты уже уплачены:
            # следующие периоды не должны начислять эти дни повторно.
            balance, previous = principal, execution
            for row in schedule:
                due = max(previous, date.fromisoformat(row["date"]))
                charge = earned_interest(record["completion"], balance, previous, due, Decimal(state["annual_rate_percent"]))
                paid = Decimal(row["principal_payment"])
                row.update(opening_balance=money(balance), interest_payment=money(charge), total_payment=money(paid + charge))
                balance -= paid
                row["closing_balance"] = money(balance)
                previous = due
        else:
            # Не переносим просроченные обязательства в будущее при частичном погашении.
            if nearest and nearest["date"] < execution.isoformat() and principal + interest:
                raise ProcessError("loan_overdue", "Сначала оплатите просроченный платёж по графику. Затем можно изменить срок или сумму платежей.", 422)
            schedule = reduced_schedule(record["completion"], principal, interest, execution,
                                        Decimal(state["annual_rate_percent"]), request.strategy)
        cash = Decimal(self.process.profile()["financials"].get("cash_balance") or "0")
        old_interest = sum((Decimal(row["interest_payment"]) for row in original), ZERO)
        new_interest = interest_paid + sum((Decimal(row["interest_payment"]) for row in schedule), ZERO)
        mandatory = next((row for row in schedule if nearest and row["date"] == nearest["date"]), None)
        return {"amount": money(amount), "principal_paid": money(principal_paid), "interest_paid": money(interest_paid),
                "remaining_principal": money(principal), "remaining_interest": money(interest),
                "cash_after": money(cash - amount), "can_pay": cash >= amount, "schedule": schedule,
                "base_loan_version": state["version"], "calculated_on": today.isoformat(), "mode": "simulated",
                "execution_date": execution.isoformat(), "payment_kind": request.payment_kind, "strategy": request.strategy,
                "full_repayment": request.full_repayment,
                "mandatory_date": nearest["date"] if nearest else None,
                "mandatory_before": nearest["total_payment"] if nearest else "0.00",
                "mandatory_after": mandatory["total_payment"] if mandatory else "0.00",
                "interest_saving": money(max(ZERO, old_interest - new_interest)),
                "maturity_before": original[-1]["date"] if original else None,
                "maturity_after": schedule[-1]["date"] if schedule else execution.isoformat(),
                "next_payment": schedule[0] if schedule else None}

    def preview(self, identifier, request):
        with self.process.store.connect() as connection:
            return self.projection(self.load(connection, identifier), request)

    def pay(self, identifier, request):
        now = self.process.clock()
        with self.process.store.connect(write=True) as connection:
            record = self.load(connection, identifier)
            completion = record["completion"]
            servicing = completion.get("servicing") or {"version": 1, "operations": []}
            previous = next((op for op in servicing.get("orders", []) + servicing["operations"] if op["request_id"] == str(request.request_id)), None)
            if previous:
                if (previous["amount"] != request.amount
                    or previous.get("payment_kind", "early") != request.payment_kind
                    or previous.get("strategy", "reduce_payment") != request.strategy
                    or previous.get("execution_date", previous.get("date")) != (request.execution_date or request.calculated_on).isoformat()):
                    raise ProcessError("loan_request_conflict", "Этот запрос уже выполнен с другой суммой.")
                return current_state(record, local_date(now))
            if request.calculated_on != local_date(now):
                raise ProcessError("loan_quote_expired", "Наступил новый день. Пересчитайте платёж с актуальными процентами.")
            projection = self.projection(record, request)
            if request.amount != projection["amount"]:
                raise ProcessError("loan_quote_changed", "Подтвердите точную сумму из нового расчёта.")
            if projection["execution_date"] > local_date(now).isoformat():
                servicing.setdefault("orders", []).append({"order_id": str(uuid4()), "request_id": str(request.request_id),
                    "amount": request.amount, "execution_date": projection["execution_date"], "payment_kind": request.payment_kind,
                    "strategy": request.strategy, "full_repayment": request.full_repayment, "status": "pending", "created_at": now.isoformat()})
                servicing["version"] += 1
                completion["servicing"] = servicing
                event(record, "loan_payment_scheduled", now, amount=request.amount, mode="simulated")
                self.process.store.save(connection, record)
                return current_state(record, local_date(now))
            if not projection["can_pay"]:
                raise ProcessError("insufficient_cash", "На счёте недостаточно денег для платежа.", 422)
            self.apply(record, servicing, projection, request, now)
            self.process.store.save(connection, record)
            self.process.sync_portfolio(connection)
        return current_state(record, local_date(now))

    @staticmethod
    def apply(record, servicing, projection, request, now):
        servicing.update(version=servicing["version"] + 1, principal=projection["remaining_principal"],
                             accrued_interest=projection["remaining_interest"], interest_date=projection["calculated_on"],
                             schedule=projection["schedule"], closed_at=projection["calculated_on"] if not projection["schedule"] else None)
        servicing["operations"].append({"operation_id": str(uuid4()), "request_id": str(request.request_id),
                "date": projection["calculated_on"], "amount": request.amount, "principal_paid": projection["principal_paid"],
                "interest_paid": projection["interest_paid"], "payment_kind": request.payment_kind,
                "strategy": request.strategy, "execution_date": projection["execution_date"]})
        record["completion"]["servicing"] = servicing
        event(record, "loan_payment", now, amount=request.amount, mode="simulated")

    def cancel(self, identifier, order_id, request):
        with self.process.store.connect(write=True) as connection:
            record = self.load(connection, identifier)
            ledger = record["completion"].get("servicing") or {}
            order = next((item for item in ledger.get("orders", []) if item["order_id"] == order_id), None)
            if not order:
                raise ProcessError("loan_order_missing", "Запланированный платёж не найден.", 404)
            if order["status"] == "cancelled":
                return current_state(record, local_date(self.process.clock()))
            if ledger["version"] != request.base_loan_version or order["status"] != "pending":
                raise ProcessError("loan_version_conflict", "Запланированный платёж уже изменился. Обновите данные.")
            order["status"] = "cancelled"
            ledger["version"] += 1
            self.process.store.save(connection, record)
        return current_state(record, local_date(self.process.clock()))

    def execute_due(self):
        """Запланированные платежи исполняются фоновым обработчиком и перед API-запросом."""
        from .models import LoanPaymentRequest
        today = local_date(self.process.clock())
        with self.process.store.connect() as connection:
            pending = [(record["application"]["application_id"], order["order_id"])
                       for record in self.process.store.records(connection) if belongs_to_client(record)
                       for order in ((record.get("completion") or {}).get("servicing") or {}).get("orders", [])
                       if order["status"] == "pending" and order["execution_date"] <= today.isoformat()]
        for identifier, order_id in pending:
            with self.process.store.connect(write=True) as connection:
                record = self.process.store.get(connection, identifier)
                servicing = record["completion"]["servicing"]
                order = next(item for item in servicing["orders"] if item["order_id"] == order_id)
                if order["status"] != "pending":
                    continue
                try:
                    self.load(connection, identifier)
                    request = LoanPaymentRequest(amount=order["amount"], base_loan_version=servicing["version"],
                        execution_date=today, calculated_on=today, request_id=order["request_id"], confirmed=True,
                        payment_kind=order["payment_kind"], strategy=order["strategy"], full_repayment=order.get("full_repayment", False))
                    projection = self.projection(record, request, executing=True)
                    if not projection["can_pay"]:
                        raise ProcessError("insufficient_cash", "Недостаточно денег на счёте.", 422)
                    self.apply(record, servicing, projection, request, self.process.clock())
                    order.update(status="executed", executed_on=today.isoformat())
                except ProcessError as error:
                    order.update(status="failed", error=error.message)
                    servicing["version"] += 1
                self.process.store.save(connection, record)
                self.process.sync_portfolio(connection)
