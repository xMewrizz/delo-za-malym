"""Запускаемые примеры выбора между разовым кредитом и овердрафтом."""

import argparse
from copy import deepcopy
import sys

from credit_engine import recommend_financing
from .run_credit_scenarios import json_text, load_scenarios


def build_cases():
    def case(case_id, *, product="working_capital_loan", scenario="01_approved", pattern=None,
             expected_status="recommendations_ready", expected_product="working_capital_loan"):
        source = deepcopy(load_scenarios(scenario, product=product)[0]["input"])
        source["application"]["need"].update(preferred_product=None, financing_pattern=pattern)
        return {"case_id": case_id, "input": {"application": source["application"], "checks": source["checks"],
                "calculated_at": source["calculated_at"], "recommendation_id": f"selection-{case_id}"},
                "expected_status": expected_status, "expected_product": expected_product}

    unknown = case("01_clarify_task", expected_status="needs_information", expected_product=None)
    loan = case("02_gradual_repayment", pattern="gradual_repayment")
    overdraft = case("03_short_gap", product="overdraft", scenario="01_overdraft_approved", pattern="cash_gap", expected_product="overdraft")
    missing = case("04_gap_without_plan", pattern="cash_gap", expected_status="needs_information", expected_product=None)
    both = deepcopy(overdraft)
    both.update(case_id="05_both_products")
    both["input"]["recommendation_id"] = "selection-05_both_products"
    both["input"]["application"]["need"]["term_months"] = 12
    alternative = case("06_loan_instead_of_limit", product="overdraft", scenario="06_overdraft_declined", pattern="cash_gap")
    alternative["input"]["application"]["need"]["term_months"] = 12
    term = case("07_clarify_loan_term", product="overdraft", scenario="06_overdraft_declined", pattern="cash_gap",
                expected_status="needs_information", expected_product=None)
    prohibited = case("08_financing_prohibited", pattern="gradual_repayment", expected_status="not_eligible", expected_product=None)
    prohibited["input"]["checks"]["restrictions"]["financing_prohibited"] = True
    no_gap = deepcopy(overdraft)
    no_gap.update(case_id="09_no_gap", expected_status="not_eligible", expected_product=None)
    no_gap["input"]["recommendation_id"] = "selection-09_no_gap"
    no_gap["input"]["application"]["financials"]["cash_balance"] = "500000.00"
    no_gap["input"]["application"]["product_details"]["overdraft"]["opening_cash_balance"] = "500000.00"
    return [unknown, loan, overdraft, missing, both, alternative, term, prohibited, no_gap]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Вывести полные входы и рассчитанные рекомендации")
    args = parser.parse_args(argv)
    cases = build_cases()
    failures = 0
    for case in cases:
        result = recommend_financing(**case["input"]).to_dict()
        case["actual"] = result
        matches = result["status"] == case["expected_status"] and result["recommended_product_id"] == case["expected_product"]
        failures += not matches
        if not args.json:
            print(f"{'OK' if matches else 'FAIL'} {case['case_id']}: {result['status']} / {result['recommended_product_id'] or 'нужен следующий шаг'}")
    if args.json:
        print(json_text(cases), end="")
    return 1 if failures else 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
