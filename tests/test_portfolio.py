from datetime import datetime
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.portfolio import include_scheduled_payments


class PortfolioTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.path = Path(self.directory.name) / "portfolio.sqlite3"
        self.now = datetime.fromisoformat("2026-10-22T12:00:00+03:00")
        self.client = TestClient(create_app(self.path, clock=lambda: self.now)).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def create(self):
        response = self.client.post("/api/applications", json={"need": {
            "purpose": "working_capital", "preferred_product": "working_capital_loan",
            "financing_pattern": "gradual_repayment", "requested_amount": "500000.00", "term_months": 12}})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def action(self, record, name, **fields):
        response = self.client.post(f"/api/applications/{record['application']['application_id']}/{name}",
            json={"base_application_version": record["application"]["application_version"], **fields})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def ready(self, record):
        record = self.action(record, "submit", confirmed=True)
        assessment = record["result"]["assessment"]
        self.assertTrue(assessment["offers"], record)
        return self.action(record, "select-offer", assessment_id=assessment["assessment_id"], offer_id=assessment["offers"][0]["offer_id"])

    def issue(self, record):
        record = self.ready(record)
        return self.action(record, "sign", offer_id=record["state"]["selected_offer_id"], confirmed=True)

    def test_issued_loan_updates_profile_second_assessment_calendar_and_survives_restart(self):
        baseline = self.client.get("/api/profile").json()
        first = self.issue(self.create())
        self.assertEqual(first["state"]["status"], "disbursed")
        second = self.create()
        new_loans = [loan for loan in second["application"]["financials"]["existing_loans"] if loan["loan_id"].startswith("cabinet-loan:")]
        self.assertEqual(len(new_loans), 1)
        self.assertEqual(new_loans[0]["outstanding_principal"], "500000.00")
        self.assertEqual(Decimal(second["application"]["financials"]["cash_balance"]), Decimal(baseline["financials"]["cash_balance"]) + 500000)
        preview = self.action(second, "preview")
        metrics = preview["result"]["financial_metrics"]
        base_debt = sum(Decimal(loan["monthly_payment"]) for loan in baseline["financials"]["existing_loans"])
        self.assertEqual(Decimal(metrics["existing_monthly_debt_service"]), base_debt + Decimal(new_loans[0]["monthly_payment"]))
        calendar = self.client.get("/api/calendar").json()
        bank_payments = [item for item in calendar["events"] if item["kind"] == "existing_loan_payment"]
        self.assertTrue(bank_payments)
        self.assertTrue(all(item["loan_id"] in {loan["loan_id"] for loan in baseline["financials"]["existing_loans"]} for item in bank_payments))
        payments = [item for item in calendar["events"] if item["application_id"] == first["application"]["application_id"] and item["direction"] == "outflow"]
        self.assertEqual(len(payments), 12)
        self.assertTrue(all(item["forecast"] for item in payments))
        self.assertEqual(payments[-1]["kind"], "loan_final_payment")
        self.assertEqual(payments[-1]["date"], first["completion"]["schedule"][-1]["date"])
        repeated = self.action(first, "sign", offer_id=first["state"]["selected_offer_id"], confirmed=True)
        self.assertEqual(repeated["completion"], first["completion"])
        self.assertEqual(self.client.get("/api/profile").json()["financials"], second["application"]["financials"])
        self.client.__exit__(None, None, None)
        self.client = TestClient(create_app(self.path, clock=lambda: self.now)).__enter__()
        self.assertEqual(self.client.get("/api/calendar").json(), calendar)
        self.assertEqual(len(self.create()["application"]["financials"]["existing_loans"]), len(baseline["financials"]["existing_loans"]) + 1)

    def test_first_issue_invalidates_previously_ready_second_offer(self):
        first = self.ready(self.create())
        second = self.ready(self.create())
        self.action(first, "sign", offer_id=first["state"]["selected_offer_id"], confirmed=True)
        url = f"/api/applications/{second['application']['application_id']}"
        refreshed = self.client.get(url).json()
        self.assertEqual(refreshed["application"]["application_version"], second["application"]["application_version"] + 1)
        self.assertIsNone(refreshed["result"])
        self.assertEqual(refreshed["state"]["status"], "draft")
        response = self.client.post(url + "/sign", json={"base_application_version": second["application"]["application_version"],
            "offer_id": second["state"]["selected_offer_id"], "confirmed": True})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(len(self.client.get("/api/calendar").json()["accounts"]), 1)

    def test_bank_schedule_added_to_cash_plan_once_and_client_cannot_erase_debt(self):
        first = self.issue(self.create())
        second = self.create()
        payment = first["completion"]["schedule"][0]
        url = f"/api/applications/{second['application']['application_id']}"
        response = self.client.patch(url, json={"base_application_version": 1, "changes": {"product_details.overdraft": {
            "start_date": "2026-10-22", "end_date": payment["date"], "opening_cash_balance": second["application"]["financials"]["cash_balance"],
            "cash_reserve": "0.00", "transactions": [{"transaction_id": "income", "date": payment["date"], "amount": "500000.00", "direction": "inflow"}], "existing_debt_payments": []}}})
        self.assertEqual(response.status_code, 200, response.text)
        record = response.json()
        plan = record["application"]["product_details"]["overdraft"]
        self.assertEqual(include_scheduled_payments(plan, record["application"]["financials"]["existing_loans"]), plan)
        managed = [row for row in plan["transactions"] if row["transaction_id"].startswith("bank-payment:cabinet-loan:")]
        self.assertEqual(len(managed), 1)
        self.assertEqual(managed[0]["amount"], payment["total_payment"])
        response = self.client.patch(url, json={"base_application_version": 2, "changes": {"financials.existing_loans": []}})
        self.assertEqual(response.status_code, 422)
        calendar = self.client.get("/api/calendar").json()
        planned = next(item for item in calendar["plans"] if item["application_id"] == second["application"]["application_id"])
        self.assertEqual([item["kind"] for item in planned["events"]], ["planned_inflow"])

    def test_unused_overdraft_limit_is_not_a_disbursed_loan(self):
        # The open limit itself is not debt; future draws remain a forecast.
        record = self.create()
        process = self.client.app.state.process
        with process.store.connect(write=True) as connection:
            stored = process.store.get(connection, record["application"]["application_id"])
            stored["completion"] = {"operation_id": "opened-limit", "type": "limit_opening", "amount": "200000.00", "product_id": "overdraft", "completed_at": self.now.isoformat()}
            stored["state"]["status"] = "limit_opened"
            process.store.save(connection, stored)
        self.assertFalse(any(loan["loan_id"].startswith("cabinet-loan:") for loan in self.create()["application"]["financials"]["existing_loans"]))
        calendar = self.client.get("/api/calendar").json()
        self.assertEqual(calendar["accounts"][0]["outstanding_principal"], "0.00")
        self.assertEqual(next(item for item in calendar["events"] if item["kind"] == "limit_opened")["direction"], "none")

    def test_incomplete_manual_plan_does_not_break_calendar(self):
        record = self.create()
        response = self.client.patch(f"/api/applications/{record['application']['application_id']}", json={
            "base_application_version": 1, "changes": {"product_details.overdraft": {
                "start_date": "2026-10-22", "end_date": "2026-11-22", "transactions": [None]}}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/api/calendar").status_code, 200)


if __name__ == "__main__":
    unittest.main()
