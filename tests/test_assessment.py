from copy import deepcopy
from datetime import datetime
from decimal import Decimal, localcontext
import json
from pathlib import Path
import unittest

from credit_engine import assess_application, calculate_loan


NOW = "2026-10-20T12:01:00+03:00"


class AssessmentTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[1]
        examples = json.loads((root / "contracts/examples.json").read_text(encoding="utf-8"))
        self.application = examples["application"]
        self.checks = examples["checks"]
        self.expected = examples

    def assess(self, **kwargs):
        return assess_application(self.application, self.checks, calculated_at=NOW,
                                  assessment_id="assessment-test", **kwargs)

    def test_demo_returns_full_amount_on_eighteen_months(self):
        result = self.assess()
        self.assertEqual(result.status, "assessed")
        assessment = result.assessment
        self.assertEqual(assessment["outcome"], "alternative_offers")
        self.assertEqual(assessment["risk_grade"], "low")
        self.assertEqual(result.scoring.score, 100)
        offer = assessment["offers"][0]
        for field in ("amount", "term_months", "annual_rate_percent", "monthly_payment", "total_repayment", "valid_until"):
            self.assertEqual(offer[field], self.expected["assessment_alternatives"]["offers"][0][field])
        self.assertEqual(offer["application_version"], self.application["application_version"])
        self.assertEqual(offer["conditions"], [])
        self.assertEqual(assessment["reasons"][0]["code"], "requested_payment_exceeds_capacity")

    def test_requested_terms_are_approved(self):
        self.application["need"]["requested_amount"] = "500000.00"
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "approved")
        self.assertEqual(assessment["offers"][0]["monthly_payment"], "47279.80")

    def test_medium_risk_requires_guarantee(self):
        self.application["need"]["requested_amount"] = "500000.00"
        self.checks["credit_history"]["category"] = "no_history"
        result = self.assess()
        self.assertEqual(result.assessment["outcome"], "conditional_approval")
        self.assertEqual(result.scoring.score, 75)
        self.assertEqual(result.assessment["risk_grade"], "medium")
        self.assertEqual(result.assessment["offers"][0]["conditions"][0], {
            "code": "guarantee_required", "message": "Оформить поручительство перед подписанием кредитного договора.",
            "fulfilled": False,
        })

    def test_alternative_with_guarantee_keeps_alternative_outcome(self):
        self.checks["credit_history"]["category"] = "no_history"
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "alternative_offers")
        self.assertEqual(assessment["offers"][0]["conditions"][0]["fulfilled"], False)

    def test_high_risk_is_a_product_restriction(self):
        self.checks["credit_history"]["category"] = "serious_delinquency"
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "out_of_policy")
        self.assertEqual(assessment["risk_grade"], "high")
        self.assertEqual(assessment["offers"], [])

    def test_general_prohibitions_cannot_be_circumvented(self):
        for section, field, value, code in (("registration", "active", False, "business_inactive"),
                                             ("restrictions", "financing_prohibited", True, "financing_prohibited")):
            with self.subTest(section=section):
                original = deepcopy(self.checks)
                self.checks[section][field] = value
                assessment = self.assess().assessment
                self.assertEqual(assessment["outcome"], "declined")
                self.assertEqual(assessment["reasons"][0]["code"], code)
                self.assertEqual(assessment["offers"], [])
                self.checks = original

    def test_obligations_must_match_checked_information(self):
        self.checks["obligations"]["matches_application"] = False
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "needs_information")
        self.assertEqual(assessment["required_information"][0]["field"], "financials.existing_loans")

    def test_pending_and_failed_checks_do_not_return_rejection(self):
        for status, expected in (("pending", "needs_checks"), ("error", "check_retry_pending")):
            with self.subTest(status=status):
                self.checks["credit_history"]["status"] = status
                result = self.assess()
                self.assertEqual(result.status, expected)
                self.assertIsNone(result.assessment)
                self.assertIsNone(result.scoring)

    def test_missing_check_and_false_like_values_are_not_success(self):
        self.checks.pop("obligations")
        self.assertEqual(self.assess().status, "needs_checks")
        self.checks["registration"]["active"] = "true"
        self.assertEqual(self.assess().status, "invalid_data")
        result = assess_application(self.application, None, calculated_at=NOW)
        self.assertEqual(result.status, "needs_checks")

    def test_check_identity_and_version_are_bound(self):
        for field, value in (("application_id", "another"), ("application_version", 2),
                             ("application_version", True), ("business_inn", "another")):
            with self.subTest(field=field, value=value):
                original = deepcopy(self.checks)
                self.checks[field] = value
                result = self.assess()
                self.assertEqual(result.status, "needs_checks")
                self.assertIsNone(result.assessment)
                self.checks = original

    def test_check_timestamp_freshness_and_timezone(self):
        for timestamp, status in (("2026-10-19T12:00:59+03:00", "needs_checks"),
                                  ("2026-10-20T12:02:00+03:00", "invalid_data"),
                                  ("2026-10-20T12:00:00", "invalid_data")):
            with self.subTest(timestamp=timestamp):
                self.checks["checked_at"] = timestamp
                self.assertEqual(self.assess().status, status)
        self.checks["checked_at"] = "2026-10-19T12:01:00+03:00"
        self.assertEqual(self.assess().status, "assessed")

    def test_confirmation_must_match_version(self):
        self.application["confirmation"]["application_version"] = 2
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "needs_information")
        self.assertEqual(assessment["required_information"][0]["field"], "confirmation")
        self.application["confirmation"] = None
        self.assertEqual(self.assess(stage="preliminary").assessment["stage"], "preliminary")

    def test_young_business_and_age_boundary(self):
        self.application["business"]["registered_at"] = "2025-10-21"
        self.checks["registration"]["registered_at"] = "2025-10-21"
        self.assertEqual(self.assess().assessment["outcome"], "out_of_policy")
        self.application["business"]["registered_at"] = "2025-10-20"
        self.checks["registration"]["registered_at"] = "2025-10-20"
        self.assertEqual(self.assess().assessment["outcome"], "alternative_offers")

    def test_claimed_registration_details_must_match_external_result(self):
        self.application["business"]["registered_at"] = "2022-01-01"
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "needs_information")
        self.assertEqual(assessment["required_information"][0]["field"], "business.registered_at")
        self.checks["registration"].pop("registered_at")
        self.assertEqual(self.assess().status, "needs_checks")

    def test_seasonal_cash_flow_does_not_produce_an_offer(self):
        self.application["financials"]["monthly"][0]["operating_inflow"] = "800000.00"
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "out_of_policy")
        self.assertEqual(assessment["offers"], [])

    def test_missing_financial_and_scoring_data_require_information(self):
        self.application["financials"]["largest_buyer_share"] = None
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "needs_information")
        self.assertEqual(assessment["required_information"][0]["field"], "financials.largest_buyer_share")
        self.application["financials"]["monthly"].pop(0)
        self.assertEqual(self.assess().assessment["outcome"], "needs_information")

    def test_invalid_financial_data_is_not_a_credit_decision(self):
        self.application["financials"]["monthly"][0]["taxes"] = -1
        result = self.assess()
        self.assertEqual(result.status, "invalid_data")
        self.assertIsNone(result.assessment)

    def test_no_available_payment(self):
        self.application["financials"]["existing_loans"][0]["monthly_payment"] = "110000.00"
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "declined")
        self.assertEqual(assessment["reasons"][0]["code"], "no_payment_capacity")

    def test_maximum_payment_includes_last_payment(self):
        for row in self.application["financials"]["monthly"]:
            row["operating_inflow"] = "945288.80"
        self.application["financials"]["existing_loans"] = []
        self.application["need"]["term_months"] = 18
        result = self.assess()
        self.assertEqual(result.financial_metrics.available_monthly_payment, Decimal("66702.16"))
        self.assertEqual(result.assessment["outcome"], "alternative_offers")
        self.assertNotEqual(result.assessment["offers"][0]["term_months"], 18)

    def test_reduced_amount_requires_explicit_feasibility_confirmation(self):
        self.application["need"]["requested_amount"] = "5000000.00"
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "needs_information")
        self.assertEqual(assessment["required_information"][0]["field"], "need.minimum_acceptable_amount")
        self.assertEqual(assessment["offers"], [])

    def test_verified_minimum_allows_smaller_amount_on_original_term(self):
        self.application["need"]["minimum_acceptable_amount"] = "700000.00"
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "alternative_offers")
        self.assertEqual([(offer["amount"], offer["term_months"]) for offer in assessment["offers"]], [
            ("1000000.00", 18), ("740000.00", 12),
        ])

    def test_longer_term_with_smaller_amount_can_meet_verified_minimum(self):
        self.application["need"].update(requested_amount="5000000.00", minimum_acceptable_amount="1000000.00")
        result = self.assess()
        self.assertEqual(result.assessment["outcome"], "alternative_offers")
        offer = result.assessment["offers"][0]
        self.assertGreaterEqual(Decimal(offer["amount"]), Decimal("1000000.00"))
        self.assertLess(Decimal(offer["amount"]), Decimal("5000000.00"))
        self.assertLessEqual(calculate_loan(offer["amount"], offer["term_months"], offer["annual_rate_percent"]).calculation.maximum_payment,
                             result.financial_metrics.available_monthly_payment)

    def test_client_can_require_full_amount(self):
        self.application["need"].update(requested_amount="5000000.00", minimum_acceptable_amount="5000000.00")
        self.assertEqual(self.assess().assessment["outcome"], "declined")

    def test_own_funds_are_not_automatically_reused_for_smaller_loan(self):
        self.application["need"].update(requested_amount="5000000.00", own_funds="100000000.00")
        self.assertEqual(self.assess().assessment["outcome"], "needs_information")

    def test_amount_limit_and_step(self):
        self.application["need"]["requested_amount"] = "90000.00"
        self.assertEqual(self.assess().assessment["outcome"], "out_of_policy")
        self.application["need"].update(requested_amount="1005000.00", minimum_acceptable_amount="700000.00")
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "alternative_offers")
        for offer in assessment["offers"]:
            self.assertEqual(Decimal(offer["amount"]) % Decimal("10000.00"), 0)
            self.assertLessEqual(Decimal(offer["amount"]), Decimal("1005000.00"))

    def test_unsupported_requested_term_generates_an_alternative(self):
        self.application["need"]["term_months"] = 7
        result = self.assess()
        self.assertEqual(result.assessment["outcome"], "alternative_offers")
        self.assertEqual(result.assessment["offers"][0]["term_months"], 18)

    def test_client_priority_changes_alternative_order(self):
        self.application["need"]["priority"] = "lowest_payment"
        assessment = self.assess().assessment
        self.assertEqual(assessment["offers"][0]["term_months"], 36)
        self.application["need"].update(priority="lowest_total_cost", minimum_acceptable_amount="700000.00")
        assessment = self.assess().assessment
        self.assertEqual(assessment["offers"][0]["amount"], "740000.00")

    def test_no_affordable_minimum_product_amount(self):
        for row in self.application["financials"]["monthly"]:
            row["operating_inflow"] = "901000.00"
        self.assertEqual(self.assess().assessment["outcome"], "declined")

    def test_bad_application_fields_are_not_silently_accepted(self):
        for key, value in (("requested_amount", "-1.00"), ("term_months", True),
                           ("minimum_acceptable_amount", "1000001.00"), ("priority", "other")):
            with self.subTest(key=key):
                original = deepcopy(self.application)
                self.application["need"][key] = value
                self.assertEqual(self.assess().status, "invalid_data")
                self.application = original
        self.application["business"]["registered_at"] = "2027-01-01"
        self.assertEqual(self.assess().status, "invalid_data")

    def test_missing_profile_data_produces_specific_questions(self):
        self.application["business"].pop("inn")
        assessment = self.assess().assessment
        self.assertEqual(assessment["outcome"], "needs_information")
        self.assertEqual(assessment["required_information"][0]["field"], "business.inn")

    def test_identity_stage_and_timestamp_validation(self):
        self.assertEqual(self.assess(stage="unknown").status, "invalid_data")
        result = assess_application(self.application, self.checks, calculated_at="2026-10-20T12:00:00")
        self.assertEqual(result.status, "invalid_data")
        self.application["application_version"] = True
        self.assertEqual(self.assess().status, "invalid_data")

    def test_current_scope_does_not_approve_another_product(self):
        self.application["need"]["preferred_product"] = "overdraft"
        self.assertEqual(self.assess().assessment["outcome"], "out_of_policy")

    def test_serialization_and_inputs_are_unchanged(self):
        application, checks = deepcopy(self.application), deepcopy(self.checks)
        result = self.assess()
        payload = json.loads(json.dumps(result.to_dict(), allow_nan=False))
        self.assertEqual(payload["financial_metrics"]["available_monthly_payment"], "70000.00")
        self.assertEqual(self.application, application)
        self.assertEqual(self.checks, checks)
        assessment = payload["assessment"]
        self.assertEqual(set(assessment), set(self.expected["assessment_alternatives"]))
        self.assertTrue(datetime.fromisoformat(assessment["offers"][0]["valid_until"]) > datetime.fromisoformat(NOW))

    def test_decimal_context_is_local(self):
        baseline = self.assess()
        with localcontext() as context:
            context.prec = 6
            self.assertEqual(self.assess(), baseline)
            self.assertEqual(context.prec, 6)


if __name__ == "__main__":
    unittest.main()
