from copy import deepcopy
from decimal import Decimal, localcontext
import json
from pathlib import Path
import unittest

from credit_engine import OverdraftCreditPolicy, assess_overdraft
from scripts.run_credit_scenarios import load_scenarios, run_scenario


NOW = "2026-10-20T12:01:00+03:00"


class OverdraftAssessmentTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[1]
        examples = json.loads((root / "contracts/examples.json").read_text(encoding="utf-8"))
        self.application = examples["application"]
        self.checks = examples["checks"]
        sample = json.loads((root / "contracts/overdraft/example.json").read_text(encoding="utf-8"))
        plan = sample["input"]["scenario"]
        plan["existing_debt_payments"] = []
        self.application["product_details"] = {"overdraft": plan}
        self.application["need"].update(preferred_product="overdraft", requested_amount="200000.00", term_months=None)

    def assess(self, **kwargs):
        return assess_overdraft(self.application, self.checks, calculated_at=NOW,
                               assessment_id="overdraft-test", **kwargs)

    def test_original_limit_is_approved_and_cost_is_scenario_bound(self):
        result = self.assess()
        self.assertEqual(result.status, "assessed")
        self.assertEqual(result.assessment["outcome"], "approved")
        self.assertEqual(result.limit_calculation.maximum_eligible_limit, Decimal("300000.00"))
        offer = result.assessment["offers"][0]
        self.assertEqual(offer["product_id"], "overdraft")
        self.assertEqual(offer["amount"], "200000.00")
        self.assertIsNone(offer["term_months"])
        self.assertIsNone(offer["monthly_payment"])
        self.assertIsNone(offer["total_repayment"])
        self.assertEqual(offer["scenario_cost"]["total_interest"], "986.30")
        self.assertEqual(offer["scenario_cost"]["total_repayment"], "150986.30")
        self.assertEqual(offer["agreement_months"], 12)
        self.assertEqual(offer["max_debt_days"], 60)
        self.assertTrue(result.overdraft_calculation.feasible)

    def test_smaller_limit_is_only_offered_when_same_plan_fits(self):
        self.application["need"]["requested_amount"] = "500000.00"
        result = self.assess()
        self.assertEqual(result.assessment["outcome"], "alternative_offers")
        self.assertEqual(result.assessment["offers"][0]["amount"], "300000.00")
        self.assertTrue(result.overdraft_calculation.feasible)
        self.application["product_details"]["overdraft"]["transactions"][0]["amount"] = "500000.00"
        result = self.assess()
        self.assertEqual(result.assessment["outcome"], "declined")
        self.assertEqual(result.assessment["offers"], [])
        self.assertEqual(result.overdraft_calculation.required_limit, Decimal("400000.00"))

    def test_request_below_plan_capacity_requires_client_clarification(self):
        self.application["need"]["requested_amount"] = "100000.00"
        result = self.assess()
        self.assertEqual(result.assessment["outcome"], "needs_information")
        self.assertEqual(result.assessment["required_information"][0]["field"], "need.requested_amount")
        self.assertEqual(result.assessment["offers"], [])

    def test_medium_risk_reduces_turnover_fraction_and_requires_guarantee(self):
        self.checks["credit_history"]["category"] = "no_history"
        result = self.assess()
        self.assertEqual(result.assessment["outcome"], "conditional_approval")
        self.assertEqual(result.limit_calculation.turnover_fraction, Decimal("0.20"))
        self.assertEqual(result.limit_calculation.maximum_eligible_limit, Decimal("200000.00"))
        self.assertFalse(result.assessment["offers"][0]["conditions"][0]["fulfilled"])
        self.application["need"]["requested_amount"] = "500000.00"
        result = self.assess()
        self.assertEqual(result.assessment["outcome"], "alternative_offers")
        self.assertTrue(result.assessment["offers"][0]["conditions"])

    def test_turnover_uses_weakest_historical_month(self):
        self.application["financials"]["monthly"][0].update(operating_inflow="900000.00", operating_outflow="700000.00")
        result = self.assess()
        self.assertEqual(result.limit_calculation.minimum_monthly_inflow, Decimal("900000.00"))
        self.assertEqual(result.limit_calculation.maximum_eligible_limit, Decimal("270000.00"))

    def test_interest_limit_respects_existing_debt_and_rounding(self):
        self.application["financials"]["existing_loans"][0]["monthly_payment"] = "100000.00"
        self.application["need"]["requested_amount"] = "300000.00"
        result = self.assess()
        self.assertEqual(result.financial_metrics.available_monthly_payment, Decimal("5000.00"))
        self.assertEqual(result.limit_calculation.interest_capacity_limit, Decimal("240000.00"))
        self.assertEqual(result.assessment["offers"][0]["amount"], "240000.00")

    def test_no_interest_capacity_declines_and_zero_rate_is_supported(self):
        self.application["financials"]["existing_loans"][0]["monthly_payment"] = "110000.00"
        result = self.assess()
        self.assertEqual(result.assessment["outcome"], "declined")
        self.assertEqual(result.assessment["reasons"][0]["code"], "no_eligible_limit")
        result = self.assess(policy=OverdraftCreditPolicy(annual_rate_percent="0.00"))
        self.assertEqual(result.assessment["outcome"], "approved")
        self.assertEqual(result.assessment["offers"][0]["scenario_cost"]["total_interest"], "0.00")

    def test_hard_stop_and_high_risk_do_not_produce_offers(self):
        self.checks["restrictions"]["financing_prohibited"] = True
        result = self.assess()
        self.assertEqual(result.assessment["outcome"], "declined")
        self.assertEqual(result.assessment["offers"], [])
        self.checks["restrictions"]["financing_prohibited"] = False
        self.checks["credit_history"]["category"] = "serious_delinquency"
        self.assertEqual(self.assess().assessment["outcome"], "out_of_policy")

    def test_inactive_and_mismatched_business_data(self):
        self.checks["registration"]["active"] = False
        self.assertEqual(self.assess().assessment["reasons"][0]["code"], "business_inactive")
        self.checks["registration"]["active"] = True
        self.checks["registration"]["registered_at"] = "2020-01-01"
        self.assertEqual(self.assess().assessment["outcome"], "needs_information")
        self.checks["registration"]["registered_at"] = self.application["business"]["registered_at"]
        self.checks["obligations"]["matches_application"] = False
        self.assertEqual(self.assess().assessment["required_information"][0]["field"], "financials.existing_loans")

    def test_missing_and_failed_checks_are_not_credit_rejections(self):
        result = assess_overdraft(self.application, None, calculated_at=NOW)
        self.assertEqual(result.status, "needs_checks")
        self.assertIsNone(result.assessment)
        self.checks["credit_history"] = {"status": "error", "category": None}
        result = self.assess()
        self.assertEqual(result.status, "check_retry_pending")
        self.assertIsNone(result.assessment)

    def test_checks_must_match_version_and_be_current(self):
        self.checks["application_version"] = 2
        self.assertEqual(self.assess().status, "needs_checks")
        self.checks["application_version"] = 1
        self.checks["checked_at"] = "2026-10-19T12:00:00+03:00"
        self.assertEqual(self.assess().status, "needs_checks")
        self.checks["checked_at"] = "2026-10-20T12:02:00+03:00"
        self.assertEqual(self.assess().status, "invalid_data")

    def test_confirmation_is_required_only_for_final(self):
        self.application["confirmation"] = None
        self.assertEqual(self.assess().assessment["required_information"][0]["field"], "confirmation")
        self.assertEqual(self.assess(stage="preliminary").assessment["outcome"], "approved")

    def test_missing_plan_and_risk_data_request_specific_fields(self):
        self.application["product_details"] = None
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "needs_information")
        self.assertEqual(assessment["required_information"][0]["field"], "product_details.overdraft")
        self.application["financials"]["largest_buyer_share"] = None
        self.assertEqual(self.assess().assessment["required_information"][0]["field"], "financials.largest_buyer_share")

    def test_debt_plan_is_explicit_and_references_outflows_without_double_counting(self):
        plan = self.application["product_details"]["overdraft"]
        plan.pop("existing_debt_payments")
        self.assertEqual(self.assess().assessment["outcome"], "needs_information")
        plan["transactions"].append({"transaction_id": "old-loan", "date": "2026-11-05", "direction": "outflow", "amount": "35000.00"})
        plan["existing_debt_payments"] = [{"loan_id": "existing-001", "transaction_id": "old-loan"}]
        result = self.assess()
        self.assertEqual(result.assessment["outcome"], "approved")
        self.assertEqual(sum(day.outflow for day in result.overdraft_calculation.daily), Decimal("285000.00"))
        plan["existing_debt_payments"].append(deepcopy(plan["existing_debt_payments"][0]))
        self.assertEqual(self.assess().status, "invalid_data")

    def test_full_month_cannot_hide_regular_debt_payment(self):
        plan = self.application["product_details"]["overdraft"]
        plan["end_date"] = "2026-11-30"
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "needs_information")
        self.assertEqual(assessment["required_information"][0]["code"], "incomplete_debt_payment_plan")

    def test_repayment_and_time_limits_are_verified(self):
        plan = self.application["product_details"]["overdraft"]
        plan["transactions"].pop()
        self.assertEqual(self.assess().assessment["reasons"][0]["code"], "repayment_not_demonstrated")
        self.application["financials"]["existing_loans"] = []
        plan["end_date"] = "2027-01-01"
        self.assertEqual(self.assess().assessment["reasons"][0]["code"], "repayment_term_not_eligible")

    def test_cash_balance_cannot_be_invented_in_plan(self):
        self.application["financials"]["cash_balance"] = None
        self.assertEqual(self.assess().assessment["required_information"][0]["field"], "financials.cash_balance")
        self.application["financials"]["cash_balance"] = "50000.00"
        self.assertEqual(self.assess().assessment["reasons"][0]["code"], "opening_cash_not_supported")

    def test_dates_and_agreement_period(self):
        plan = self.application["product_details"]["overdraft"]
        plan["start_date"] = "2026-10-01"
        self.assertEqual(self.assess().assessment["reasons"][0]["code"], "outdated_overdraft_plan")
        plan["start_date"] = "2026-11-01"
        plan["end_date"] = "2027-11-01"
        self.assertEqual(self.assess().assessment["reasons"][0]["code"], "plan_exceeds_agreement")

    def test_non_step_request_is_rounded_down_and_keeps_feasible_plan(self):
        self.application["need"]["requested_amount"] = "205000.00"
        result = self.assess()
        self.assertEqual(result.assessment["outcome"], "alternative_offers")
        self.assertEqual(result.assessment["offers"][0]["amount"], "200000.00")

    def test_no_gap_does_not_generate_unused_financing_offer(self):
        plan = self.application["product_details"]["overdraft"]
        plan["opening_cash_balance"] = "300000.00"
        self.assertEqual(self.assess().assessment["reasons"][0]["code"], "no_financing_gap")

    def test_invalid_data_is_not_a_business_decision(self):
        for field, value in (("requested_amount", "-1.00"), ("requested_amount", True)):
            with self.subTest(value=value):
                self.application["need"][field] = value
                self.assertEqual(self.assess().status, "invalid_data")
        self.application["need"]["requested_amount"] = "200000.00"
        self.application["product_details"] = []
        self.assertEqual(self.assess().status, "invalid_data")
        result = assess_overdraft([], self.checks, calculated_at=NOW)
        self.assertEqual(result.status, "invalid_data")
        result = assess_overdraft(self.application, self.checks, calculated_at="2026-10-20T12:01:00")
        self.assertEqual(result.status, "invalid_data")

    def test_product_scope_and_business_age(self):
        self.application["business"]["registered_at"] = "2026-01-01"
        self.checks["registration"]["registered_at"] = "2026-01-01"
        self.assertEqual(self.assess().assessment["outcome"], "out_of_policy")
        self.application["need"]["preferred_product"] = "investment_loan"
        self.assertEqual(self.assess().assessment["reasons"][0]["code"], "unsupported_product_or_purpose")

    def test_serialization_is_stable_and_inputs_unchanged(self):
        application, checks = deepcopy(self.application), deepcopy(self.checks)
        result = self.assess()
        payload = json.loads(json.dumps(result.to_dict(), allow_nan=False))
        self.assertEqual(payload["overdraft_calculation"]["total_interest"], "986.30")
        with localcontext() as context:
            context.prec = 6
            self.assertEqual(self.assess(), result)
            self.assertEqual(context.prec, 6)
        self.assertEqual(self.application, application)
        self.assertEqual(self.checks, checks)

    def test_policy_validation(self):
        for kwargs in ({"limit_step": Decimal("0")}, {"minimum_limit": Decimal("5000000.00")},
                       {"medium_risk_turnover_fraction": Decimal("0.50")}, {"checks_valid_hours": True}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                OverdraftCreditPolicy(**kwargs)

    def test_saved_scenarios_match_real_assessment(self):
        cases = load_scenarios(product="overdraft")
        self.assertEqual(len(cases), 7)
        for case in cases:
            with self.subTest(scenario=case["scenario_id"]):
                self.assertEqual(run_scenario(case), case["expected"])

    def test_invalid_plan_references_and_financials_do_not_raise(self):
        plan = self.application["product_details"]["overdraft"]
        plan["existing_debt_payments"] = [{"loan_id": "unknown", "transaction_id": "purchase-001"}]
        self.assertEqual(self.assess().status, "invalid_data")
        plan["existing_debt_payments"] = []
        plan["cash_reserve"] = "1.001"
        result = self.assess()
        self.assertEqual(result.status, "invalid_data")
        self.assertEqual(result.issues[0].field, "product_details.overdraft.cash_reserve")
        plan["cash_reserve"] = "0.00"
        self.application["financials"]["monthly"][0]["taxes"] = -1
        self.assertEqual(self.assess().status, "invalid_data")

    def test_partial_period_debt_payment_reference_must_point_to_outflow(self):
        plan = self.application["product_details"]["overdraft"]
        plan["existing_debt_payments"] = [{"loan_id": "existing-001", "transaction_id": "customer-001"}]
        self.assertEqual(self.assess().status, "invalid_data")

    def test_policy_versions_must_match(self):
        with self.assertRaises(ValueError):
            self.assess(policy=OverdraftCreditPolicy(version="another-version"))


if __name__ == "__main__":
    unittest.main()
