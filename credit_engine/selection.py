"""Предварительный подбор механики финансирования под задачу бизнеса."""

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import asdict, dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

from .assessment import assess_application
from .checks import parse_timestamp
from .financials import CalculationIssue
from .overdraft_assessment import assess_overdraft


PRODUCTS = ("working_capital_loan", "overdraft")
PATTERNS = ("cash_gap", "gradual_repayment")
GLOBAL_DECLINES = {"financing_prohibited", "business_inactive"}


@dataclass(frozen=True)
class FinancingSelectionResult:
    status: str
    recommendation_id: str
    application_id: str | None = None
    application_version: int | None = None
    recommended_product_id: str | None = None
    candidates: tuple[dict[str, Any], ...] = ()
    required_information: tuple[dict[str, str], ...] = ()
    reasons: tuple[dict[str, str], ...] = ()
    issues: tuple[CalculationIssue, ...] = ()
    calculated_at: str | None = None
    stage: str = "preliminary"
    policy_version: str = "demo-selection-v1"

    def to_dict(self):
        result = asdict(self)
        for field in ("candidates", "required_information", "reasons", "issues"):
            result[field] = list(result[field])
        return result


def recommend_financing(application: Mapping, checks: Mapping | None, *, calculated_at: datetime | str,
                        recommendation_id: str | None = None, seasonal: bool = False) -> FinancingSelectionResult:
    """Сравнить два продукта, сохранив подтверждённую заявку и её предпочтения."""
    identifier = recommendation_id if recommendation_id is not None else str(uuid4())
    now = parse_timestamp(calculated_at)
    identity = {"application_id": application.get("application_id"), "application_version": application.get("application_version")} if isinstance(application, Mapping) else {}

    def finish(status, *, recommended=None, candidates=(), questions=(), reasons=(), issues=()):
        return FinancingSelectionResult(status, identifier, **identity, recommended_product_id=recommended,
                                        candidates=tuple(candidates), required_information=tuple(questions),
                                        reasons=tuple(reasons), issues=tuple(issues), calculated_at=now.isoformat() if now else None,
                                        policy_version="demo-selection-seasonal-v2" if seasonal else "demo-selection-v1")

    def invalid(field, code, message):
        return finish("invalid_data", issues=(CalculationIssue(field, code, message),))

    def ask(field, code, question):
        return finish("needs_information", questions=({"field": field, "code": code, "question": question},))

    if now is None:
        return invalid("calculated_at", "invalid_timestamp", "Нужно время подбора с часовым поясом.")
    if not isinstance(application, Mapping):
        return invalid("application", "invalid_application", "Заявка должна быть объектом.")
    if application.get("schema_version") != "0.1":
        return invalid("schema_version", "unsupported_schema", "Нужен формат заявки 0.1.")
    if not isinstance(identity["application_id"], str) or not identity["application_id"].strip():
        return invalid("application_id", "invalid_id", "Нужен идентификатор заявки.")
    if type(identity["application_version"]) is not int or identity["application_version"] < 1:
        return invalid("application_version", "invalid_version", "Нужна положительная целочисленная версия.")
    if not isinstance(identifier, str) or not identifier.strip():
        return invalid("recommendation_id", "invalid_id", "Нужен непустой идентификатор подбора.")
    need = application.get("need")
    if need is None:
        return ask("need", "missing_need", "На что, в каком размере и на какой период нужны деньги?")
    if not isinstance(need, Mapping):
        return invalid("need", "invalid_section", "Потребность должна быть объектом.")
    if need.get("purpose") is None:
        return ask("need.purpose", "purpose_required", "Для какой задачи бизнеса нужны деньги?")
    if not isinstance(need["purpose"], str):
        return invalid("need.purpose", "invalid_purpose", "Цель должна быть строкой.")
    if need["purpose"] != "working_capital":
        return finish("not_eligible", reasons=({"code": "unsupported_purpose", "message": "Эти два продукта оценивают оборотные цели. Для указанной задачи нужна другая механика финансирования."},))
    pattern, preferred = need.get("financing_pattern"), need.get("preferred_product")
    if pattern is not None and pattern not in PATTERNS:
        return invalid("need.financing_pattern", "invalid_pattern", "Выберите cash_gap, gradual_repayment или null.")
    if preferred is not None and preferred not in PRODUCTS:
        return finish("not_eligible", reasons=({"code": "unsupported_product", "message": "Запрошенный продукт пока не входит в подбор разового кредита и овердрафта."},))
    if need.get("recurring") is not None and type(need["recurring"]) is not bool:
        return invalid("need.recurring", "invalid_recurring", "Укажите true, false или null.")
    if pattern is None and preferred is None:
        return ask("need.financing_pattern", "repayment_pattern_required",
                   "Нужно перекрыть расходы до конкретного поступления денег или возвращать финансирование постепенно из выручки?")

    primary = "overdraft" if pattern == "cash_gap" else "working_capital_loan" if pattern == "gradual_repayment" else preferred
    order = (primary, *(product for product in PRODUCTS if product != primary))
    candidates = []
    for product in order:
        primary_candidate = product == primary
        reason = ({"code": "temporary_gap", "message": "Овердрафт проверяется для разрыва между расходами и поступлениями; погашение каждой выборки проверяется по датам."}
                  if product == "overdraft" else {"code": "scheduled_repayment", "message": "Разовый кредит выдаётся одной суммой и погашается по ежемесячному графику из доступного денежного потока."})
        candidate = {"product_id": product, "role": "primary" if primary_candidate else "alternative",
                     "cost_basis": "planned_operations" if product == "overdraft" else "full_term",
                     "reasons": [reason], "eligibility": "not_evaluated", "evaluation": None,
                     "offers": [], "required_information": []}
        candidates.append(candidate)
        if product == "overdraft" and pattern == "gradual_repayment":
            candidate.update(eligibility="not_suitable", reasons=[{"code": "gradual_repayment_required", "message": "Для постепенного возврата выбран кредит с графиком; овердрафт требует погашения каждой выборки из ближайших поступлений."}])
            continue
        if candidates[0]["evaluation"]:
            primary_assessment = candidates[0]["evaluation"].get("assessment")
            primary_codes = {reason["code"] for reason in primary_assessment["reasons"]} if primary_assessment else set()
            if primary_codes & GLOBAL_DECLINES or (primary == "overdraft" and "no_financing_gap" in primary_codes):
                candidate["reasons"] = [{"code": "common_restriction", "message": "Подбор другого продукта не устраняет установленную причину."}]
                continue
        # Проекция нужна только для предварительной проверки кандидата.
        # Сумма, цель, финансовые данные, версия и исходная заявка не меняются.
        projection = deepcopy(dict(application))
        projection["need"] = dict(projection["need"], preferred_product=None)
        calculator = assess_overdraft if product == "overdraft" else assess_application
        evaluated = calculator(projection, checks, calculated_at=now, stage="preliminary",
                               assessment_id=f"{identifier}-{product}", seasonal=seasonal).to_dict()
        candidate["evaluation"] = evaluated
        assessment = evaluated["assessment"]
        if assessment:
            candidate["offers"] = deepcopy(assessment["offers"])
            candidate["required_information"] = deepcopy(assessment["required_information"])
        candidate["eligibility"] = ("eligible" if assessment and assessment["offers"] else
                                    assessment["outcome"] if assessment else evaluated["status"])
        if product == "overdraft" and need.get("recurring") is True:
            candidate["reasons"].append({"code": "repeated_gaps", "message": "Лимит восстанавливается при погашении основного долга; каждый повторный разрыв всё равно проверяется по плану."})

    if primary == "overdraft":
        gap_calculation = candidates[0]["evaluation"].get("overdraft_calculation") if candidates[0]["evaluation"] else None
        loan_candidate = next(candidate for candidate in candidates if candidate["product_id"] == "working_capital_loan")
        if gap_calculation and loan_candidate["offers"]:
            required = Decimal(gap_calculation["required_limit"])
            loan_candidate["offers"] = [offer for offer in loan_candidate["offers"] if Decimal(offer["amount"]) >= required]
            if not loan_candidate["offers"]:
                loan_candidate["eligibility"] = "needs_information"
                loan_candidate["required_information"] = [{"field": "product_details.overdraft.transactions", "code": "loan_does_not_cover_plan",
                    "question": "Доступной суммы разового кредита недостаточно для планового разрыва. Можно ли уменьшить расходы или подтвердить дополнительные собственные средства в плане?"}]
                loan_candidate["reasons"].append({"code": "loan_does_not_cover_plan", "message": "Финансовая доступность кредита не означает, что его суммы хватит на указанный план."})

    first = candidates[0]
    evaluation = first["evaluation"]
    assessment = evaluation["assessment"] if evaluation else None
    codes = {reason["code"] for reason in assessment["reasons"]} if assessment else set()
    if codes & GLOBAL_DECLINES or (primary == "overdraft" and "no_financing_gap" in codes):
        return finish("not_eligible", candidates=candidates, reasons=assessment["reasons"])
    # Общие запреты могут обнаружиться во втором продукте раньше, чем первый
    # получит свои специальные поля (например, срок разового кредита).
    for candidate in candidates:
        other = candidate["evaluation"]
        other_assessment = other["assessment"] if other else None
        if other_assessment and any(reason["code"] in GLOBAL_DECLINES for reason in other_assessment["reasons"]):
            return finish("not_eligible", candidates=candidates, reasons=other_assessment["reasons"])
    eligible = [candidate for candidate in candidates if candidate["eligibility"] == "eligible"]
    primary_questions = first["required_information"]
    reduction_only = bool(primary_questions) and all(question["field"] == "need.minimum_acceptable_amount" for question in primary_questions)
    if eligible and (first["eligibility"] == "eligible" or first["eligibility"] in ("declined", "out_of_policy") or reduction_only):
        chosen = eligible[0]
        return finish("recommendations_ready", recommended=chosen["product_id"], candidates=candidates,
                      reasons=({"code": "task_and_checks_match" if chosen is first else "other_product_available",
                                "message": "Механика соответствует задаче и прошла предварительные проверки." if chosen is first else "Основной вариант не дал подходящего предложения; другой продукт прошёл собственные проверки."},))
    for status in ("check_retry_pending", "needs_checks"):
        if any(candidate["eligibility"] == status for candidate in candidates):
            return finish(status, candidates=candidates)
    if first["eligibility"] == "invalid_data":
        return finish("invalid_data", candidates=candidates,
                      issues=tuple(CalculationIssue(**issue) for issue in evaluation["issues"]))
    questions = []
    seen = set()
    # Сначала уточняем основной продукт. Если он уже исключён — следующий.
    targets = [first] if first["eligibility"] == "needs_information" else candidates
    for candidate in targets:
        for question in candidate["required_information"]:
            key = question["field"], question["code"]
            if key not in seen:
                seen.add(key)
                questions.append(question)
    if questions:
        return finish("needs_information", candidates=candidates, questions=questions,
                      reasons=({"code": "complete_candidate_data", "message": "Для выбора механики нужны уточнения; доступные расчёты других вариантов показаны отдельно."},))
    invalid_candidates = [candidate for candidate in candidates if candidate["eligibility"] == "invalid_data"]
    if invalid_candidates:
        return finish("invalid_data", candidates=candidates,
                      issues=tuple(CalculationIssue(**issue) for issue in invalid_candidates[0]["evaluation"]["issues"]))
    return finish("not_eligible", candidates=candidates,
                  reasons=({"code": "no_eligible_product", "message": "По текущим данным и правилам двух продуктов подходящих предложений нет."},))
