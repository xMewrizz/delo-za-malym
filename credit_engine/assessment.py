"""Рассмотрение первого продукта с явными результатами внешних проверок."""

from collections.abc import Mapping
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP, localcontext
from typing import Any, Literal
from uuid import uuid4

from .financials import CalculationIssue, FinancialMetrics, FinancialPolicy, MONEY_PATTERN, calculate_financial_metrics
from .loans import LoanCalculation, calculate_loan
from .scoring import RiskScoreResult, calculate_risk_score
from .checks import parse_timestamp, validate_external_checks


@dataclass(frozen=True)
class WorkingCapitalPolicy:
    version: str = "demo-v1"
    minimum_amount: Decimal = Decimal("100000.00")
    maximum_amount: Decimal = Decimal("5000000.00")
    amount_step: Decimal = Decimal("10000.00")
    terms: tuple[int, ...] = (6, 12, 18, 24, 36)
    annual_rate_percent: str = "24.00"
    minimum_business_months: int = 12
    offer_valid_days: int = 7
    checks_valid_hours: int = 24

    def __post_init__(self) -> None:
        amounts = (self.minimum_amount, self.maximum_amount, self.amount_step)
        if any(not isinstance(value, Decimal) or not value.is_finite() or value <= 0
               or value.as_tuple().exponent < -2 for value in amounts):
            raise ValueError("Суммы политики должны быть положительными Decimal с точностью до копеек")
        if self.minimum_amount > self.maximum_amount or any(value % self.amount_step for value in amounts[:2]):
            raise ValueError("Границы сумм должны быть кратны шагу")
        if (not self.terms or any(type(term) is not int or not 1 <= term <= 600 for term in self.terms)
                or tuple(sorted(set(self.terms))) != self.terms):
            raise ValueError("Сроки должны быть уникальны, упорядочены и находиться в пределах 1–600 месяцев")
        if (not isinstance(self.annual_rate_percent, str) or not MONEY_PATTERN.fullmatch(self.annual_rate_percent)):
            raise ValueError("Ставка должна быть неотрицательной строкой с двумя знаками после точки")
        for value in (self.minimum_business_months, self.offer_valid_days, self.checks_valid_hours):
            if type(value) is not int or value < 1:
                raise ValueError("Возраст бизнеса и сроки актуальности должны быть положительными целыми")


@dataclass(frozen=True)
class AssessmentResult:
    status: Literal["assessed", "invalid_data", "needs_checks", "check_retry_pending"]
    assessment: dict[str, Any] | None = None
    issues: tuple[CalculationIssue, ...] = ()
    financial_metrics: FinancialMetrics | None = None
    scoring: RiskScoreResult | None = None

    def to_dict(self) -> dict[str, Any]:
        def serialize(value: Any) -> Any:
            if isinstance(value, Decimal):
                return str(value)
            if isinstance(value, dict):
                return {key: serialize(item) for key, item in value.items()}
            if isinstance(value, (tuple, list)):
                return [serialize(item) for item in value]
            return value
        return serialize(asdict(self))


def _loan(amount: Decimal, term: int, policy: WorkingCapitalPolicy) -> LoanCalculation:
    return calculate_loan(f"{amount:.2f}", term, policy.annual_rate_percent).calculation


def _maximum_affordable(
    amount: Decimal, term: int, capacity: Decimal, policy: WorkingCapitalPolicy,
) -> LoanCalculation | None:
    lower = int(policy.minimum_amount / policy.amount_step)
    upper = int(min(amount, policy.maximum_amount) // policy.amount_step)
    best = None
    while lower <= upper:
        middle = (lower + upper) // 2
        candidate = _loan(policy.amount_step * middle, term, policy)
        if candidate.maximum_payment <= capacity:
            best = candidate
            lower = middle + 1
        else:
            upper = middle - 1
    return best


def assess_application(
    application: Mapping[str, Any], checks: Mapping[str, Any] | None,
    *, calculated_at: datetime | str, stage: str = "final", assessment_id: str | None = None,
    policy: WorkingCapitalPolicy = WorkingCapitalPolicy(), financial_policy: FinancialPolicy = FinancialPolicy(),
) -> AssessmentResult:
    """Рассмотреть заявку без изменения глобального контекста Decimal."""
    if policy.version != financial_policy.version:
        raise ValueError("Версии правил продукта и финансовых показателей должны совпадать")
    need = application.get("need") if isinstance(application, Mapping) else None
    amount_text = need.get("requested_amount") if isinstance(need, Mapping) else None
    with localcontext() as context:
        context.prec = max(64, len(amount_text) + 32 if isinstance(amount_text, str) else 64,
                           len(policy.maximum_amount.as_tuple().digits) + 32)
        context.rounding = ROUND_HALF_UP
        return _assess_application(application, checks, calculated_at=calculated_at, stage=stage,
                                   assessment_id=assessment_id, policy=policy, financial_policy=financial_policy)


def _assess_application(
    application: Mapping[str, Any], checks: Mapping[str, Any] | None,
    *, calculated_at: datetime | str, stage: str = "final", assessment_id: str | None = None,
    policy: WorkingCapitalPolicy = WorkingCapitalPolicy(), financial_policy: FinancialPolicy = FinancialPolicy(),
) -> AssessmentResult:
    """Вернуть assessment по контракту 0.1 либо ошибку данных/состояние проверок."""
    now = parse_timestamp(calculated_at)
    if now is None:
        return AssessmentResult("invalid_data", issues=(CalculationIssue(
            "calculated_at", "invalid_timestamp", "Нужно время расчёта с часовым поясом.",
        ),))
    if not isinstance(application, Mapping):
        return AssessmentResult("invalid_data", issues=(CalculationIssue("application", "invalid_application", "Заявка должна быть объектом."),))
    identity_errors = []
    if not isinstance(application.get("application_id"), str) or not application["application_id"].strip():
        identity_errors.append(CalculationIssue("application_id", "invalid_id", "Нужен идентификатор заявки."))
    if type(application.get("application_version")) is not int or application["application_version"] < 1:
        identity_errors.append(CalculationIssue("application_version", "invalid_version", "Нужна положительная целочисленная версия."))
    if application.get("schema_version") != "0.1" or stage not in ("preliminary", "final"):
        identity_errors.append(CalculationIssue("schema_version", "unsupported_schema_or_stage", "Нужен формат 0.1 и этап preliminary или final."))
    if assessment_id is not None and (not isinstance(assessment_id, str) or not assessment_id.strip()):
        identity_errors.append(CalculationIssue("assessment_id", "invalid_id", "Нужен непустой идентификатор оценки."))
    if identity_errors:
        return AssessmentResult("invalid_data", issues=tuple(identity_errors))
    assessment_id = assessment_id or str(uuid4())
    metrics = None
    scoring = None

    def finish(outcome: str, code: str, message: str, *, fields=(), offers=(), reasons=()) -> AssessmentResult:
        assessment = {
            "schema_version": "0.1", "assessment_id": assessment_id,
            "application_id": application["application_id"], "application_version": application["application_version"],
            "stage": stage, "outcome": outcome, "risk_grade": scoring.risk_grade if scoring else None,
            "reasons": [{"code": code, "message": message}, *reasons],
            "required_information": [{"field": issue.field, "code": issue.code, "question": issue.message} for issue in fields],
            "offers": list(offers), "policy_version": policy.version, "catalog_version": policy.version,
            "calculated_at": now.isoformat(),
        }
        return AssessmentResult("assessed", assessment, financial_metrics=metrics, scoring=scoring)

    missing = []
    invalid = []
    for section in ("need", "business"):
        if application.get(section) is None:
            missing.append(CalculationIssue(section, "missing_section", f"Заполните раздел {section}."))
        elif not isinstance(application[section], Mapping):
            invalid.append(CalculationIssue(section, "invalid_section", "Раздел должен быть объектом."))
    if invalid:
        return AssessmentResult("invalid_data", issues=tuple(invalid + missing))
    if missing:
        return finish("needs_information", "missing_application_data", "Нужны данные заявки.", fields=missing)
    need, business = application["need"], application["business"]
    for field in ("inn", "legal_form", "registered_at", "activity"):
        value = business.get(field)
        if value is None:
            missing.append(CalculationIssue(f"business.{field}", "missing_value", "Укажите сведения о бизнесе."))
        elif not isinstance(value, str) or not value.strip():
            invalid.append(CalculationIssue(f"business.{field}", "invalid_value", "Нужна непустая строка."))
    for field in ("purpose", "requested_amount", "term_months"):
        if need.get(field) is None:
            missing.append(CalculationIssue(f"need.{field}", "missing_value", "Укажите параметры финансирования."))
    if application.get("currency") is None:
        missing.append(CalculationIssue("currency", "missing_value", "Укажите валюту заявки."))
    minimum = need.get("minimum_acceptable_amount")
    if minimum is not None and (not isinstance(minimum, str) or not MONEY_PATTERN.fullmatch(minimum) or Decimal(minimum) <= 0):
        invalid.append(CalculationIssue("need.minimum_acceptable_amount", "invalid_amount", "Нужна положительная сумма с двумя знаками после точки."))
    priority = need.get("priority")
    if priority is not None and priority not in ("lowest_payment", "lowest_total_cost", "preserve_amount"):
        invalid.append(CalculationIssue("need.priority", "invalid_priority", "Неизвестный приоритет выбора."))
    if invalid:
        return AssessmentResult("invalid_data", issues=tuple(invalid + missing))
    if missing:
        return finish("needs_information", "missing_application_data", "Нужны данные заявки.", fields=missing)
    request = calculate_loan(need["requested_amount"], need["term_months"], policy.annual_rate_percent)
    if request.status != "calculated":
        return AssessmentResult("invalid_data", issues=tuple(
            CalculationIssue(f"need.{issue.field}", issue.code, issue.message) for issue in request.issues
        ))
    amount, term = request.calculation.amount, need["term_months"]
    if minimum is not None and Decimal(minimum) > amount:
        return AssessmentResult("invalid_data", issues=(CalculationIssue(
            "need.minimum_acceptable_amount", "minimum_exceeds_request", "Минимальная сумма не должна превышать запрошенную.",
        ),))
    try:
        registered = date.fromisoformat(business["registered_at"])
        if registered > now.date() or registered.isoformat() != business["registered_at"]:
            raise ValueError
    except ValueError:
        return AssessmentResult("invalid_data", issues=(CalculationIssue("business.registered_at", "invalid_date", "Нужна дата регистрации не позднее даты оценки."),))
    if stage == "final":
        confirmation = application.get("confirmation")
        confirmed_at = parse_timestamp(confirmation.get("confirmed_at")) if isinstance(confirmation, Mapping) else None
        if (not isinstance(confirmation, Mapping) or type(confirmation.get("application_version")) is not int
                or confirmation["application_version"] != application["application_version"]
                or confirmed_at is None or confirmed_at > now):
            return finish("needs_information", "confirmation_required", "Требуется подтверждение текущей версии заявки.",
                          fields=(CalculationIssue("confirmation", "confirmation_required", "Подтвердите актуальные данные заявки."),))
    if application["currency"] != "RUB" or business["legal_form"] not in ("ip", "ooo"):
        return finish("out_of_policy", "unsupported_business_or_currency", "Автоматическая оценка поддерживает ИП и ООО с финансированием в рублях.")
    if need["purpose"] != "working_capital" or need.get("preferred_product") not in (None, "working_capital_loan"):
        return finish("out_of_policy", "unsupported_product_or_purpose", "Эта версия модуля оценивает разовый кредит на оборотные цели.")
    financials = calculate_financial_metrics(application.get("financials"), now.date(), policy=financial_policy)
    metrics = financials.metrics
    if financials.status == "invalid_data":
        return AssessmentResult("invalid_data", issues=financials.issues)
    if financials.status == "needs_information":
        return finish("needs_information", "incomplete_financial_data", "Уточните финансовые данные.", fields=financials.issues)
    check_status, issues = validate_external_checks(checks, application, now, max_age_hours=policy.checks_valid_hours)
    if check_status:
        return AssessmentResult(check_status, issues=issues, financial_metrics=metrics)
    if not checks["registration"]["active"]:
        return finish("declined", "business_inactive", "По результатам проверки деятельность бизнеса прекращена.")
    if checks["restrictions"]["financing_prohibited"]:
        return finish("declined", "financing_prohibited", "Проверкой установлен общий запрет на финансирование.")
    registration_mismatches = tuple(CalculationIssue(
        f"business.{field}", "registration_mismatch", "Сверьте сведения о бизнесе с регистрационной проверкой."
    ) for field in ("registered_at", "legal_form") if checks["registration"][field] != business[field])
    if registration_mismatches:
        return finish("needs_information", "registration_mismatch", "Регистрационные сведения расходятся с результатом проверки.",
                      fields=registration_mismatches)
    if not checks["obligations"]["matches_application"]:
        return finish("needs_information", "obligations_mismatch", "Обязательства расходятся с результатами проверки.", fields=(
            CalculationIssue("financials.existing_loans", "obligations_mismatch", "Уточните список кредитов и текущие платежи."),))
    age = (now.year - registered.year) * 12 + now.month - registered.month - (now.day < registered.day)
    if age < policy.minimum_business_months:
        return finish("out_of_policy", "insufficient_business_history", "Возраст бизнеса меньше требуемого для автоматической оценки.")
    if financials.status == "out_of_policy":
        return finish("out_of_policy", "nonpositive_monthly_cash_flow", financials.issues[0].message)
    if metrics.available_monthly_payment <= 0:
        return finish("declined", "no_payment_capacity", "Для первого продукта нет доступного платежа; другие продукты этой версией не оцениваются.")
    scoring = calculate_risk_score(metrics, checks["credit_history"]["category"])
    if scoring.status == "needs_information":
        return finish("needs_information", "incomplete_scoring_data", "Нужны сведения для оценки риска.", fields=scoring.issues)
    if scoring.status == "invalid_data":
        return AssessmentResult("invalid_data", issues=scoring.issues, financial_metrics=metrics)
    if scoring.risk_grade == "high":
        return finish("out_of_policy", "risk_grade_not_eligible", "Класс high недоступен для первого продукта; это ограничение продукта.")
    if amount < policy.minimum_amount:
        return finish("out_of_policy", "requested_amount_below_minimum", "Сумма ниже минимума первого продукта.")

    def sort_key(candidate):
        if priority == "lowest_payment":
            return candidate.maximum_payment, -candidate.amount, candidate.total_interest
        if priority == "lowest_total_cost":
            return candidate.total_interest, -candidate.amount, candidate.term_months
        return -candidate.amount, candidate.total_interest, candidate.term_months

    conditions = [] if scoring.risk_grade == "low" else [{
        "code": "guarantee_required", "message": "Оформить поручительство перед подписанием кредитного договора.", "fulfilled": False,
    }]

    def offer(candidate: LoanCalculation, index: int):
        return {
            "offer_id": f"{assessment_id}-offer-{index}", "application_id": application["application_id"],
            "application_version": application["application_version"], "product_id": "working_capital_loan",
            "amount": f"{candidate.amount:.2f}", "term_months": candidate.term_months,
            "annual_rate_percent": f"{candidate.annual_rate_percent:.2f}", "monthly_payment": f"{candidate.monthly_payment:.2f}",
            "fees_total": f"{candidate.fees_total:.2f}", "total_repayment": f"{candidate.total_repayment:.2f}",
            "conditions": [dict(condition) for condition in conditions],
            "valid_until": (now + timedelta(days=policy.offer_valid_days)).isoformat(),
        }

    amount_eligible = amount <= policy.maximum_amount and amount % policy.amount_step == 0
    if amount_eligible and term in policy.terms and request.calculation.maximum_payment <= metrics.available_monthly_payment:
        return finish("conditional_approval" if conditions else "approved",
                      "guarantor_required" if conditions else "requested_terms_eligible",
                      "Предложение требует поручительства." if conditions else "Запрошенные условия прошли проверки.",
                      offers=(offer(request.calculation, 1),))
    alternatives = []
    if amount_eligible:
        full_amount = [_loan(amount, candidate_term, policy) for candidate_term in policy.terms]
        full_amount = [candidate for candidate in full_amount if candidate.maximum_payment <= metrics.available_monthly_payment]
        if full_amount:
            alternatives.append(min(full_amount, key=sort_key))
    reduction_terms = (term,) if term in policy.terms else policy.terms
    reduced = [_maximum_affordable(amount, candidate_term, metrics.available_monthly_payment, policy)
               for candidate_term in reduction_terms]
    reduced = [candidate for candidate in reduced if candidate is not None and candidate.amount < amount]
    if minimum is not None:
        reduced = [candidate for candidate in reduced if candidate.amount >= Decimal(minimum)]
        if not reduced and not alternatives:
            reduced = [candidate for candidate_term in policy.terms
                       if (candidate := _maximum_affordable(amount, candidate_term, metrics.available_monthly_payment, policy))
                       is not None and Decimal(minimum) <= candidate.amount < amount]
        if reduced:
            alternatives.append(min(reduced, key=sort_key))
    if alternatives:
        alternatives.sort(key=sort_key)
        reason = ("requested_payment_exceeds_capacity" if request.calculation.maximum_payment > metrics.available_monthly_payment
                  else "requested_terms_outside_product")
        message = (f"Максимальный платёж исходного запроса {request.calculation.maximum_payment:.2f} ₽ "
                   f"превышает доступные {metrics.available_monthly_payment:.2f} ₽ в месяц."
                   if reason == "requested_payment_exceeds_capacity"
                   else "Исходная сумма или срок не входят в условия продукта; рассчитаны допустимые альтернативы.")
        return finish("alternative_offers", reason, message,
                      offers=tuple(offer(candidate, index) for index, candidate in enumerate(alternatives, 1)))
    if minimum is None:
        # При слишком коротком исходном сроке проверяем возможность меньшей суммы на всех сроках.
        if not reduced:
            reduced = [candidate for candidate_term in policy.terms
                       if (candidate := _maximum_affordable(amount, candidate_term, metrics.available_monthly_payment, policy))
                       is not None and candidate.amount < amount]
        if reduced:
            return finish("needs_information", "reduced_amount_requires_confirmation", "Нужно подтвердить достаточность меньшей суммы.", fields=(
                CalculationIssue("need.minimum_acceptable_amount", "minimum_acceptable_amount_required",
                                 "Какая минимальная сумма кредита решит вашу задачу с учётом собственных средств?"),))
    return finish("declined", "no_eligible_offer", "В реализованном каталоге первого продукта нет допустимых условий для этой задачи.")
