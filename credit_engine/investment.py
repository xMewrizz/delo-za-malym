"""Финансирование проекта с собственным взносом и отсрочкой основного долга."""

from copy import deepcopy
from dataclasses import replace
from decimal import Decimal, ROUND_CEILING
from uuid import uuid4

from .assessment import WorkingCapitalPolicy, assess_application
from .cashflow import payment_calendar, MOSCOW
from .checks import parse_timestamp
from .financials import FinancialPolicy, MONEY_PATTERN
from .loans import calculate_loan

PRODUCT = "investment_loan"
POLICY = replace(WorkingCapitalPolicy(), version="demo-investment-v1", amount_step=Decimal("0.01"),
                 annual_rate_percent="18.00", terms=(12, 24, 36, 48, 60))
GRACE_MONTHS = (0, 3, 6)
MINIMUM_OWN_SHARE = Decimal("0.20")


class InvestmentResult:
    def __init__(self, value):
        self.value = value

    def to_dict(self):
        return deepcopy(self.value)


def project_values(need):
    """Вернуть только проверенные параметры; неполный проект остаётся черновиком."""
    questions = []
    for field, question in (("project_cost", "Сколько стоит весь проект или оборудование?"),
                            ("own_funds", "Какую сумму вложите собственными средствами?")):
        value = need.get(field)
        if not isinstance(value, str) or len(value) > 16 or not MONEY_PATTERN.fullmatch(value):
            questions.append({"field": f"need.{field}", "code": "project_data_required", "question": question})
    if questions:
        return None, questions
    cost, own = Decimal(need["project_cost"]), Decimal(need["own_funds"])
    if cost <= 0 or own >= cost:
        return None, [{"field": "need.own_funds", "code": "invalid_project_funding", "question": "Стоимость проекта должна быть положительной, а собственный взнос — меньше стоимости. Если своих денег хватает, кредит не нужен."}]
    grace = need.get("principal_grace_months")
    if type(grace) is not int or grace not in GRACE_MONTHS:
        return None, [{"field": "need.principal_grace_months", "code": "grace_required", "question": "Выберите отсрочку основного долга: без отсрочки, 3 или 6 месяцев. Проценты платятся ежемесячно."}]
    return {"project_cost": f"{cost:.2f}", "own_funds": f"{own:.2f}", "loan_amount": f"{cost - own:.2f}",
            "own_share_percent": f"{own / cost * 100:.2f}", "principal_grace_months": grace}, []


def assess_investment(application, checks, *, calculated_at, stage="final", assessment_id=None):
    now = parse_timestamp(calculated_at)
    if now is None:
        return InvestmentResult({"status": "invalid_data", "assessment": None, "issues": [{"field": "calculated_at", "code": "invalid_timestamp", "message": "Нужно время расчёта с часовым поясом."}]})
    need = application.get("need") or {}
    project, questions = project_values(need)
    if need.get("purpose") != "investment" or need.get("preferred_product") != PRODUCT:
        questions.append({"field": "need.preferred_product", "code": "investment_product_required", "question": "Выберите инвестиционный кредит для финансирования проекта."})
    minimum_own = (Decimal(project["project_cost"]) * MINIMUM_OWN_SHARE).quantize(Decimal("0.01"), rounding=ROUND_CEILING) if project else None
    if project and Decimal(project["own_funds"]) < minimum_own:
        questions = [{"field": "need.own_funds", "code": "own_contribution_required", "question": f'Для проекта нужен собственный взнос от {minimum_own:.2f} ₽ (20%). Уточните, сможете ли его внести.'}]
    if project and need.get("requested_amount") != project["loan_amount"]:
        questions.append({"field": "need.requested_amount", "code": "project_amount_mismatch", "question": "Сумма кредита должна равняться стоимости проекта за вычетом собственных средств. Сохраните параметры проекта заново."})
    if questions:
        return InvestmentResult({"status": "assessed", "assessment": {
            "schema_version": "0.1", "assessment_id": assessment_id or str(uuid4()),
            "application_id": application.get("application_id"), "application_version": application.get("application_version"),
            "stage": stage, "outcome": "needs_information", "risk_grade": None,
            "reasons": [{"code": "project_details_required", "message": "Уточните параметры инвестиционного проекта."}],
            "required_information": questions, "offers": [], "policy_version": POLICY.version,
            "catalog_version": POLICY.version, "calculated_at": now.isoformat()}, "issues": []})
    projection = deepcopy(application)
    projection["need"].update(purpose="working_capital", preferred_product="working_capital_loan",
                              financing_pattern="gradual_repayment", minimum_acceptable_amount=None)
    policy = replace(POLICY, principal_grace_months=project["principal_grace_months"])
    result = assess_application(projection, checks, calculated_at=now, stage=stage, assessment_id=assessment_id,
        policy=policy, financial_policy=replace(FinancialPolicy(), version=policy.version)).to_dict()
    assessment = result.get("assessment")
    if assessment:
        messages = {
            "risk_grade_not_eligible": "Уровень риска не проходит автоматические правила инвестиционного кредита.",
            "no_payment_capacity": "С учётом действующих обязательств нет доступного платежа для нового кредита.",
            "requested_amount_below_minimum": "Сумма кредита ниже минимума 100 000 ₽.",
            "no_eligible_offer": "Нет допустимых условий полного финансирования проекта. Уточните стоимость проекта или собственный взнос.",
        }
        for reason in assessment["reasons"]:
            if reason["code"] in messages:
                reason["message"] = messages[reason["code"]]
        # Меньшая сумма без дополнительного взноса оставила бы проект без финансирования.
        offers = [offer for offer in assessment["offers"] if offer["amount"] == project["loan_amount"]]
        for offer in offers:
            calc = calculate_loan(offer["amount"], offer["term_months"], offer["annual_rate_percent"],
                                  principal_grace_months=project["principal_grace_months"]).to_dict()["calculation"]
            offer.update(product_id=PRODUCT, monthly_payment=calc["maximum_payment"], total_interest=calc["total_interest"],
                schedule=payment_calendar(calc["schedule"], now.astimezone(MOSCOW).date()),
                investment={**project, "grace_monthly_payment": calc["schedule"][0]["total_payment"] if project["principal_grace_months"] else "0.00",
                            "repayment_months": offer["term_months"] - project["principal_grace_months"]})
        assessment["offers"] = offers
        if not offers and (assessment["outcome"] in ("approved", "conditional_approval", "alternative_offers") or
                           any(item["field"] == "need.minimum_acceptable_amount" for item in assessment["required_information"])):
            assessment.update(outcome="needs_information", required_information=[{"field": "need.own_funds", "code": "project_funding_gap",
                "question": "Полная сумма проекта не укладывается в доступный платёж. Увеличьте собственный взнос или уменьшите стоимость проекта."}],
                reasons=[{"code": "project_funding_gap", "message": "Не предлагаем меньший кредит, который не покроет стоимость проекта."}])
    return InvestmentResult(result)


def investment_options(application, checks, *, calculated_at, preferences=None, exploration_id=None):
    preferences = preferences or {}
    identity, options, last, before = exploration_id or str(uuid4()), [], None, False
    for term in POLICY.terms:
        if not preferences.get("minimum_term", 12) <= term <= preferences.get("maximum_term", 60):
            continue
        projection = deepcopy(application)
        projection["need"]["term_months"] = term
        last = assess_investment(projection, checks, calculated_at=calculated_at, stage="preliminary").to_dict()
        for offer in (last.get("assessment") or {}).get("offers", []):
            if offer["term_months"] != term:
                continue
            before = True
            if preferences.get("maximum_monthly_payment") and Decimal(offer["monthly_payment"]) > Decimal(preferences["maximum_monthly_payment"]):
                continue
            offer.update(option_id=f"{identity}-{term}", labels=[], available_monthly_payment=(last.get("financial_metrics") or {}).get("available_monthly_payment"))
            options.append(offer)
    if last is None:
        raise ValueError("Для инвестиционного кредита доступны сроки 12, 24, 36, 48 и 60 месяцев.")
    if options:
        min(options, key=lambda offer: Decimal(offer["total_repayment"]))["labels"].append("Минимальная переплата")
        min(options, key=lambda offer: Decimal(offer["monthly_payment"]))["labels"].append("Минимальный платёж после отсрочки")
        options.sort(key=lambda offer: Decimal(offer["monthly_payment"] if preferences.get("priority") == "lowest_payment" else offer["total_repayment"]))
    assessment = last.get("assessment") or {}
    return {"product_id": PRODUCT, "status": "options_ready" if options else "no_matching_options" if before else assessment.get("outcome", last["status"]),
        "options": options, "preferences": preferences, "required_information": [] if options or before else assessment.get("required_information", []),
        "issues": [] if options or before else last.get("issues", []), "reasons": [] if options else [{"code": "investment_budget", "message": "Предложения не укладываются в выбранное ограничение платежа. Измените настройки."}] if before else assessment.get("reasons", [])}
