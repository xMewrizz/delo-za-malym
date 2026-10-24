from datetime import datetime
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.portfolio import include_scheduled_payments


class PortfolioTests(unittest.TestCase):
    def test_calendar_exposes_contract_interest_and_payment_components_without_mutating_debt(self):
        issued = self.issue(self.create())
        identifier = issued["application"]["application_id"]
        before = self.client.get(f"/api/applications/{identifier}").json()
        loan = self.client.get(f"/api/applications/{identifier}/loan").json()
        calendar = self.client.get("/api/calendar").json()
        account = next(item for item in calendar["accounts"] if item["application_id"] == identifier)
        self.assertEqual(account["annual_rate_percent"], loan["annual_rate_percent"])
        self.assertEqual(account["accrued_interest"], loan["accrued_interest"])
        payment = next(item for item in calendar["events"] if item["application_id"] == identifier and item["kind"] == "loan_payment")
        self.assertEqual(Decimal(payment["principal_amount"]) + Decimal(payment["interest_amount"]), Decimal(payment["amount"]))
        self.assertEqual(self.client.get(f"/api/applications/{identifier}").json(), before)

    def test_repeat_creates_a_draft_with_current_money_without_changing_the_original(self):
        original = self.issue(self.create())
        identifier = original["application"]["application_id"]
        before = self.client.get("/api/profile").json()
        result = self.client.post(f"/api/applications/{identifier}/repeat", json={})
        self.assertEqual(result.status_code, 201, result.text)
        repeated = result.json()
        self.assertNotEqual(repeated["application"]["application_id"], identifier)
        self.assertEqual(repeated["application"]["need"], original["application"]["need"])
        self.assertEqual(repeated["application"]["financials"]["cash_balance"], before["financials"]["cash_balance"])
        self.assertEqual(repeated["state"]["status"], "draft")
        self.assertIsNone(repeated["completion"])
        self.assertTrue(any(item["type"] == "application_repeated" for item in repeated["events"]))
        self.assertEqual(self.client.get(f"/api/applications/{identifier}").json(), original)
        self.assertEqual(self.client.get("/api/profile").json(), before)

    def test_default_profile_and_legacy_draft_drop_only_the_seed_debt(self):
        from copy import deepcopy
        from backend import demo
        self.assertEqual(self.client.get("/api/profile").json()["financials"]["existing_loans"], [])
        issued = self.issue(self.create())
        draft = self.create()
        identifier = draft["application"]["application_id"]
        sample, _ = demo.profile(self.now, include_sample_loan=True)
        process = self.client.app.state.process
        with process.store.connect(write=True) as connection:
            record = process.store.get(connection, identifier)
            for financials in (record["application"]["financials"], record["simulator"]["bank_financials"]):
                financials["existing_loans"].insert(0, deepcopy(sample["financials"]["existing_loans"][0]))
            record["simulator"]["known_loans"] = deepcopy(record["application"]["financials"]["existing_loans"])
            record["application"]["product_details"] = {"overdraft": {
                "start_date": "2026-10-22", "end_date": "2026-12-01", "opening_cash_balance": "800000.00",
                "transactions": [{"transaction_id": "old-payment", "date": "2026-11-15", "direction": "outflow", "amount": "35000.00"},
                    {"transaction_id": "manual-expense", "date": "2026-11-05", "direction": "outflow", "amount": "10000.00"}],
                "existing_debt_payments": [{"loan_id": "existing-001", "transaction_id": "old-payment"}]}}
            process.store.save(connection, record)
        before = self.client.get("/api/profile").json()["financials"]["cash_balance"]
        process.sync_portfolio()
        migrated = self.client.get("/api/applications/" + identifier).json()
        self.assertFalse(any(loan["loan_id"] == "existing-001" for loan in migrated["application"]["financials"]["existing_loans"]))
        self.assertEqual(migrated["application"]["financials"]["existing_loans"][0]["application_id"], issued["application"]["application_id"])
        plan = migrated["application"]["product_details"]["overdraft"]
        self.assertFalse(any(row["transaction_id"] == "old-payment" for row in plan["transactions"]))
        self.assertTrue(any(row["transaction_id"] == "manual-expense" for row in plan["transactions"]))
        self.assertEqual(self.client.get("/api/profile").json()["financials"]["cash_balance"], before)
        self.assertFalse(any(item["kind"] == "existing_loan_payment" for item in self.client.get("/api/calendar").json()["events"]))
        process.sync_portfolio()
        self.assertEqual(self.client.get("/api/applications/" + identifier).json(), migrated)

    def test_issuance_and_schedule_use_the_same_moscow_day_after_utc_date_changes(self):
        self.now = datetime.fromisoformat("2026-10-22T22:30:00+00:00")
        first = self.issue(self.create())
        calendar = self.client.get("/api/calendar").json()
        received = next(event for event in calendar["events"] if event["application_id"] == first["application"]["application_id"] and event["kind"] == "loan_received")
        self.assertEqual(received["date"], "2026-10-23")
        self.assertEqual(calendar["today"], "2026-10-23")
        self.assertEqual(first["completion"]["schedule"][0]["date"], "2026-11-23")

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
        self.assertEqual(bank_payments, [])
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

    def test_equipment_then_second_credit_uses_post_grace_capacity_and_restores_both_loans(self):
        second = self.create()
        before = self.action(second, "explorations", product_id="working_capital_loan")
        baseline_options = before["explorations"][-1]["result"]["options"]
        baseline = next(offer for offer in baseline_options if offer["term_months"] == 12)
        investment = self.client.post("/api/applications", json={"need": {
            "purpose": "investment", "preferred_product": "investment_loan", "project_cost": "1000000.00",
            "own_funds": "200000.00", "principal_grace_months": 3, "term_months": 36}})
        self.assertEqual(investment.status_code, 201, investment.text)
        first = self.issue(investment.json())
        first_id = first["application"]["application_id"]
        first_schedule = first["completion"]["schedule"]
        self.assertEqual(len(first_schedule), 36)
        self.assertTrue(all(row["principal_payment"] == "0.00" and row["total_payment"] == "12000.00" for row in first_schedule[:3]))
        maximum = max(Decimal(row["total_payment"]) for row in first_schedule)

        url = f"/api/applications/{second['application']['application_id']}"
        stale = self.client.post(url + "/explorations", json={"base_application_version": before["application"]["application_version"], "product_id": "working_capital_loan"})
        self.assertEqual(stale.status_code, 409)
        second = self.client.get(url).json()
        self.assertIsNone(second["result"])
        self.assertIsNone(second["application"]["confirmation"])
        loan = next(loan for loan in second["application"]["financials"]["existing_loans"] if loan.get("application_id") == first_id)
        self.assertEqual(loan["product_id"], "investment_loan")
        self.assertEqual(Decimal(loan["monthly_payment"]), maximum)
        second = self.action(second, "explorations", product_id="working_capital_loan")
        exploration = second["explorations"][-1]
        options = exploration["result"]["options"]
        self.assertIn(12, [offer["term_months"] for offer in options])
        selected = next(offer for offer in options if offer["term_months"] == 18)
        self.assertEqual(selected["amount"], "500000.00")
        self.assertEqual(Decimal(selected["available_monthly_payment"]), Decimal(baseline["available_monthly_payment"]) - maximum)
        self.assertNotEqual(Decimal(selected["available_monthly_payment"]), Decimal(baseline["available_monthly_payment"]) - Decimal("12000.00"))
        second = self.action(second, "explorations/" + exploration["exploration_id"] + "/apply", option_id=selected["option_id"], confirmed=True)
        second = self.ready(second)
        offer_id = second["state"]["selected_offer_id"]
        for condition in second["result"]["assessment"]["offers"][0]["conditions"]:
            second = self.action(second, "conditions/" + condition["code"] + "/complete", offer_id=offer_id, confirmed=True)
        second = self.action(second, "sign", offer_id=offer_id, confirmed=True)
        second_id = second["application"]["application_id"]
        self.assertEqual(second["completion"]["product_id"], "working_capital_loan")
        self.assertEqual(second["application"]["need"]["term_months"], 18)

        profile = self.client.get("/api/profile").json()
        self.assertEqual(profile["financials"]["cash_balance"], "1600000.00")
        own_loans = [loan for loan in profile["financials"]["existing_loans"] if loan.get("application_id")]
        self.assertEqual({loan["application_id"] for loan in own_loans}, {first_id, second_id})
        calendar = self.client.get("/api/calendar").json()
        for record in (first, second):
            payments = [event for event in calendar["events"] if event["application_id"] == record["application"]["application_id"] and event["direction"] == "outflow"]
            expected = record["completion"]["schedule"]
            self.assertEqual([(row["date"], row["amount"]) for row in payments], [(row["date"], row["total_payment"]) for row in expected])
        self.client.__exit__(None, None, None)
        self.client = TestClient(create_app(self.path, clock=lambda: self.now)).__enter__()
        self.assertEqual(self.client.get("/api/profile").json(), profile)
        self.assertEqual(self.client.get("/api/calendar").json(), calendar)

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
