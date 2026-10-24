"""Immutable explanation of the exact deterministic assessment, never an LLM opinion."""

from copy import deepcopy
from dataclasses import asdict
from decimal import Decimal

from credit_engine.assessment import WorkingCapitalPolicy
from credit_engine.overdraft_assessment import OverdraftCreditPolicy
from credit_engine.investment import POLICY as INVESTMENT, MINIMUM_OWN_SHARE
from credit_engine.revolving import POLICY as REVOLVING
from credit_engine.refinancing import POLICY as REFINANCING


def decision_trace(application, checks, result, *, calculated_at, seasonal=False):
    product = application["need"].get("preferred_product")
    policy = {"overdraft": OverdraftCreditPolicy(), "investment_loan": INVESTMENT,
              "revolving_credit_line": REVOLVING, "refinancing": REFINANCING}.get(product, WorkingCapitalPolicy())
    assessment = result.get("assessment") or {}
    metrics, scoring = result.get("financial_metrics"), result.get("scoring")
    metrics, scoring = metrics or {}, scoring or {}
    issues = result.get("issues") or []
    reasons = assessment.get("reasons") or []
    information = assessment.get("required_information") or []
    offers = assessment.get("offers") or []
    constraints = asdict(policy)
    constraints = {key: str(value) if isinstance(value, Decimal) else list(value) if isinstance(value, tuple) else value
                   for key, value in constraints.items()}
    if product == "investment_loan":
        constraints["minimum_own_share"] = str(MINIMUM_OWN_SHARE)
        constraints["principal_grace_months"] = (application["need"].get("principal_grace_months") or 0)
    if product == "overdraft":
        constraints["calculation"] = result.get("limit_calculation")
    if product == "refinancing":
        constraints["selected_debts"] = result.get("refinancing")
    return deepcopy({
        "schema_version": 1, "application_id": application["application_id"],
        "application_version": application["application_version"],
        "assessment_id": assessment.get("assessment_id"), "calculated_at": calculated_at.isoformat(),
        "stage": assessment.get("stage"), "product_id": product,
        "policy_version": assessment.get("policy_version", policy.version),
        "steps": [
            {"id": "data", "status": "calculated" if metrics else "attention",
             "values": {"history_months": [row["month"] for row in metrics.get("monthly_cash_flow", [])],
                        "sources": ["Банковский профиль", "Параметры заявки", "Демонстрационные внешние проверки"],
                        "checks": {key: {field: value.get(field) for field in ("status", "category", "checked_at") if field in value}
                                   for key, value in (checks or {}).items() if isinstance(value, dict)},
                        "issues": issues}},
            {"id": "risk", "status": "calculated" if scoring.get("status") == "calculated" else "not_calculated",
             "values": scoring},
            {"id": "capacity", "status": "calculated" if metrics else "not_calculated",
             "values": {key: metrics[key] for key in ("average_monthly_cash_flow", "underwriting_cash_flow",
                 "total_debt_service_limit", "existing_monthly_debt_service", "available_monthly_payment", "nonpositive_cash_flow_months") if key in metrics}
                 | {"debt_service_fraction": "0.70", "seasonal": seasonal,
                    "replaced_debt_excluded": product == "refinancing" and bool(result.get("refinancing"))}},
            {"id": "product", "status": "calculated" if assessment else "not_calculated",
             "values": {"policy": constraints, "reasons": reasons}},
            {"id": "result", "status": "calculated" if assessment else "attention",
             "values": {"outcome": assessment.get("outcome", result["status"]), "reasons": reasons,
                        "required_information": information,
                        "offers": [{**{key: offer.get(key) for key in ("offer_id", "amount", "term_months", "annual_rate_percent", "monthly_payment")},
                                    "capacity_reserve": (offer.get("revolving") or {}).get("capacity_reserve")} for offer in offers]}},
        ],
    })
