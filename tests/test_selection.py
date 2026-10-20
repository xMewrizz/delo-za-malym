from copy import deepcopy
from datetime import date, timedelta
import json
import unittest

from credit_engine import recommend_financing
from scripts.run_credit_scenarios import load_scenarios


def inputs(product="working_capital_loan", scenario=None):
    scenario = scenario or ("01_overdraft_approved" if product == "overdraft" else "01_approved")
    return deepcopy(load_scenarios(scenario, product=product)[0]["input"])


def select(source, **kwargs):
    return recommend_financing(source["application"], source["checks"],
                               calculated_at=source["calculated_at"], recommendation_id="selection-demo", **kwargs)


class FinancingSelectionTests(unittest.TestCase):
    def test_without_product_or_repayment_pattern_asks_about_the_task(self):
        source = inputs()
        source["application"]["need"]["preferred_product"] = None
        result = select(source)
        self.assertEqual(result.status, "needs_information")
        self.assertEqual(result.required_information[0]["field"], "need.financing_pattern")
        self.assertIsNone(result.recommended_product_id)

    def test_repeated_expenses_alone_do_not_imply_overdraft(self):
        source = inputs()
        source["application"]["need"].update(preferred_product=None, recurring=True)
        self.assertEqual(select(source).required_information[0]["field"], "need.financing_pattern")

    def test_gradual_repayment_selects_loan_and_excludes_overdraft(self):
        source = inputs()
        source["application"]["need"].update(preferred_product=None, financing_pattern="gradual_repayment")
        result = select(source)
        self.assertEqual(result.status, "recommendations_ready")
        self.assertEqual(result.recommended_product_id, "working_capital_loan")
        self.assertEqual(result.candidates[1]["eligibility"], "not_suitable")
        self.assertEqual(result.candidates[1]["offers"], [])

    def test_short_gap_selects_overdraft_without_inventing_a_loan_term(self):
        source = inputs("overdraft")
        source["application"]["need"].update(preferred_product=None, financing_pattern="cash_gap")
        original = deepcopy(source)
        result = select(source)
        self.assertEqual(result.recommended_product_id, "overdraft")
        self.assertEqual(result.candidates[0]["offers"][0]["product_id"], "overdraft")
        self.assertEqual(result.candidates[1]["eligibility"], "needs_information")
        self.assertIsNone(source["application"]["need"]["term_months"])
        self.assertEqual(source, original)

    def test_a_gap_without_a_plan_requests_it_even_when_a_loan_passes(self):
        source = inputs()
        source["application"]["need"].update(preferred_product=None, financing_pattern="cash_gap")
        result = select(source)
        self.assertEqual(result.status, "needs_information")
        self.assertIsNone(result.recommended_product_id)
        self.assertEqual(result.candidates[1]["eligibility"], "eligible")
        self.assertTrue(any(q["field"].startswith("product_details.overdraft") for q in result.required_information))

    def test_existing_explicit_choice_keeps_working_without_the_new_field(self):
        for product in ("working_capital_loan", "overdraft"):
            with self.subTest(product=product):
                result = select(inputs(product))
                self.assertEqual(result.status, "recommendations_ready")
                self.assertEqual(result.recommended_product_id, product)

    def test_both_products_are_calculated_with_different_cost_bases(self):
        source = inputs("overdraft")
        source["application"]["need"].update(financing_pattern="cash_gap", term_months=12, priority="lowest_total_cost")
        result = select(source)
        self.assertEqual(result.recommended_product_id, "overdraft")
        by_product = {candidate["product_id"]: candidate for candidate in result.candidates}
        self.assertEqual(by_product["working_capital_loan"]["cost_basis"], "full_term")
        self.assertEqual(by_product["overdraft"]["cost_basis"], "planned_operations")
        self.assertTrue(all(candidate["offers"] for candidate in result.candidates))
        self.assertTrue(all(candidate["evaluation"]["assessment"]["stage"] == "preliminary" for candidate in result.candidates))
        ids = [offer["offer_id"] for candidate in result.candidates for offer in candidate["offers"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(json.loads(json.dumps(result.to_dict())), result.to_dict())

    def test_declined_limit_can_lead_to_a_loan_that_covers_the_plan(self):
        source = inputs("overdraft", "06_overdraft_declined")
        source["application"]["need"].update(financing_pattern="cash_gap", term_months=12)
        result = select(source)
        self.assertEqual(result.status, "recommendations_ready")
        self.assertEqual(result.recommended_product_id, "working_capital_loan")
        self.assertEqual(result.candidates[0]["eligibility"], "declined")
        self.assertEqual(result.candidates[1]["offers"][0]["amount"], "500000.00")

    def test_rejected_overdraft_does_not_invent_the_alternative_loan_term(self):
        source = inputs("overdraft", "06_overdraft_declined")
        source["application"]["need"]["financing_pattern"] = "cash_gap"
        result = select(source)
        self.assertEqual(result.status, "needs_information")
        self.assertTrue(any(question["field"] == "need.term_months" for question in result.required_information))

    def test_affordable_but_insufficient_loan_does_not_solve_the_gap(self):
        source = inputs("overdraft", "06_overdraft_declined")
        source["application"]["need"].update(financing_pattern="cash_gap", term_months=12, minimum_acceptable_amount="100000.00")
        source["application"]["financials"]["existing_loans"] = []
        for month in source["application"]["financials"]["monthly"]:
            month["operating_outflow"] = "930000.00"
        result = select(source)
        self.assertEqual(result.status, "needs_information")
        self.assertIsNone(result.recommended_product_id)
        self.assertEqual(result.candidates[1]["offers"], [])
        self.assertEqual(result.required_information[0]["code"], "loan_does_not_cover_plan")

    def test_long_gap_is_not_relabelled_as_an_approved_overdraft(self):
        source = inputs("overdraft")
        source["application"]["need"].update(financing_pattern="cash_gap", term_months=6)
        source["application"]["financials"]["existing_loans"] = []
        plan = source["application"]["product_details"]["overdraft"]
        plan["end_date"] = (date.fromisoformat(plan["start_date"]) + timedelta(days=75)).isoformat()
        plan["transactions"][-1]["date"] = plan["end_date"]
        result = select(source)
        self.assertEqual(result.candidates[0]["eligibility"], "out_of_policy")
        self.assertEqual(result.recommended_product_id, "working_capital_loan")

    def test_no_gap_does_not_cause_an_unnecessary_loan_recommendation(self):
        source = inputs("overdraft")
        source["application"]["need"].update(financing_pattern="cash_gap", term_months=12)
        source["application"]["financials"]["cash_balance"] = "500000.00"
        source["application"]["product_details"]["overdraft"]["opening_cash_balance"] = "500000.00"
        result = select(source)
        self.assertEqual(result.status, "not_eligible")
        self.assertIsNone(result.recommended_product_id)
        self.assertTrue(all(not candidate["offers"] for candidate in result.candidates))
        self.assertEqual(result.reasons[0]["code"], "no_financing_gap")

    def test_general_bank_prohibition_cannot_be_bypassed_by_another_product(self):
        source = inputs("overdraft")
        source["checks"]["restrictions"]["financing_prohibited"] = True
        result = select(source)
        self.assertEqual(result.status, "not_eligible")
        self.assertEqual(result.reasons[0]["code"], "financing_prohibited")
        self.assertTrue(all(not candidate["offers"] for candidate in result.candidates))

    def test_failed_and_stale_checks_do_not_become_declines(self):
        source = inputs("overdraft", "07_overdraft_check_unavailable")
        self.assertEqual(select(source).status, "check_retry_pending")
        source = inputs("overdraft")
        source["checks"]["application_version"] += 1
        self.assertEqual(select(source).status, "needs_checks")

    def test_unsupported_purpose_does_not_become_a_working_capital_loan(self):
        source = inputs()
        source["application"]["need"]["purpose"] = "investment"
        result = select(source)
        self.assertEqual(result.status, "not_eligible")
        self.assertEqual(result.candidates, ())

    def test_bad_primary_data_is_not_hidden_by_an_alternative(self):
        source = inputs("overdraft")
        source["application"]["need"].update(financing_pattern="cash_gap", term_months=12)
        source["application"]["product_details"]["overdraft"]["opening_cash_balance"] = "bad"
        result = select(source)
        self.assertEqual(result.status, "invalid_data")
        self.assertIsNone(result.recommended_product_id)
        self.assertTrue(result.issues)

    def test_invalid_input_fields_are_reported(self):
        for field, value in (("financing_pattern", "other"), ("recurring", "yes")):
            with self.subTest(field=field):
                source = inputs()
                source["application"]["need"][field] = value
                self.assertEqual(select(source).status, "invalid_data")
        source = inputs()
        self.assertEqual(recommend_financing(None, None, calculated_at=source["calculated_at"]).status, "invalid_data")
        self.assertEqual(recommend_financing(source["application"], source["checks"], calculated_at="bad").status, "invalid_data")


if __name__ == "__main__":
    unittest.main()
