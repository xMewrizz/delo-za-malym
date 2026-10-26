"""Read-only, preliminary financing bounds from the current bank profile."""
from copy import deepcopy
from dataclasses import replace
from decimal import Decimal

from credit_engine.assessment import WorkingCapitalPolicy, assess_application
from credit_engine.financials import FinancialPolicy
from credit_engine.investment import POLICY as INVESTMENT
from credit_engine.revolving import POLICY as REVOLVING
from credit_engine.overdraft_assessment import assess_overdraft, OverdraftCreditPolicy
from . import demo
from .product_rules import product_fingerprint


def financing_capacity(profile, simulator, now, *, principal_grace_months=0):
    simulator = deepcopy(simulator)
    simulator["known_loans"] = deepcopy(profile["financials"].get("existing_loans", []))
    simulator["bank_financials"] = deepcopy(profile["financials"])
    application = {"schema_version":"0.1", "currency":"RUB", "application_id":"capacity-preview",
                   "application_version":1, "business":deepcopy(profile["business"]),
                   "financials":deepcopy(profile["financials"]), "need":{}}
    seasonal = simulator.get("cash_flow_policy") == "seasonal-v2"
    checks = demo.simulate_checks(application, simulator, now)
    products = []
    for product, policy in (("working_capital_loan", WorkingCapitalPolicy()),
                            ("revolving_credit_line", REVOLVING), ("investment_loan", INVESTMENT)):
        if product == "investment_loan":
            policy = replace(policy,principal_grace_months=principal_grace_months)
        terms, reasons, payment = [], [], None
        for term in policy.terms:
            candidate = deepcopy(application)
            candidate["need"] = {"purpose":"working_capital", "preferred_product":"working_capital_loan",
                "requested_amount":str(policy.maximum_amount), "minimum_acceptable_amount":str(policy.minimum_amount),
                "term_months":term, "financing_pattern":"gradual_repayment"}
            # One term per assessment: a longer-term alternative must not be
            # presented as available at the term currently displayed.
            result = assess_application(candidate, checks, calculated_at=now, stage="preliminary",
                policy=replace(policy,terms=(term,)), financial_policy=replace(FinancialPolicy(),version=policy.version),
                seasonal=seasonal).to_dict()
            assessment = result.get("assessment") or {}
            reasons = assessment.get("reasons", []) or result.get("issues", [])
            payment = (result.get("financial_metrics") or {}).get("available_monthly_payment")
            offers = assessment.get("offers", [])
            if offers:
                maximum = max(Decimal(item["amount"]) for item in offers if item["term_months"] == term)
                terms.append({"term_months":term,"maximum_amount":f"{maximum:.2f}"})
        maximum = max((Decimal(item["maximum_amount"]) for item in terms),default=Decimal("0"))
        products.append({"product_id":product,"status":"available" if terms else "unavailable",
            "maximum_amount":f"{maximum:.2f}","available_monthly_payment":payment,"terms":terms,
            "reasons":[] if terms else reasons,"rules_fingerprint":product_fingerprint(product)})
    candidate = deepcopy(application)
    candidate["need"] = {"purpose":"working_capital","preferred_product":"overdraft","financing_pattern":"cash_gap"}
    result = assess_overdraft(candidate,checks,calculated_at=now,stage="preliminary",seasonal=seasonal).to_dict()
    limit = (result.get("limit_calculation") or {}).get("maximum_eligible_limit")
    eligible_limit = limit is not None and Decimal(limit)>=OverdraftCreditPolicy().minimum_limit
    products.append({"product_id":"overdraft","status":"plan_required" if eligible_limit else "unavailable",
        "maximum_amount":limit,"available_monthly_payment":(result.get("financial_metrics") or {}).get("available_monthly_payment"),
        "terms":[],"reasons":[] if eligible_limit else (result.get("assessment") or {}).get("reasons",[]),
        "rules_fingerprint":product_fingerprint("overdraft")})
    products.append({"product_id":"refinancing","status":"selection_required","maximum_amount":None,
        "available_monthly_payment":None,"terms":[],"reasons":[],"rules_fingerprint":product_fingerprint("refinancing")})
    return {"calculated_at":now.isoformat(),"preliminary":True,"products":products}
