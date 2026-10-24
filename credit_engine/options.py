"""Подбор нескольких условий и расчёт изменений без изменения исходной заявки."""

from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, ROUND_CEILING
from uuid import uuid4

from .assessment import WorkingCapitalPolicy, assess_application
from .checks import parse_timestamp
from .loans import calculate_loan
from .financials import MONEY_PATTERN
from .overdraft import OverdraftPolicy, calculate_overdraft
from .overdraft_assessment import OverdraftCreditPolicy, assess_overdraft


def _baseline(application):
    need = application.get("need") or {}
    result = calculate_loan(need.get("requested_amount"), need.get("term_months"), WorkingCapitalPolicy().annual_rate_percent)
    return result.to_dict().get("calculation")


def loan_options(application, checks, *, calculated_at, preferences=None, exploration_id=None, seasonal=False):
    """Проверить все сроки политики; меньшие суммы — только с подтверждённым минимумом."""
    preferences = preferences or {}
    identity = exploration_id or str(uuid4())
    projection = deepcopy(application)
    need = projection.setdefault("need", {})
    if preferences.get("requested_amount") is not None:
        need["requested_amount"] = preferences["requested_amount"]
    need["preferred_product"] = "working_capital_loan"
    policy = WorkingCapitalPolicy()
    options, evaluations, seen = [], [], set()
    minimum_term = preferences.get("minimum_term", min(policy.terms))
    maximum_term = preferences.get("maximum_term", max(policy.terms))
    payment_ceiling = Decimal(preferences["maximum_monthly_payment"]) if preferences.get("maximum_monthly_payment") else None
    required_gap = Decimal("0.00")
    plan = projection.get("product_details", {}).get("overdraft")
    if need.get("financing_pattern") == "cash_gap" and plan:
        gap = calculate_overdraft(plan, "3000000.00")
        if gap.calculation:
            required_gap = gap.calculation.required_limit
    for term in policy.terms:
        candidate = deepcopy(projection)
        candidate["need"]["term_months"] = term
        evaluated = assess_application(candidate, checks, calculated_at=calculated_at, stage="preliminary", seasonal=seasonal).to_dict()
        evaluations.append(evaluated)
        assessment = evaluated.get("assessment") or {}
        for offer in assessment.get("offers", []):
            key = offer["amount"], offer["term_months"]
            if key in seen or offer["term_months"] != term or Decimal(offer["amount"]) < required_gap:
                continue
            if preferences.get("preserve_amount", True) and Decimal(offer["amount"]) != Decimal(need["requested_amount"]):
                continue
            seen.add(key)
            calc = calculate_loan(offer["amount"], term, offer["annual_rate_percent"]).to_dict()["calculation"]
            capacity = evaluated["financial_metrics"]["available_monthly_payment"]
            options.append({**offer, "option_id": f"{identity}-{len(options)+1}", "schedule": calc["schedule"],
                            "total_interest": calc["total_interest"], "maximum_payment": calc["maximum_payment"],
                            "available_monthly_payment": capacity,
                            "payment_headroom": str(Decimal(capacity) - Decimal(calc["maximum_payment"])), "labels": []})
    before_filter = len(options)
    options = [option for option in options if minimum_term <= option["term_months"] <= maximum_term
               and (payment_ceiling is None or Decimal(option["maximum_payment"]) <= payment_ceiling)]
    priority = preferences.get("priority") or need.get("priority") or "preserve_amount"
    options.sort(key=lambda item: (-Decimal(item["amount"]),
        Decimal(item["maximum_payment"]) if priority == "lowest_payment" else Decimal(item["total_interest"]), item["term_months"]))
    for amount in {option["amount"] for option in options}:
        group = [option for option in options if option["amount"] == amount]
        min(group, key=lambda option: Decimal(option["maximum_payment"]))["labels"].append("Минимальный платёж для этой суммы")
        min(group, key=lambda option: Decimal(option["total_interest"]))["labels"].append("Минимальная переплата для этой суммы")
    original = application.get("need") or {}
    for option in options:
        if option["amount"] == (f"{Decimal(original['requested_amount']):.2f}" if isinstance(original.get("requested_amount"), str) and MONEY_PATTERN.fullmatch(original["requested_amount"]) else None) and option["term_months"] == original.get("term_months"):
            option["labels"].append("Исходный запрос")
    questions, issues, reasons = [], [], []
    for evaluated in evaluations:
        assessment = evaluated.get("assessment") or {}
        questions.extend(assessment.get("required_information", []))
        issues.extend(evaluated.get("issues", []))
        reasons.extend(assessment.get("reasons", []))
    def unique(items):
        return list({tuple(sorted(item.items())): item for item in items}.values())
    if options:
        status = "options_ready"
        questions, issues, reasons = [], [], []
    elif before_filter:
        status = "no_matching_options"
        reasons = [{"code": "preferences_exclude_options", "message": "Допустимые предложения есть, но они не укладываются в выбранные ограничения платежа или срока."}]
        questions, issues = [], []
    elif any(item["status"] == "check_retry_pending" for item in evaluations):
        status = "check_retry_pending"
    elif any(item["status"] == "needs_checks" for item in evaluations):
        status = "needs_checks"
    elif questions:
        status = "needs_information"
    elif issues:
        status = "invalid_data"
    else:
        status = "not_eligible"
    return {"product_id": "working_capital_loan", "status": status, "options": options,
            "baseline": _baseline(application), "available_before_filters": before_filter,
            "preferences": preferences, "required_information": unique(questions), "issues": unique(issues), "reasons": unique(reasons)}


def overdraft_options(application, checks, *, calculated_at, delay=None, exploration_id=None, seasonal=False):
    """Потребность в лимите и проверка изменённого плана; даты исходной заявки сохраняются."""
    projection = deepcopy(application)
    projection["need"]["preferred_product"] = "overdraft"
    plan = projection.get("product_details", {}).get("overdraft")
    requested = projection["need"].get("requested_amount")
    valid_requested = isinstance(requested, str) and MONEY_PATTERN.fullmatch(requested) and Decimal(requested) > 0
    original_calculation = calculate_overdraft(plan, requested if valid_requested else "3000000.00").to_dict()
    horizon_question = []
    if delay and plan:
        transaction = next((row for row in plan.get("transactions", []) if row.get("transaction_id") == delay["transaction_id"]), None)
        if not transaction or transaction.get("direction") != "inflow":
            raise ValueError("Для переноса выберите существующее поступление.")
        shifted = date.fromisoformat(transaction["date"]) + timedelta(days=delay["days"])
        if shifted > date.fromisoformat(plan["end_date"]):
            horizon_question = [{"field": "product_details.overdraft.end_date", "code": "delay_outside_horizon",
                "question": "Перенесённое поступление выходит за период плана. Продлите период и подтвердите расходы и поступления до новой даты."}]
        else:
            transaction["date"] = shifted.isoformat()
    raw = calculate_overdraft(plan, "3000000.00")
    calculation = raw.to_dict().get("calculation")
    suggested = None
    if calculation and Decimal(calculation["required_limit"]) > 0:
        policy = OverdraftCreditPolicy()
        suggested = max(policy.minimum_limit, (Decimal(calculation["required_limit"]) / policy.limit_step).to_integral_value(rounding=ROUND_CEILING) * policy.limit_step)
        requested = projection["need"].get("requested_amount")
        if requested is None or (valid_requested and Decimal(requested) < suggested):
            projection["need"]["requested_amount"] = f"{suggested:.2f}"
    evaluated = assess_overdraft(projection, checks, calculated_at=calculated_at, stage="preliminary", seasonal=seasonal).to_dict()
    assessment = evaluated.get("assessment") or {}
    verified_calculation = evaluated.get("overdraft_calculation")
    options = []
    if not horizon_question:
        for index, offer in enumerate(assessment.get("offers", []), 1):
            options.append({**offer, "option_id": f"{exploration_id or uuid4()}-{index}", "labels": ["Покрывает подтверждённый план"],
                            "suggested_limit": suggested is not None and offer["amount"] != application["need"].get("requested_amount")})
    status = ("needs_information" if horizon_question else "options_ready" if options else
              assessment.get("outcome") if assessment else evaluated["status"])
    if projection["need"].get("financing_pattern") == "gradual_repayment":
        options = []
        status = "not_eligible"
        assessment = {"reasons": [{"code": "product_pattern_conflict", "message": "Для постепенного возврата по графику используйте разовый кредит; овердрафт требует погашения из ближайших поступлений."}]}
    def chart(source):
        if not source:
            return []
        cash = Decimal(source["daily"][0]["opening_cash"]) if source["daily"] else Decimal("0.00")
        rows = []
        for row in source["daily"]:
            cash += Decimal(row["inflow"]) - Decimal(row["outflow"])
            rows.append({**row, "cash_without_financing": f"{cash:.2f}"})
        return rows
    return {"product_id": "overdraft", "status": status, "options": options, "delay": delay,
            "required_information": horizon_question or assessment.get("required_information", []),
            "issues": evaluated.get("issues", []), "reasons": ([{"code": "delay_outside_horizon", "message": "Для проверки задержки нужно дополнить период плана."}] if horizon_question else assessment.get("reasons", [])),
            "baseline": original_calculation.get("calculation"), "calculation": verified_calculation or calculation,
            "daily": chart(verified_calculation or calculation), "baseline_daily": chart(original_calculation.get("calculation")),
            "projected_plan": plan, "limit_calculation": evaluated.get("limit_calculation"),
            "suggested_amount": f"{suggested:.2f}" if suggested is not None else None,
            "horizon_extension_required": bool(horizon_question)}
