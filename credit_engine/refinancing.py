"""Рефинансирование известных обязательств без выдачи дополнительных денег."""

from copy import deepcopy
from dataclasses import replace
from datetime import date
from decimal import Decimal
from uuid import uuid4

from .assessment import WorkingCapitalPolicy, assess_application
from .checks import parse_timestamp
from .financials import FinancialPolicy, MONEY_PATTERN
from .loans import calculate_loan
from .cashflow import payment_calendar


POLICY = replace(WorkingCapitalPolicy(), version="demo-refinancing-v1", amount_step=Decimal("0.01"),
                 annual_rate_percent="20.00", terms=(6, 12, 18, 24, 36, 48))


class RefinancingResult:
    def __init__(self, value):
        self.value = value

    def to_dict(self):
        return deepcopy(self.value)


def selected_debts(application, now):
    details = (application.get("product_details") or {}).get("refinancing") or {}
    if not isinstance(details, dict) or set(details) - {"loan_ids"}:
        raise ValueError("Выберите кредиты для замены; суммы и графики берём из банка.")
    ids = details.get("loan_ids")
    if not isinstance(ids, list) or not ids or len(ids) > 20 or any(not isinstance(item, str) for item in ids) or len(set(ids)) != len(ids):
        raise ValueError("Выберите от одного до двадцати разных действующих кредитов.")
    loans = application.get("financials", {}).get("existing_loans") or []
    selected = [loan for loan in loans if loan.get("loan_id") in ids]
    if len(selected) != len(ids):
        raise ValueError("Один из выбранных кредитов уже закрыт или отсутствует в банковском профиле. Обновите выбор.")
    principal, monthly, total, schedules = Decimal("0.00"), Decimal("0.00"), Decimal("0.00"), []
    today = now.date().isoformat()
    for loan in selected:
        if loan.get("is_commitment"):
            raise ValueError("Возобновляемая линия имеет отдельный лимит. Погасите и закройте её в разделе «Моё финансирование».")
        balance, payment = loan.get("outstanding_principal"), loan.get("monthly_payment")
        if any(not isinstance(value, str) or not MONEY_PATTERN.fullmatch(value) or Decimal(value) <= 0 for value in (balance, payment)):
            raise ValueError("Банк должен уточнить остаток долга и платёж по выбранному кредиту.")
        rows = loan.get("schedule")
        if not isinstance(rows, list) or not rows:
            raise ValueError("Для сравнения стоимости нужен оставшийся график выбранного кредита из банка.")
        remaining = []
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("График выбранного кредита требует обновления банком.")
            when, amount = row.get("date"), row.get("total_payment")
            if not isinstance(when, str) or date.fromisoformat(when).isoformat() != when or not isinstance(amount, str) or not MONEY_PATTERN.fullmatch(amount) or Decimal(amount) <= 0:
                raise ValueError("График выбранного кредита требует обновления банком.")
            if when >= today:
                remaining.append(deepcopy(row))
        if not remaining or sum((Decimal(row["total_payment"]) for row in remaining), Decimal("0")) < Decimal(balance):
            raise ValueError("Оставшийся график не покрывает известный долг. Банк должен обновить график и сумму погашения.")
        principal += Decimal(balance)
        monthly += Decimal(payment)
        total += sum((Decimal(row["total_payment"]) for row in remaining), Decimal("0"))
        schedules.append({"loan_id": loan["loan_id"], "outstanding_principal": balance,
                          "monthly_payment": payment, "schedule": remaining})
    return {"loan_ids": sorted(ids), "payoff_amount": f"{principal:.2f}",
            "current_monthly_payment": f"{monthly:.2f}", "current_total_repayment": f"{total:.2f}",
            "current_remaining_cost": f"{total - principal:.2f}", "loans": schedules,
            "payoff_fees": "0.00", "cash_to_client": "0.00"}


def assessment_question(application, now, message, *, stage, assessment_id=None):
    return {"status": "assessed", "assessment": {
        "schema_version": "0.1", "assessment_id": assessment_id or str(uuid4()),
        "application_id": application.get("application_id"), "application_version": application.get("application_version"),
        "stage": stage, "outcome": "needs_information", "risk_grade": None,
        "reasons": [{"code": "refinancing_selection_required", "message": message}],
        "required_information": [{"field": "product_details.refinancing.loan_ids", "code": "refinancing_selection_required", "question": message}],
        "offers": [], "policy_version": POLICY.version, "catalog_version": POLICY.version,
        "calculated_at": now.isoformat()}, "issues": [], "refinancing": None}


def assess_refinancing(application, checks, *, calculated_at, stage="final", assessment_id=None):
    now = parse_timestamp(calculated_at)
    if now is None:
        return RefinancingResult({"status": "invalid_data", "assessment": None, "issues": [{"field": "calculated_at", "code": "invalid_timestamp", "message": "Нужно время расчёта."}]})
    try:
        comparison = selected_debts(application, now)
    except (ValueError, TypeError, KeyError) as exc:
        return RefinancingResult(assessment_question(application, now, str(exc), stage=stage, assessment_id=assessment_id))
    projection = deepcopy(application)
    need = projection["need"]
    if need.get("purpose") != "refinancing" or need.get("preferred_product") != "refinancing":
        return RefinancingResult(assessment_question(application, now, "Выберите рефинансирование действующих кредитов.", stage=stage))
    if need.get("requested_amount") != comparison["payoff_amount"]:
        return RefinancingResult(assessment_question(application, now, "Сумма рефинансирования должна совпадать с долгом по выбранным кредитам.", stage=stage))
    need.update(purpose="working_capital", preferred_product="working_capital_loan", minimum_acceptable_amount=None, own_funds=None)
    projection["financials"]["existing_loans"] = [loan for loan in projection["financials"].get("existing_loans", [])
                                                   if loan["loan_id"] not in comparison["loan_ids"]]
    result = assess_application(projection, checks, calculated_at=now, stage=stage, assessment_id=assessment_id,
                                policy=POLICY, financial_policy=replace(FinancialPolicy(), version=POLICY.version)).to_dict()
    result["refinancing"] = comparison
    assessment = result.get("assessment")
    if assessment:
        offers = [offer for offer in assessment["offers"] if offer["amount"] == comparison["payoff_amount"]]
        for offer in offers:
            offer["product_id"] = "refinancing"
            calc = calculate_loan(offer["amount"], offer["term_months"], offer["annual_rate_percent"]).to_dict()["calculation"]
            offer.update(total_interest=calc["total_interest"], schedule=payment_calendar(calc["schedule"], now.date()), refinancing={
                **comparison, "monthly_payment_reduction": f'{Decimal(comparison["current_monthly_payment"]) - Decimal(offer["monthly_payment"]):.2f}',
                "total_cost_change": f'{Decimal(offer["total_repayment"]) - Decimal(comparison["current_total_repayment"]):.2f}'})
        assessment["offers"] = offers
        if offers:
            assessment["reasons"] = [{"code": "refinancing_eligible", "message": "Нагрузка проверена после замены выбранных обязательств. Дополнительные деньги на счёт не выдаются."}]
        elif assessment["outcome"] in ("approved", "conditional_approval", "alternative_offers") or any(item["field"] == "need.minimum_acceptable_amount" for item in assessment["required_information"]):
            assessment.update(outcome="declined", required_information=[], reasons=[{"code": "refinancing_not_affordable", "message": "Нет допустимого варианта, который полностью погасит выбранные кредиты. Уменьшите набор обязательств для замены."}])
    return RefinancingResult(result)


def refinancing_options(application, checks, *, calculated_at, preferences=None, exploration_id=None):
    preferences = preferences or {}
    now = parse_timestamp(calculated_at)
    options, last, issues = [], None, []
    eligible_before_preferences = False
    identity = exploration_id or str(uuid4())
    for term in POLICY.terms:
        if not preferences.get("minimum_term", 6) <= term <= preferences.get("maximum_term", 48):
            continue
        projection = deepcopy(application)
        projection["need"]["term_months"] = term
        last = assess_refinancing(projection, checks, calculated_at=now, stage="preliminary").to_dict()
        issues.extend(last.get("issues", []))
        offers = (last.get("assessment") or {}).get("offers", [])
        eligible_before_preferences = eligible_before_preferences or bool(offers)
        for offer in offers:
            if offer["term_months"] != term:
                continue
            limit = preferences.get("maximum_monthly_payment")
            if limit and Decimal(offer["monthly_payment"]) > Decimal(limit):
                continue
            offer.update(option_id=f"{identity}-{term}", labels=[],
                available_monthly_payment=(last.get("financial_metrics") or {}).get("available_monthly_payment"))
            options.append(offer)
    if options:
        min(options, key=lambda item: Decimal(item["total_repayment"]))["labels"].append("Минимальная оставшаяся стоимость")
        min(options, key=lambda item: Decimal(item["monthly_payment"]))["labels"].append("Минимальный платёж")
        priority = preferences.get("priority") or application["need"].get("priority")
        options.sort(key=lambda item: Decimal(item["monthly_payment"] if priority == "lowest_payment" else item["total_repayment"]))
    if last is None:
        raise ValueError("В выбранном диапазоне нет сроков рефинансирования.")
    assessment = last.get("assessment") or {}
    constrained = not options and eligible_before_preferences
    return {"product_id": "refinancing", "status": "options_ready" if options else "no_matching_options" if constrained else assessment.get("outcome", last["status"]),
            "options": options, "refinancing": last.get("refinancing"), "preferences": preferences,
            "required_information": [] if options or constrained else assessment.get("required_information", []),
            "reasons": [] if options else [{"code": "preferences_exclude_options", "message": "Допустимые предложения есть, но не укладываются в выбранные ограничения платежа или срока. Измените настройки сравнения."}] if constrained else assessment.get("reasons", []),
            "issues": issues if not options and not constrained else []}
