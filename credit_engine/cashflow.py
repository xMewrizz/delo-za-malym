"""Даты платежей и остаток по явно заданному плану, без прогноза оборотов."""

from calendar import monthrange
from copy import deepcopy
from datetime import date, timedelta, timezone
from decimal import Decimal

from .overdraft import calculate_overdraft
from .overdraft_assessment import validate_debt_payments

ZERO = Decimal("0.00")
MOSCOW = timezone(timedelta(hours=3))


def payment_calendar(schedule, funding_date):
    """Сохранять исходный день месяца, включая 31 января → 28 февраля → 31 марта."""
    rows = []
    for payment in schedule:
        offset = funding_date.year * 12 + funding_date.month - 1 + payment["month_number"]
        year, month = divmod(offset, 12)
        month += 1
        due = date(year, month, min(funding_date.day, monthrange(year, month)[1]))
        rows.append({**deepcopy(payment), "date": due.isoformat()})
    return rows


def loan_cashflow(application, option, calculated_at, *, delay=None):
    today = calculated_at.astimezone(MOSCOW).date()
    need = application.get("need") or {}
    plan = deepcopy((application.get("product_details") or {}).get("overdraft"))
    requested_date = need.get("needed_by")
    if requested_date is not None and (not isinstance(requested_date, str) or date.fromisoformat(requested_date).isoformat() != requested_date):
        raise ValueError("Нужна дата получения в формате YYYY-MM-DD.")
    funding = max(today, date.fromisoformat(requested_date)) if requested_date else today
    if plan and not need.get("needed_by"):
        try:
            funding = max(funding, date.fromisoformat(plan["start_date"]))
        except (KeyError, ValueError, TypeError):
            pass
    calendar = payment_calendar(option["schedule"], funding)
    result = {"funding_date": funding.isoformat(), "schedule": calendar}
    result["cash_flow"] = simulate_loan_plan(application, plan, option, funding, calendar, today)
    if delay:
        if not isinstance(plan, dict) or not result["cash_flow"]["daily"]:
            raise ValueError("Для переноса поступления сначала дополните денежный план.")
        operation = next((row for row in plan.get("transactions", []) if row.get("transaction_id") == delay["transaction_id"]), None)
        if not operation or operation.get("direction") != "inflow":
            raise ValueError("Выберите существующее поступление.")
        previous_date = operation["date"]
        operation["date"] = (date.fromisoformat(previous_date) + timedelta(days=delay["days"])).isoformat()
        result["changes"] = [{"transaction_id": operation["transaction_id"], "before": previous_date, "after": operation["date"]}]
        result["scenario_cash_flow"] = simulate_loan_plan(application, plan, option, funding, calendar, today)
        # Период не расширяем молча: клиент должен проверить новые даты и обязательства.
        if operation["date"] <= plan["end_date"]:
            result["projected_plan"] = plan
    return result


def simulate_loan_plan(application, plan, option, funding, calendar, today):
    def incomplete(code, message):
        return {"status": "needs_information", "daily": [], "issues": [{"code": code, "message": message}]}
    if not plan:
        return incomplete("missing_cash_plan", "Добавьте поступления и расходы в денежный план, чтобы увидеть остаток после платежей.")
    if not isinstance(plan, dict):
        return incomplete("invalid_cash_plan", "Проверьте денежный план.")
    cash = (application.get("financials") or {}).get("cash_balance")
    if cash is None:
        return incomplete("missing_cash_balance", "Обновите остаток денег из данных банка.")
    plan = deepcopy(plan)
    plan["opening_cash_balance"] = cash
    # Оба продукта используют один формат плана. Берём только его валидацию,
    # овердрафтные проценты, выборки и погашения в расчёт кредита не входят.
    checked = calculate_overdraft(plan, option["amount"])
    if not checked.calculation:
        return {"status": checked.status, "daily": [], "issues": checked.to_dict()["issues"]}
    start, end = date.fromisoformat(plan["start_date"]), date.fromisoformat(plan["end_date"])
    if start < today:
        return incomplete("past_cash_plan", "Начните план с текущей или будущей даты: остаток получен из текущих данных банка.")
    if not start <= funding <= end:
        return incomplete("funding_outside_plan", "Период плана должен включать дату получения кредита.")
    issues = validate_debt_payments(plan, application["financials"].get("existing_loans", []), start, end)
    if issues:
        return {"status": "needs_information", "daily": [], "issues": [{"field": item.field, "code": item.code, "message": item.message} for item in issues]}
    operations = {}
    for row in plan["transactions"]:
        values = operations.setdefault(row["date"], {"inflow": ZERO, "outflow": ZERO})
        values[row["direction"]] += Decimal(row["amount"])
    payments = {row["date"]: row for row in calendar}
    funded_cash = baseline = Decimal(cash)
    principal = ZERO
    daily = []
    reserve = Decimal(plan["cash_reserve"])
    fees = Decimal(option.get("fees_total") or "0.00")
    for index in range((end - start).days + 1):
        day = start + timedelta(days=index)
        values = operations.get(day.isoformat(), {})
        inflow, outflow = values.get("inflow", ZERO), values.get("outflow", ZERO)
        received = Decimal(option["amount"]) if day == funding else ZERO
        paid_fee = fees if day == funding else ZERO
        payment = payments.get(day.isoformat(), {})
        principal_payment = Decimal(payment.get("principal_payment", "0.00"))
        interest = Decimal(payment.get("interest_payment", "0.00"))
        repayment = principal_payment + interest
        baseline += inflow - outflow
        funded_cash += inflow + received - outflow - repayment - paid_fee
        principal += received - principal_payment
        daily.append({"date": day.isoformat(), "inflow": str(inflow), "outflow": str(outflow),
                      "loan_received": str(received), "loan_payment": str(repayment), "loan_fees": str(paid_fee),
                      "principal_repaid": str(principal_payment), "interest_paid": str(interest),
                      "closing_cash": str(funded_cash), "cash_without_financing": str(baseline), "closing_principal": str(principal)})
    minimum = min(Decimal(row["closing_cash"]) for row in daily)
    return {"status": "cash_shortfall" if minimum < 0 else "below_reserve" if minimum < reserve else "calculated",
            "daily": daily, "minimum_cash": str(minimum), "cash_reserve": str(reserve),
            "minimum_cash_without_financing": str(min(Decimal(row["cash_without_financing"]) for row in daily)),
            "closing_cash": str(funded_cash), "issues": []}
