"""Примеры проверки предложений перед подписанием для обоих продуктов."""

import argparse
from copy import deepcopy
from datetime import datetime, timedelta
import sys

from credit_engine import check_offer_readiness
from .run_credit_scenarios import json_text, load_scenarios, run_scenario


def build_examples() -> list[dict]:
    def case(case_id, scenario_id="01_approved", product="working_capital_loan", stage="final"):
        scenario = deepcopy(load_scenarios(scenario_id, product=product)[0])
        scenario["input"]["stage"] = stage
        assessment = run_scenario(scenario)["assessment"]
        application = scenario["input"]["application"]
        return {
            "case_id": case_id,
            "input": {
                "application": application,
                "assessment": assessment,
                "application_state": {
                    "application_id": application["application_id"],
                    "application_version": application["application_version"],
                    "status": "offers_ready", "current_step": "offer_selection",
                    "latest_assessment_id": assessment["assessment_id"],
                    "selected_offer_id": assessment["offers"][0]["offer_id"],
                    "next_action": {"type": "select_offer", "label": "Выбрать предложение"},
                    "updated_at": assessment["calculated_at"],
                },
                "checked_at": (datetime.fromisoformat(assessment["calculated_at"]) + timedelta(minutes=1)).isoformat(),
                "fulfilled_condition_codes": [],
            },
            "expected_status": "ready_to_sign",
        }

    loan = case("loan_ready")
    overdraft = case("overdraft_ready", "01_overdraft_approved", "overdraft")
    pending = case("guarantee_pending", "05_guarantor_required")
    pending["expected_status"] = "conditions_pending"
    completed = deepcopy(pending)
    completed["case_id"] = "guarantee_completed"
    completed["input"]["fulfilled_condition_codes"] = ["guarantee_required"]
    completed["expected_status"] = "ready_to_sign"
    expired = case("offer_expired")
    expired["input"]["checked_at"] = expired["input"]["assessment"]["offers"][0]["valid_until"]
    expired["expected_status"] = "offer_expired"
    changed = case("application_changed")
    changed["input"]["application"]["application_version"] += 1
    changed["input"]["application"]["confirmation"] = None
    changed["input"]["application_state"]["application_version"] += 1
    changed["expected_status"] = "reassessment_required"
    preliminary = case("preliminary_offer", stage="preliminary")
    preliminary["expected_status"] = "not_available"
    signed = case("already_signed")
    signed["input"]["application_state"]["status"] = "signed"
    signed["expected_status"] = "not_available"
    return [loan, overdraft, pending, completed, expired, changed, preliminary, signed]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Вывести полные входы и результаты")
    args = parser.parse_args(argv)
    examples = build_examples()
    failures = 0
    for example in examples:
        example["actual"] = check_offer_readiness(**example["input"]).to_dict()
        matches = example["actual"]["status"] == example["expected_status"]
        failures += not matches
        if not args.json:
            print(f"{'OK' if matches else 'FAIL'} {example['case_id']}: {example['actual']['status']}")
    if args.json:
        print(json_text(examples), end="")
    return 1 if failures else 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
