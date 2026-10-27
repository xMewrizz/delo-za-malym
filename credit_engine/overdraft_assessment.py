"""Проверка бизнеса, допустимого лимита и плана использования овердрафта."""

from calendar import monthrange
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP, ROUND_UP, localcontext
from typing import Any
from uuid import uuid4

from .assessment import AssessmentResult
from .checks import parse_timestamp, validate_external_checks
from .financials import CalculationIssue, FinancialPolicy, MONEY_PATTERN, calculate_financial_metrics
from .overdraft import OverdraftCalculation, OverdraftPolicy, calculate_overdraft
from .scoring import calculate_risk_score


@dataclass(frozen=True)
class OverdraftCreditPolicy:
    version: str = "demo-overdraft-v1"
    minimum_limit: Decimal = Decimal("100000.00")
    maximum_limit: Decimal = Decimal("3000000.00")
    limit_step: Decimal = Decimal("10000.00")
    low_risk_turnover_fraction: Decimal = Decimal("0.30")
    medium_risk_turnover_fraction: Decimal = Decimal("0.20")
    annual_rate_percent: str = "24.00"
    minimum_business_months: int = 12
    agreement_months: int = 12
    max_debt_days: int = 60
    max_scenario_days: int = 366
    offer_valid_days: int = 7
    checks_valid_hours: int = 24

    def __post_init__(self) -> None:
        for value in (self.minimum_limit, self.maximum_limit, self.limit_step):
            if not isinstance(value, Decimal) or not value.is_finite() or value <= 0 or value.as_tuple().exponent < -2:
                raise ValueError("Лимиты и шаг должны быть положительными Decimal с точностью до копеек")
        if self.minimum_limit > self.maximum_limit or any(value % self.limit_step for value in (self.minimum_limit, self.maximum_limit)):
            raise ValueError("Границы лимита должны быть упорядочены и кратны шагу")
        for value in (self.low_risk_turnover_fraction, self.medium_risk_turnover_fraction):
            if not isinstance(value, Decimal) or not value.is_finite() or not 0 < value <= 1:
                raise ValueError("Доли оборота должны находиться в интервале (0, 1]")
        if self.medium_risk_turnover_fraction > self.low_risk_turnover_fraction:
            raise ValueError("Для среднего риска доля оборота не должна превышать долю низкого риска")
        for value in (self.minimum_business_months, self.agreement_months, self.offer_valid_days, self.checks_valid_hours):
            if type(value) is not int or value < 1:
                raise ValueError("Возраст бизнеса и сроки должны быть положительными целыми")
        OverdraftPolicy(self.annual_rate_percent, self.max_debt_days, self.max_scenario_days, self.version)


@dataclass(frozen=True)
class OverdraftLimitCalculation:
    minimum_monthly_inflow: Decimal
    turnover_fraction: Decimal
    turnover_limit: Decimal
    interest_capacity_limit: Decimal
    product_maximum_limit: Decimal
    maximum_eligible_limit: Decimal


@dataclass(frozen=True)
class OverdraftAssessmentResult(AssessmentResult):
    limit_calculation: OverdraftLimitCalculation | None = None
    overdraft_calculation: OverdraftCalculation | None = None


def validate_debt_payments(scenario: Mapping, loans: list, start: date, end: date) -> tuple[CalculationIssue, ...]:
    """Связать запланированные кредитные платежи с операциями, не добавляя их повторно."""
    field = "product_details.overdraft.existing_debt_payments"
    active = {loan["loan_id"]: loan for loan in loans if Decimal(loan["outstanding_principal"]) > 0}
    if active and scenario.get("debt_payments_confirmed") is False:
        return (CalculationIssue(field, "debt_payments_not_confirmed", "Проверьте платежи по действующим кредитам за период плана и подтвердите, что они учтены."),)
    references = scenario.get("existing_debt_payments")
    if references is None:
        return (CalculationIssue(field, "missing_debt_payment_plan", "Укажите платежи по текущим кредитам в плане или подтвердите, что в этом периоде их нет списком []."),) if active else ()
    if not isinstance(references, list):
        return (CalculationIssue(field, "invalid_debt_payment_plan", "Связи кредитных платежей должны быть списком."),)
    transactions = {item["transaction_id"]: item for item in scenario["transactions"]}
    seen = set()
    planned: dict[tuple[str, str], Decimal] = {}
    planned_by_date: dict[tuple[str, str], Decimal] = {}
    for index, reference in enumerate(references):
        if not isinstance(reference, Mapping):
            return (CalculationIssue(f"{field}[{index}]", "invalid_debt_payment_plan", "Нужны loan_id и transaction_id."),)
        loan_id, transaction_id = reference.get("loan_id"), reference.get("transaction_id")
        if not isinstance(loan_id, str) or loan_id not in active or not isinstance(transaction_id, str) or transaction_id not in transactions:
            return (CalculationIssue(f"{field}[{index}]", "invalid_debt_payment_reference", "Платёж должен ссылаться на действующий кредит и существующую операцию."),)
        operation = transactions[transaction_id]
        if operation["direction"] != "outflow" or transaction_id in seen:
            return (CalculationIssue(f"{field}[{index}]", "invalid_debt_payment_reference", "Укажите отдельный расход, который ещё не связан с другим кредитом."),)
        seen.add(transaction_id)
        key = loan_id, operation["date"][:7]
        planned[key] = planned.get(key, Decimal("0.00")) + Decimal(operation["amount"])
        day_key = loan_id, operation["date"]
        planned_by_date[day_key] = planned_by_date.get(day_key, Decimal("0.00")) + Decimal(operation["amount"])
    # За полностью включённый календарный месяц нельзя подтвердить отсутствие регулярного платежа.
    for loan_id, loan in active.items():
        # Capacity reserves are not payments: a line may owe only interest,
        # and an investment loan may still have principal grace months.
        if isinstance(loan.get("schedule"), list):
            due_by_date: dict[str, Decimal] = {}
            for payment in loan["schedule"]:
                if start.isoformat() <= payment["date"] <= end.isoformat():
                    day = payment["date"]
                    due_by_date[day] = due_by_date.get(day, Decimal("0.00")) + Decimal(payment["total_payment"])
            for day, amount in due_by_date.items():
                if planned_by_date.get((loan_id, day), Decimal("0.00")) < amount:
                    return (CalculationIssue(field, "incomplete_debt_payment_plan", f"В плане не учтён платёж по действующему кредиту на {day}. Обновите банковские данные."),)
            continue
        current = start.replace(day=1)
        while current <= end:
            month_end = current.replace(day=monthrange(current.year, current.month)[1])
            if start <= current and month_end <= end and date.fromisoformat(loan["maturity_date"]) >= month_end:
                paid = planned.get((loan_id, current.strftime("%Y-%m")), Decimal("0.00"))
                if paid < Decimal(loan["monthly_payment"]):
                    return (CalculationIssue(field, "incomplete_debt_payment_plan", f"Включите регулярный платёж по кредиту {loan_id} за {current:%Y-%m} в расходы плана."),)
            if current.month == 12:
                if current.year == 9999:
                    break
                current = date(current.year + 1, 1, 1)
            else:
                current = date(current.year, current.month + 1, 1)
    return ()


def assess_overdraft(
    application: Mapping[str, Any], checks: Mapping[str, Any] | None,
    *, calculated_at: datetime | str, stage: str = "final", assessment_id: str | None = None,
    policy: OverdraftCreditPolicy = OverdraftCreditPolicy(),
    financial_policy: FinancialPolicy = FinancialPolicy(version="demo-overdraft-v1"),
    seasonal: bool = False,
) -> OverdraftAssessmentResult:
    """Вернуть решение по овердрафту, не изменяя заявку или внешний контекст Decimal."""
    if policy.version != financial_policy.version:
        raise ValueError("Версии кредитной и финансовой политик должны совпадать")
    if seasonal:
        policy = replace(policy, version=policy.version.removesuffix("-v1") + "-seasonal-v2")
        financial_policy = replace(financial_policy, version=policy.version, allow_seasonal_cash_flow=True)
    # Сохраняем точность для больших денежных значений, включая вложенные операции.
    def lengths(value):
        if isinstance(value, str):
            return len(value) if MONEY_PATTERN.fullmatch(value) else 0
        if isinstance(value, Mapping):
            return max((lengths(item) for item in value.values()), default=0)
        if isinstance(value, list):
            return max((lengths(item) for item in value), default=0)
        return 0

    with localcontext() as context:
        context.prec = max(64, 2 * lengths(application) + len(policy.maximum_limit.as_tuple().digits) + 32)
        context.rounding = ROUND_HALF_UP
        return _assess(application, checks, calculated_at, stage, assessment_id, policy, financial_policy)


def _assess(application, checks, calculated_at, stage, assessment_id, policy, financial_policy):
    now = parse_timestamp(calculated_at)
    if now is None:
        return OverdraftAssessmentResult("invalid_data", issues=(CalculationIssue("calculated_at", "invalid_timestamp", "Нужно время оценки с часовым поясом."),))
    if not isinstance(application, Mapping):
        return OverdraftAssessmentResult("invalid_data", issues=(CalculationIssue("application", "invalid_application", "Заявка должна быть объектом."),))
    invalid, missing = [], []
    if not isinstance(application.get("application_id"), str) or not application["application_id"].strip():
        invalid.append(CalculationIssue("application_id", "invalid_id", "Нужен идентификатор заявки."))
    if type(application.get("application_version")) is not int or application["application_version"] < 1:
        invalid.append(CalculationIssue("application_version", "invalid_version", "Нужна положительная целочисленная версия."))
    if application.get("schema_version") != "0.1" or stage not in ("preliminary", "final"):
        invalid.append(CalculationIssue("schema_version", "unsupported_schema_or_stage", "Нужен формат 0.1 и этап preliminary или final."))
    if assessment_id is not None and (not isinstance(assessment_id, str) or not assessment_id.strip()):
        invalid.append(CalculationIssue("assessment_id", "invalid_id", "Нужен идентификатор оценки."))
    if invalid:
        return OverdraftAssessmentResult("invalid_data", issues=tuple(invalid))
    assessment_id = assessment_id or str(uuid4())
    metrics = scoring = limit_calculation = calculation = None

    def result(status, *, assessment=None, issues=()):
        return OverdraftAssessmentResult(status, assessment=assessment, issues=tuple(issues),
                                        financial_metrics=metrics, scoring=scoring,
                                        limit_calculation=limit_calculation, overdraft_calculation=calculation)

    def finish(outcome, code, message, *, fields=(), offers=()):
        return result("assessed", assessment={
            "schema_version": "0.1", "assessment_id": assessment_id,
            "application_id": application["application_id"], "application_version": application["application_version"],
            "stage": stage, "outcome": outcome, "risk_grade": scoring.risk_grade if scoring else None,
            "reasons": [{"code": code, "message": message}],
            "required_information": [{"field": issue.field, "code": issue.code, "question": issue.message} for issue in fields],
            "offers": list(offers), "policy_version": policy.version, "catalog_version": policy.version,
            "calculated_at": now.isoformat(),
        })

    for name in ("need", "business"):
        if application.get(name) is None:
            missing.append(CalculationIssue(name, "missing_section", f"Заполните раздел {name}."))
        elif not isinstance(application[name], Mapping):
            invalid.append(CalculationIssue(name, "invalid_section", "Раздел должен быть объектом."))
    if invalid:
        return result("invalid_data", issues=invalid)
    if missing:
        return finish("needs_information", "missing_application_data", "Нужны данные заявки.", fields=missing)
    business, need = application["business"], application["need"]
    for name in ("inn", "registered_at", "legal_form", "activity"):
        value = business.get(name)
        if value is None:
            missing.append(CalculationIssue(f"business.{name}", "missing_value", "Укажите сведения о бизнесе."))
        elif not isinstance(value, str) or not value.strip():
            invalid.append(CalculationIssue(f"business.{name}", "invalid_value", "Нужна непустая строка."))
    for name, value in (("currency", application.get("currency")), ("need.purpose", need.get("purpose"))):
        if value is None:
            missing.append(CalculationIssue(name, "missing_value", "Укажите значение."))
        elif not isinstance(value, str) or not value.strip():
            invalid.append(CalculationIssue(name, "invalid_value", "Нужна непустая строка."))
    amount = need.get("requested_amount")
    if amount is not None and (not isinstance(amount, str) or not MONEY_PATTERN.fullmatch(amount) or Decimal(amount) <= 0):
        invalid.append(CalculationIssue("need.requested_amount", "invalid_amount", "Нужен положительный лимит строкой с двумя знаками."))
    if invalid:
        return result("invalid_data", issues=invalid + missing)
    if missing:
        return finish("needs_information", "missing_application_data", "Нужны данные заявки.", fields=missing)
    amount = Decimal(amount) if amount is not None else None
    try:
        registered = date.fromisoformat(business["registered_at"])
        if registered > now.date() or registered.isoformat() != business["registered_at"]:
            raise ValueError
    except ValueError:
        return result("invalid_data", issues=(CalculationIssue("business.registered_at", "invalid_date", "Укажите корректную дату регистрации."),))
    if stage == "final":
        confirmation = application.get("confirmation")
        confirmed_at = parse_timestamp(confirmation.get("confirmed_at")) if isinstance(confirmation, Mapping) else None
        if (not isinstance(confirmation, Mapping) or type(confirmation.get("application_version")) is not int
                or confirmation["application_version"] != application["application_version"]
                or confirmed_at is None or confirmed_at > now):
            return finish("needs_information", "confirmation_required", "Подтвердите актуальную версию заявки.", fields=(
                CalculationIssue("confirmation", "confirmation_required", "Подтвердите данные заявки."),))
    if application["currency"] != "RUB" or business["legal_form"] not in ("ip", "ooo"):
        return finish("out_of_policy", "unsupported_business_or_currency", "Овердрафт доступен для ИП и ООО в рублях.")
    if need["purpose"] != "working_capital" or need.get("preferred_product") not in (None, "overdraft"):
        return finish("out_of_policy", "unsupported_product_or_purpose", "Этот модуль оценивает овердрафт на оборотные цели.")

    financials = calculate_financial_metrics(application.get("financials"), now.date(), policy=financial_policy)
    metrics = financials.metrics
    if financials.status == "invalid_data":
        return result("invalid_data", issues=financials.issues)
    if financials.status == "needs_information":
        return finish("needs_information", "incomplete_financial_data", "Уточните финансовые данные.", fields=financials.issues)
    check_status, issues = validate_external_checks(checks, application, now, max_age_hours=policy.checks_valid_hours)
    if check_status:
        return result(check_status, issues=issues)
    if not checks["registration"]["active"]:
        return finish("declined", "business_inactive", "По результатам проверки деятельность бизнеса прекращена.")
    if checks["restrictions"]["financing_prohibited"]:
        return finish("declined", "financing_prohibited", "Проверкой установлен общий запрет на финансирование.")
    mismatches = [CalculationIssue(f"business.{name}", "registration_mismatch", "Сверьте сведения о бизнесе с проверкой.")
                  for name in ("registered_at", "legal_form") if checks["registration"][name] != business[name]]
    if not checks["obligations"]["matches_application"]:
        mismatches.append(CalculationIssue("financials.existing_loans", "obligations_mismatch", "Уточните действующие кредиты и платежи."))
    if mismatches:
        return finish("needs_information", "checked_data_mismatch", "Сведения расходятся с результатом проверки.", fields=mismatches)
    age = (now.year - registered.year) * 12 + now.month - registered.month - (now.day < registered.day)
    if age < policy.minimum_business_months:
        return finish("out_of_policy", "insufficient_business_history", "Возраст бизнеса меньше требуемого для овердрафта.")
    if financials.status == "out_of_policy":
        return finish("out_of_policy", financials.issues[0].code, financials.issues[0].message)
    scoring = calculate_risk_score(metrics, checks["credit_history"]["category"])
    if scoring.status == "needs_information":
        return finish("needs_information", "incomplete_scoring_data", "Нужны сведения для оценки риска.", fields=scoring.issues)
    if scoring.status == "invalid_data":
        return result("invalid_data", issues=scoring.issues)
    if scoring.risk_grade == "high":
        return finish("out_of_policy", "risk_grade_not_eligible", "Высокий риск не допускается этим продуктом.")
    if amount is not None and amount < policy.minimum_limit:
        return finish("out_of_policy", "requested_limit_below_minimum", "Запрошенный лимит ниже минимума продукта.")

    months = {row.month for row in metrics.monthly_cash_flow}
    minimum_inflow = min(Decimal(row["operating_inflow"]) for row in application["financials"]["monthly"] if row["month"] in months)
    fraction = policy.low_risk_turnover_fraction if scoring.risk_grade == "low" else policy.medium_risk_turnover_fraction
    turnover_limit = (minimum_inflow * fraction).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    capacity = metrics.available_monthly_payment
    rate = Decimal(policy.annual_rate_percent)
    lower, upper, interest_limit = 0, int(policy.maximum_limit // policy.limit_step), Decimal("0.00")
    while lower <= upper:
        middle = (lower + upper) // 2
        candidate = middle * policy.limit_step
        worst_month_interest = (candidate * rate / 100 / 365).quantize(Decimal("0.01")) * 31
        if worst_month_interest <= capacity:
            interest_limit = candidate
            lower = middle + 1
        else:
            upper = middle - 1
    maximum = (min(turnover_limit, interest_limit, policy.maximum_limit) // policy.limit_step) * policy.limit_step
    limit_calculation = OverdraftLimitCalculation(minimum_inflow, fraction, turnover_limit, interest_limit, policy.maximum_limit, maximum)
    if maximum < policy.minimum_limit:
        return finish("declined", "no_eligible_limit", "Оборот и доступная нагрузка не позволяют установить минимальный лимит овердрафта.")

    details = application.get("product_details")
    if details is not None and not isinstance(details, Mapping):
        return result("invalid_data", issues=(CalculationIssue("product_details", "invalid_section", "Параметры продукта должны быть объектом."),))
    scenario = details.get("overdraft") if details is not None else None
    offered_limit = (min(amount, maximum) // policy.limit_step) * policy.limit_step if amount is not None else maximum
    calculation_policy = OverdraftPolicy(policy.annual_rate_percent, policy.max_debt_days, policy.max_scenario_days, policy.version)
    simulation = calculate_overdraft(scenario, f"{offered_limit:.2f}", policy=calculation_policy)
    scenario_issues = tuple(CalculationIssue(
        "product_details.overdraft" + issue.field[len("scenario"):], issue.code, issue.message,
    ) for issue in simulation.issues)
    if simulation.status == "invalid_data":
        return result("invalid_data", issues=scenario_issues)
    if simulation.status == "needs_information":
        return finish("needs_information", "missing_overdraft_plan", "Нужен план поступлений и расходов.", fields=scenario_issues)
    if amount is None:
        required = simulation.calculation.required_limit
        steps = (required / policy.limit_step).to_integral_value(rounding=ROUND_UP)
        offered_limit = min(maximum, max(policy.minimum_limit, steps * policy.limit_step))
        simulation = calculate_overdraft(scenario, f"{offered_limit:.2f}", policy=calculation_policy)
    start, end = date.fromisoformat(scenario["start_date"]), date.fromisoformat(scenario["end_date"])
    if start < now.date():
        return finish("needs_information", "outdated_overdraft_plan", "Обновите план на период не раньше даты рассмотрения.", fields=(
            CalculationIssue("product_details.overdraft.start_date", "outdated_plan", "Укажите актуальный период и остаток денег."),))
    year, month_index = divmod(start.year * 12 + start.month - 1 + policy.agreement_months, 12)
    if year > 9999:
        return result("invalid_data", issues=(CalculationIssue("product_details.overdraft.start_date", "invalid_agreement_period", "Дата выходит за поддерживаемый календарь."),))
    agreement_end = date(year, month_index + 1, min(start.day, monthrange(year, month_index + 1)[1]))
    if end >= agreement_end:
        return finish("needs_information", "plan_exceeds_agreement", "План выходит за период доступности лимита.", fields=(
            CalculationIssue("product_details.overdraft.end_date", "plan_exceeds_agreement", "Сократите план до периода договора."),))
    current_cash = application["financials"].get("cash_balance")
    if current_cash is None:
        return finish("needs_information", "missing_cash_balance", "Подтвердите собственные деньги.", fields=(
            CalculationIssue("financials.cash_balance", "missing_value", "Укажите текущий собственный остаток."),))
    if Decimal(scenario["opening_cash_balance"]) > Decimal(current_cash):
        return finish("needs_information", "opening_cash_not_supported", "Начальный остаток плана превышает подтверждённые собственные деньги.", fields=(
            CalculationIssue("product_details.overdraft.opening_cash_balance", "cash_balance_mismatch", "Уточните остаток или обновите сведения о собственных деньгах."),))
    debt_issues = validate_debt_payments(scenario, application["financials"]["existing_loans"], start, end)
    if debt_issues:
        if any(issue.code.startswith("invalid_") for issue in debt_issues):
            return result("invalid_data", issues=debt_issues)
        return finish("needs_information", "incomplete_debt_payment_plan", "Уточните расходы по действующим кредитам.", fields=debt_issues)
    calculation = simulation.calculation
    debt_shortfalls = tuple(issue for issue in calculation.violations if issue.code == "credit_payment_shortfall")
    if debt_shortfalls:
        return finish("needs_information", "credit_payment_shortfall",
                      "Для платежей по действующим кредитам нужны собственные средства. Овердрафт покрывает только расходы бизнеса.", fields=debt_shortfalls)
    if not calculation.within_limit:
        if calculation.required_limit <= maximum:
            return finish("needs_information", "requested_limit_below_plan", "Запрошенный лимит меньше потребности из плана.", fields=(
                CalculationIssue("need.requested_amount", "requested_limit_below_plan", f"План требует не менее {calculation.required_limit:.2f} ₽. Уточните желаемый лимит или измените расходы."),))
        return finish("declined", "limit_does_not_cover_plan", "Допустимого лимита недостаточно для расходов из подтверждённого плана.")
    if not calculation.within_repayment_period:
        return finish("out_of_policy", "repayment_term_not_eligible", "План не укладывается в срок погашения каждой выборки овердрафта.")
    if not calculation.fully_repaid:
        return finish("needs_information", "repayment_not_demonstrated", "План пока не показывает полного погашения долга и процентов.", fields=(
            CalculationIssue("product_details.overdraft.transactions", "repayment_not_demonstrated", "Дополните план поступлениями для погашения и при необходимости продлите период расчёта."),))
    if calculation.total_drawn == 0:
        return finish("out_of_policy", "no_financing_gap", "Для этого плана хватает собственных денег; использование овердрафта не требуется.")

    conditions = [] if scoring.risk_grade == "low" else [{
        "code": "guarantee_required", "message": "Оформить поручительство перед подписанием договора овердрафта.", "fulfilled": False,
    }]
    offer = {
        "offer_id": f"{assessment_id}-offer-1", "application_id": application["application_id"],
        "application_version": application["application_version"], "product_id": "overdraft",
        "amount": f"{offered_limit:.2f}", "term_months": None, "agreement_months": policy.agreement_months,
        "max_debt_days": policy.max_debt_days, "annual_rate_percent": policy.annual_rate_percent,
        "monthly_payment": None, "fees_total": "0.00", "total_repayment": None,
        "scenario_cost": {
            "start_date": calculation.start_date, "end_date": calculation.end_date,
            "required_limit": f"{calculation.required_limit:.2f}", "total_drawn": f"{calculation.total_drawn:.2f}",
            "total_interest": f"{calculation.total_interest:.2f}", "total_repayment": f"{calculation.total_repayment:.2f}",
        },
        "conditions": conditions, "valid_until": (now + timedelta(days=policy.offer_valid_days)).isoformat(),
    }
    if amount is not None and offered_limit != amount:
        return finish("alternative_offers", "reduced_limit_covers_plan", f"Запрошено {amount:.2f} ₽; доступен лимит {offered_limit:.2f} ₽, достаточный для подтверждённого плана.", offers=(offer,))
    return finish("conditional_approval" if conditions else "approved",
                  "guarantor_required" if conditions else "requested_limit_eligible",
                  "Овердрафт требует поручительства." if conditions else "Запрошенный лимит и план использования прошли проверки.", offers=(offer,))
