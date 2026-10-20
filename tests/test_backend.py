from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient

from backend.main import create_app
from scripts.run_credit_scenarios import load_scenarios


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.database = Path(self.directory.name) / "cabinet.sqlite3"
        self.now = datetime.fromisoformat("2026-10-20T12:01:00+03:00")
        self.app = create_app(self.database, clock=lambda: self.now)
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def create_case(self, scenario="01_approved", product="working_capital_loan"):
        response = self.client.post(f"/api/demo/scenarios/{product}/{scenario}")
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def post(self, record, action, **fields):
        return self.client.post(f"/api/applications/{record['application']['application_id']}/{action}",
                                json={"base_application_version": record["application"]["application_version"], **fields})

    def submit(self, record):
        response = self.post(record, "submit", confirmed=True)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def select(self, record):
        assessment = record["result"]["assessment"]
        response = self.post(record, "select-offer", assessment_id=assessment["assessment_id"], offer_id=assessment["offers"][0]["offer_id"])
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_profile_catalog_health_and_openapi(self):
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})
        profile = self.client.get("/api/profile").json()
        self.assertEqual(profile["client_id"], "demo-client")
        self.assertEqual(len(profile["financials"]["monthly"]), 6)
        products = self.client.get("/api/products").json()
        self.assertEqual([product["product_id"] for product in products], ["working_capital_loan", "overdraft"])
        self.assertNotIn("terms", products[1])
        schema = self.client.get("/openapi.json")
        self.assertEqual(schema.status_code, 200)
        self.assertIn("/api/applications/{application_id}/sign", schema.json()["paths"])

    def test_complete_real_credit_process_for_both_products(self):
        for product, scenario, final in (("working_capital_loan", "01_approved", "disbursed"),
                                         ("overdraft", "01_overdraft_approved", "limit_opened")):
            with self.subTest(product=product):
                record = self.create_case(scenario, product)
                self.assertIsNone(record["application"]["confirmation"])
                record = self.submit(record)
                self.assertEqual(record["state"]["status"], "offers_ready")
                self.assertEqual(record["result"]["assessment"]["outcome"], "approved")
                record = self.select(record)
                self.assertEqual(record["state"]["status"], "ready_to_sign")
                record = self.post(record, "sign", offer_id=record["state"]["selected_offer_id"], confirmed=True).json()
                self.assertEqual(record["state"]["status"], final)
                self.assertEqual(record["completion"]["mode"], "simulated")
                self.assertIsNotNone(record["signature"])
                if product == "working_capital_loan":
                    self.assertEqual(len(record["completion"]["schedule"]), 12)
                    self.assertEqual(record["completion"]["schedule"][-1]["closing_balance"], "0.00")
                repeated = self.post(record, "sign", offer_id=record["state"]["selected_offer_id"], confirmed=True).json()
                self.assertEqual(repeated, record)
                self.assertEqual(len([e for e in record["events"] if e["type"] == "contract_signed"]), 1)

    def test_conditions_are_required_for_both_products(self):
        for product, scenario in (("working_capital_loan", "05_guarantor_required"), ("overdraft", "05_overdraft_guarantor")):
            with self.subTest(product=product):
                record = self.select(self.submit(self.create_case(scenario, product)))
                offer_id = record["state"]["selected_offer_id"]
                self.assertEqual(record["state"]["status"], "conditions_pending")
                blocked = self.post(record, "sign", offer_id=offer_id, confirmed=True).json()
                self.assertIsNone(blocked["signature"])
                self.assertIsNone(blocked["completion"])
                completed = self.post(record, "conditions/guarantee_required/complete", offer_id=offer_id, confirmed=True).json()
                self.assertEqual(completed["state"]["status"], "ready_to_sign")
                # Итоговая оценка остаётся неизменной; выполнение записано отдельно.
                self.assertEqual(completed["result"], record["result"])
                self.assertIsNotNone(self.post(completed, "sign", offer_id=offer_id, confirmed=True).json()["completion"])

    def test_all_fourteen_scenarios_are_calculated_through_http(self):
        self.assertEqual(len(self.client.get("/api/demo/scenarios").json()), 14)
        for product in ("working_capital_loan", "overdraft"):
            for case in load_scenarios(product=product):
                with self.subTest(scenario=case["scenario_id"]):
                    record = self.submit(self.create_case(case["scenario_id"], product))
                    self.assertEqual(record["result"]["status"], case["expected"]["status"])
                    expected = case["expected"]["assessment"]
                    if expected is None:
                        self.assertIsNone(record["result"]["assessment"])
                        self.assertEqual(record["state"]["status"], "check_retry_pending")
                    else:
                        self.assertEqual(record["result"]["assessment"]["outcome"], expected["outcome"])

    def test_arbitrary_form_data_is_calculated_without_fixture_selection(self):
        response = self.client.post("/api/applications", json={"need": {
            "preferred_product": "working_capital_loan", "purpose": "working_capital",
            "requested_amount": "350000.00", "term_months": 18,
        }})
        self.assertEqual(response.status_code, 201)
        record = self.submit(response.json())
        self.assertEqual(record["result"]["assessment"]["outcome"], "approved")
        self.assertEqual(record["result"]["assessment"]["offers"][0]["amount"], "350000.00")

    def test_preliminary_calculation_does_not_allow_signing_or_selecting(self):
        record = self.create_case()
        record = self.post(record, "preview").json()
        self.assertEqual(record["state"]["status"], "draft")
        self.assertEqual(record["result"]["assessment"]["stage"], "preliminary")
        self.assertIsNone(record["application"]["confirmation"])
        assessment = record["result"]["assessment"]
        response = self.post(record, "select-offer", assessment_id=assessment["assessment_id"], offer_id=assessment["offers"][0]["offer_id"])
        self.assertEqual(response.status_code, 409)

    def test_missing_data_is_corrected_with_new_version_and_preserved_submission(self):
        record = self.submit(self.create_case("04_needs_information"))
        self.assertEqual(record["state"]["status"], "waiting_for_data")
        submitted = deepcopy(record["submitted_versions"][0])
        response = self.client.patch(f"/api/applications/{record['application']['application_id']}", json={
            "base_application_version": 1, "changes": {"financials.largest_buyer_share": 0.25},
        })
        record = response.json()
        self.assertEqual(record["application"]["application_version"], 2)
        self.assertIsNone(record["result"])
        self.assertIsNone(record["application"]["confirmation"])
        self.assertEqual(record["submitted_versions"][0], submitted)
        record = self.submit(record)
        self.assertEqual(record["result"]["assessment"]["outcome"], "approved")
        self.assertEqual(len(record["submitted_versions"]), 2)
        self.assertEqual(record["submitted_versions"][0], submitted)

    def test_technical_failure_can_be_retried_without_resubmission(self):
        for product, scenario in (("working_capital_loan", "07_check_unavailable"), ("overdraft", "07_overdraft_check_unavailable")):
            with self.subTest(product=product):
                record = self.submit(self.create_case(scenario, product))
                self.assertEqual(record["state"]["status"], "check_retry_pending")
                self.assertIsNone(record["result"]["assessment"])
                retried = self.post(record, "retry").json()
                self.assertEqual(retried["state"]["status"], "offers_ready")
                self.assertEqual(len(retried["submitted_versions"]), 1)
                self.assertEqual(retried["application"]["application_version"], 1)

    def test_expiration_is_checked_at_signing_and_new_offers_require_selection(self):
        record = self.select(self.submit(self.create_case()))
        offer_id = record["state"]["selected_offer_id"]
        self.now += timedelta(days=8)
        record = self.post(record, "sign", offer_id=offer_id, confirmed=True).json()
        self.assertEqual(record["state"]["status"], "offer_expired")
        self.assertIsNone(record["signature"])
        record = self.post(record, "retry").json()
        self.assertEqual(record["state"]["status"], "offers_ready")
        self.assertIsNone(record["state"]["selected_offer_id"])
        self.assertEqual(self.post(record, "sign", offer_id=offer_id, confirmed=True).status_code, 409)
        record = self.select(record)
        self.assertEqual(self.post(record, "sign", offer_id=record["state"]["selected_offer_id"], confirmed=True).json()["state"]["status"], "disbursed")

    def test_versions_and_decisions_cannot_be_overwritten_from_client(self):
        record = self.select(self.submit(self.create_case()))
        application_id = record["application"]["application_id"]
        for changes in ({"confirmation": {}}, {"state.status": "ready_to_sign"}, {"checks.credit_history": "good"}, {"result": {}}):
            with self.subTest(changes=changes):
                response = self.client.patch(f"/api/applications/{application_id}", json={"base_application_version": 1, "changes": changes})
                self.assertEqual(response.status_code, 422)
                self.assertEqual(self.client.get(f"/api/applications/{application_id}").json(), record)
        self.assertEqual(self.client.post("/api/applications", json={"checks": {}}).status_code, 422)
        updated = self.client.patch(f"/api/applications/{application_id}", json={"base_application_version": 1, "changes": {"need.requested_amount": "400000.00"}}).json()
        self.assertEqual(updated["application"]["application_version"], 2)
        self.assertIsNone(updated["state"]["selected_offer_id"])
        self.assertEqual(self.post(record, "sign", offer_id=record["state"]["selected_offer_id"], confirmed=True).status_code, 409)

    def test_bad_patch_rolls_back_previous_fields_in_same_request(self):
        record = self.create_case()
        path = f"/api/applications/{record['application']['application_id']}"
        response = self.client.patch(path, json={"base_application_version": 1,
                                                 "changes": {"need.requested_amount": "1.00", "checks": {}}})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.get(path).json(), record)

    def test_double_signing_is_atomic_and_returns_one_operation(self):
        record = self.select(self.submit(self.create_case()))
        def sign(_):
            return self.post(record, "sign", offer_id=record["state"]["selected_offer_id"], confirmed=True)
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(sign, range(2)))
        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertEqual(responses[0].json()["completion"]["operation_id"], responses[1].json()["completion"]["operation_id"])

    def test_concurrent_edits_detect_version_conflict(self):
        record = self.create_case()
        def change(amount):
            return self.client.patch(f"/api/applications/{record['application']['application_id']}", json={
                "base_application_version": 1, "changes": {"need.requested_amount": amount}}).status_code
        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(change, ("400000.00", "450000.00")))
        self.assertEqual(sorted(statuses), [200, 409])

    def test_restart_restores_complete_application_and_history(self):
        record = self.select(self.submit(self.create_case()))
        with TestClient(create_app(self.database, clock=lambda: self.now)) as restarted:
            restored = restarted.get(f"/api/applications/{record['application']['application_id']}").json()
            self.assertEqual(restored, record)
            self.assertEqual(len(restarted.get("/api/applications").json()), 1)

    def test_cancel_and_completed_applications_cannot_be_edited_or_signed_again(self):
        record = self.select(self.submit(self.create_case()))
        cancelled = self.post(record, "cancel", confirmed=True).json()
        blocked = self.post(cancelled, "sign", offer_id=record["state"]["selected_offer_id"], confirmed=True).json()
        self.assertEqual(blocked["state"]["status"], "cancelled")
        self.assertIsNone(blocked["signature"])
        response = self.client.patch(f"/api/applications/{record['application']['application_id']}", json={
            "base_application_version": 1, "changes": {"need.requested_amount": "400000.00"}})
        self.assertEqual(response.status_code, 409)

    def test_confirmations_are_explicit_and_versions_are_strict(self):
        record = self.create_case()
        for fields in ({}, {"confirmed": False}, {"confirmed": 1}, {"confirmed": "true"}, {"confirmed": True, "base_application_version": True}):
            with self.subTest(fields=fields):
                self.assertEqual(self.post(record, "submit", **fields).status_code, 422)
        self.assertEqual(self.client.get("/api/applications/missing").status_code, 404)
        self.assertEqual(self.client.post("/api/demo/scenarios/unknown/missing").status_code, 404)

    def test_demo_dates_follow_current_month(self):
        self.now = datetime.fromisoformat("2027-01-02T10:00:00+03:00")
        record = self.submit(self.create_case("01_overdraft_approved", "overdraft"))
        self.assertEqual(record["result"]["assessment"]["outcome"], "approved")
        self.assertEqual(record["application"]["financials"]["monthly"][-1]["month"], "2026-12")

    def test_task_based_recommendation_can_be_confirmed_and_funded(self):
        record = self.create_case("01_overdraft_approved", "overdraft")
        path = f"/api/applications/{record['application']['application_id']}"
        record = self.client.patch(path, json={"base_application_version": 1, "changes": {
            "need.preferred_product": None, "need.financing_pattern": "cash_gap"}}).json()
        source = deepcopy(record)
        record = self.post(record, "recommendations").json()
        recommendation = record["recommendation"]
        self.assertEqual(recommendation["recommended_product_id"], "overdraft")
        self.assertEqual(record["application"], source["application"])
        self.assertEqual(record["state"], source["state"])
        self.assertIsNone(record["result"])
        candidate = recommendation["candidates"][0]
        self.assertEqual(self.post(record, "select-offer", assessment_id=candidate["evaluation"]["assessment"]["assessment_id"],
                                   offer_id=candidate["offers"][0]["offer_id"]).status_code, 409)
        record = self.client.patch(path, json={"base_application_version": 2, "changes": {"need.preferred_product": "overdraft"}}).json()
        self.assertIsNone(record["recommendation"])
        record = self.select(self.submit(record))
        record = self.post(record, "sign", offer_id=record["state"]["selected_offer_id"], confirmed=True).json()
        self.assertEqual(record["state"]["status"], "limit_opened")

    def test_recommendation_does_not_replace_final_decision_or_selected_offer(self):
        record = self.select(self.submit(self.create_case()))
        original = deepcopy(record)
        record = self.post(record, "recommendations").json()
        for field in ("application", "state", "result", "checks", "submitted_versions", "readiness"):
            self.assertEqual(record[field], original[field], field)
        self.assertEqual(record["recommendation"]["recommended_product_id"], "working_capital_loan")
        self.assertIsNotNone(self.post(record, "sign", offer_id=record["state"]["selected_offer_id"], confirmed=True).json()["completion"])

    def test_unclassified_task_requests_pattern_through_api(self):
        record = self.client.post("/api/applications", json={"need": {
            "purpose": "working_capital", "requested_amount": "500000.00", "recurring": True}}).json()
        record = self.post(record, "recommendations").json()
        self.assertEqual(record["recommendation"]["status"], "needs_information")
        self.assertEqual(record["recommendation"]["required_information"][0]["field"], "need.financing_pattern")

    def test_incompatible_product_cannot_bypass_pattern_by_submitting_directly(self):
        record = self.create_case("01_overdraft_approved", "overdraft")
        record = self.client.patch(f"/api/applications/{record['application']['application_id']}", json={
            "base_application_version": 1, "changes": {"need.financing_pattern": "gradual_repayment"}}).json()
        response = self.post(record, "submit", confirmed=True)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"]["code"], "product_pattern_conflict")

    def test_recommendation_check_failure_can_be_retried_while_still_draft(self):
        record = self.create_case("07_check_unavailable")
        record = self.post(record, "recommendations").json()
        self.assertEqual(record["recommendation"]["status"], "check_retry_pending")
        self.assertEqual(record["state"]["status"], "draft")
        for _ in range(2):
            record = self.post(record, "recommendations").json()
            self.assertEqual(record["recommendation"]["status"], "recommendations_ready")
        self.assertEqual(self.submit(record)["state"]["status"], "offers_ready")


if __name__ == "__main__":
    unittest.main()
