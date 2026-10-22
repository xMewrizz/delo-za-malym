"""Возобновляемый лимит и журнал фактических операций симулятора."""

from calendar import isleap, monthrange
from copy import deepcopy
from dataclasses import replace
from datetime import date, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from .assessment import WorkingCapitalPolicy, assess_application
from .checks import parse_timestamp
from .financials import FinancialPolicy

PRODUCT = "revolving_credit_line"
POLICY = replace(WorkingCapitalPolicy(), version="demo-revolving-v1", terms=(6, 12), annual_rate_percent="22.00")
CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def money(value):
    return f"{value.quantize(CENT, rounding=ROUND_HALF_UP):.2f}"


def local_date(now):
    return now.astimezone(timezone(timedelta(hours=3))).date()


def add_months(start, count):
    year, month = divmod(start.year * 12 + start.month - 1 + count, 12)
    return date(year, month + 1, min(start.day, monthrange(year, month + 1)[1]))


class LineResult:
    def __init__(self, result):
        self.result = result

    def to_dict(self):
        return deepcopy(self.result)


def assess_revolving(application, checks, *, calculated_at, stage="final", assessment_id=None):
    projection = deepcopy(application)
    need = projection["need"]
    # Общая оценка риска и консервативный резерв на обслуживание всего лимита.
    need["preferred_product"] = "working_capital_loan"
    need["financing_pattern"] = "gradual_repayment"
    result = assess_application(projection, checks, calculated_at=calculated_at, stage=stage, assessment_id=assessment_id,
        policy=POLICY, financial_policy=replace(FinancialPolicy(), version=POLICY.version)).to_dict()
    assessment = result.get("assessment")
    if assessment:
        for offer in assessment["offers"]:
            reserve = offer["monthly_payment"]
            offer.update(product_id=PRODUCT, monthly_payment=None, total_repayment=None,
                revolving={"capacity_reserve": reserve, "interest_30_days_full_limit": money(Decimal(offer["amount"]) * Decimal(POLICY.annual_rate_percent) / 100 * 30 / 365),
                    "unused_limit_fee": "0.00", "interest_payment": "monthly", "principal_payment": "by_maturity"})
    return LineResult(result)


def revolving_options(application, checks, *, calculated_at, preferences=None, exploration_id=None):
    preferences = preferences or {}
    identity = exploration_id or str(uuid4())
    options, evaluations = [], []
    requested = preferences.get("requested_amount") or application["need"].get("requested_amount")
    before = False
    for term in POLICY.terms:
        if not preferences.get("minimum_term", 6) <= term <= preferences.get("maximum_term", 12):
            continue
        projection = deepcopy(application)
        projection["need"].update(preferred_product=PRODUCT, requested_amount=requested, term_months=term)
        result = assess_revolving(projection, checks, calculated_at=calculated_at, stage="preliminary").to_dict()
        evaluations.append(result)
        for offer in (result.get("assessment") or {}).get("offers", []):
            if offer["term_months"] != term:
                continue
            if preferences.get("preserve_amount", True) and offer["amount"] != requested:
                continue
            before = True
            # Для линии это ограничение резерва нагрузки, не обещание фиксированного платежа.
            maximum = preferences.get("maximum_monthly_payment")
            if maximum and Decimal(offer["revolving"]["capacity_reserve"]) > Decimal(maximum):
                continue
            if any(item["amount"] == offer["amount"] and item["term_months"] == term for item in options):
                continue
            offer.update(option_id=f"{identity}-{len(options)}", labels=[])
            options.append(offer)
    if not evaluations:
        raise ValueError("Для линии доступны сроки 6 и 12 месяцев. Измените диапазон.")
    options.sort(key=lambda offer: (Decimal(offer["amount"]) != Decimal(requested or "0"), Decimal(offer["revolving"]["capacity_reserve"])))
    assessment = evaluations[-1].get("assessment") or {}
    status = "options_ready" if options else "no_matching_options" if before else assessment.get("outcome", evaluations[-1]["status"])
    return {"product_id": PRODUCT, "status": status, "options": options, "preferences": preferences,
        "required_information": [] if options or before else assessment.get("required_information", []),
        "issues": [] if options or before else evaluations[-1].get("issues", []),
        "reasons": [] if options else [{"code": "line_budget", "message": "Лимит не укладывается в выбранный резерв нагрузки. Измените лимит или ограничение."}] if before else assessment.get("reasons", [])}


def line_state(line, today):
    """Начисление за завершённые дни на фактический остаток; платежи сначала гасят проценты."""
    opened = date.fromisoformat(line["opened_at"][:10])
    maturity = date.fromisoformat(line["maturity_date"])
    until = min(today, date.fromisoformat(line["closed_at"][:10])) if line.get("closed_at") else today
    operations = {}
    for operation in line["operations"]:
        operations.setdefault(operation["date"], []).append(operation)
    due_dates = {add_months(opened, n) for n in range(1, line["term_months"] + 1)}
    principal, interest, due = ZERO, ZERO, ZERO
    due_on = None
    day = opened
    while day <= until:
        if day in due_dates and interest.quantize(CENT, rounding=ROUND_HALF_UP) > due:
            due = interest.quantize(CENT, rounding=ROUND_HALF_UP)
            due_on = due_on or day
        for operation in operations.get(day.isoformat(), []):
            principal += Decimal(operation.get("drawn", "0")) - Decimal(operation.get("principal_paid", "0"))
            paid = Decimal(operation.get("interest_paid", "0"))
            if paid:
                interest = ZERO if paid >= interest.quantize(CENT, rounding=ROUND_HALF_UP) else interest - paid
                due = max(ZERO, due - paid)
                if not due:
                    due_on = None
        if day < until:
            interest += principal * Decimal(line["annual_rate_percent"]) / 100 / (366 if isleap(day.year) else 365)
        day += timedelta(days=1)
    closed = bool(line.get("closed_at"))
    return {"limit": line["limit"], "principal": money(principal), "accrued_interest": money(interest),
        "amount_to_close": money(principal + interest),
        "available_limit": "0.00" if closed or today >= maturity or (due and due_on and due_on < today) else money(Decimal(line["limit"]) - principal),
        "capacity_reserve": "0.00" if closed or (today >= maturity and not principal and not interest.quantize(CENT, rounding=ROUND_HALF_UP)) else line["capacity_reserve"],
        "interest_due": money(due), "interest_due_date": due_on.isoformat() if due_on else None,
        "overdue_interest": bool(due and due_on and due_on < today), "matured": today >= maturity,
        "status": "closed" if closed else "expired" if today >= maturity else "active",
        "maturity_date": line["maturity_date"], "annual_rate_percent": line["annual_rate_percent"], "version": line["version"]}


def line_schedule(line, today):
    """Прогноз при текущем долге без новых выборок, с ежемесячной оплатой процентов."""
    if line.get("closed_at"):
        return []
    projected, schedule = deepcopy(line), []
    state = line_state(projected, today)
    opened, maturity = date.fromisoformat(line["opened_at"][:10]), date.fromisoformat(line["maturity_date"])
    if maturity <= today:
        return [{"date": maturity.isoformat(), "total_payment": state["amount_to_close"], "principal": state["principal"], "interest": state["accrued_interest"]}] if Decimal(state["amount_to_close"]) else []
    if state["overdue_interest"]:
        schedule.append({"date": state["interest_due_date"], "total_payment": state["interest_due"], "principal": "0.00", "interest": state["interest_due"]})
        projected["operations"].append({"date": today.isoformat(), "interest_paid": state["interest_due"]})
    for n in range(1, line["term_months"] + 1):
        due = add_months(opened, n)
        if due < today:
            continue
        state = line_state(projected, due)
        principal = state["principal"] if due == maturity else "0.00"
        total = Decimal(principal) + Decimal(state["accrued_interest"])
        if total:
            schedule.append({"date": due.isoformat(), "total_payment": money(total), "principal": principal, "interest": state["accrued_interest"]})
            projected["operations"].append({"date": due.isoformat(), "principal_paid": principal, "interest_paid": state["accrued_interest"]})
    return schedule
