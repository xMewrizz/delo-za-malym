from copy import deepcopy
from decimal import Decimal
import unittest

from scripts.run_credit_scenarios import load_scenarios, run_scenario


class IntegrationScenarioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scenarios = {case["scenario_id"]: case for case in load_scenarios()}

    def test_saved_responses_match_actual_calculations(self):
        self.assertEqual(len(self.scenarios), 7)
        for scenario_id, scenario in self.scenarios.items():
            with self.subTest(scenario=scenario_id):
                original = deepcopy(scenario)
                self.assertEqual(run_scenario(scenario), scenario["expected"])
                self.assertEqual(scenario, original)

    def test_scenarios_cover_the_promised_business_results(self):
        expected = {
            "01_approved": "approved",
            "02_longer_term": "alternative_offers",
            "03_lower_amount": "alternative_offers",
            "04_needs_information": "needs_information",
            "05_guarantor_required": "conditional_approval",
            "06_declined": "declined",
        }
        for scenario_id, outcome in expected.items():
            with self.subTest(scenario=scenario_id):
                result = run_scenario(self.scenarios[scenario_id])
                self.assertEqual(result["status"], "assessed")
                self.assertEqual(result["assessment"]["outcome"], outcome)
        longer = run_scenario(self.scenarios["02_longer_term"])["assessment"]["offers"][0]
        self.assertEqual((longer["amount"], longer["term_months"]), ("1000000.00", 18))
        reduced = run_scenario(self.scenarios["03_lower_amount"])["assessment"]["offers"][0]
        self.assertEqual((reduced["amount"], reduced["term_months"]), ("740000.00", 12))
        conditional = run_scenario(self.scenarios["05_guarantor_required"])["assessment"]["offers"][0]
        self.assertTrue(any(c["code"] == "guarantee_required" and c["fulfilled"] is False
                            for c in conditional["conditions"]))

    def test_missing_information_can_be_confirmed_and_reassessed(self):
        scenario = deepcopy(self.scenarios["04_needs_information"])
        initial = run_scenario(scenario)["assessment"]
        self.assertEqual(initial["offers"], [])
        self.assertEqual(initial["required_information"][0]["field"], "financials.largest_buyer_share")
        inputs = scenario["input"]
        application = inputs["application"]
        application["financials"]["largest_buyer_share"] = 0.25
        application["application_version"] = 2
        application["confirmation"] = {"application_version": 2, "confirmed_at": "2026-10-20T12:02:00+03:00"}
        inputs["checks"]["application_version"] = 2
        inputs["checks"]["checked_at"] = "2026-10-20T12:02:30+03:00"
        inputs["calculated_at"] = "2026-10-20T12:03:00+03:00"
        inputs["assessment_id"] += "-retry"
        assessment = run_scenario(scenario)["assessment"]
        self.assertEqual(assessment["outcome"], "approved")
        self.assertEqual(assessment["application_version"], 2)
        self.assertTrue(all(offer["application_version"] == 2 for offer in assessment["offers"]))
        self.assertEqual(self.scenarios["04_needs_information"]["input"]["application"]["application_version"], 1)

    def test_check_failure_has_no_decision_and_can_be_retried(self):
        scenario = deepcopy(self.scenarios["07_check_unavailable"])
        initial = run_scenario(scenario)
        self.assertEqual(initial["status"], "check_retry_pending")
        self.assertIsNone(initial["assessment"])
        self.assertEqual(initial["issues"][0]["field"], "checks.credit_history")
        scenario["input"]["checks"]["credit_history"] = {"status": "completed", "category": "good"}
        scenario["input"]["checks"]["checked_at"] = "2026-10-20T12:02:00+03:00"
        scenario["input"]["calculated_at"] = "2026-10-20T12:03:00+03:00"
        scenario["input"]["assessment_id"] += "-retry"
        recovered = run_scenario(scenario)
        self.assertEqual(recovered["status"], "assessed")
        self.assertEqual(recovered["assessment"]["outcome"], "approved")

    def test_smaller_amount_disappears_without_client_confirmation(self):
        scenario = deepcopy(self.scenarios["03_lower_amount"])
        scenario["input"]["application"]["need"]["minimum_acceptable_amount"] = None
        assessment = run_scenario(scenario)["assessment"]
        self.assertEqual(assessment["outcome"], "alternative_offers")
        self.assertTrue(assessment["offers"])
        requested = Decimal(scenario["input"]["application"]["need"]["requested_amount"])
        self.assertTrue(all(Decimal(offer["amount"]) == requested for offer in assessment["offers"]))


if __name__ == "__main__":
    unittest.main()
