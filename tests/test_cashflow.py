from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient

from backend.main import create_app
from credit_engine.cashflow import loan_cashflow, payment_calendar
from credit_engine.loans import calculate_loan


class PaymentCalendarTests(unittest.TestCase):
    def test_month_end_is_anchored_to_funding_day_and_preserves_money(self):
        calculation = calculate_loan("500000.00", 6, "24.00").to_dict()["calculation"]
        original = deepcopy(calculation["schedule"])
        schedule = payment_calendar(original, date(2028, 1, 31))
        self.assertEqual([row["date"] for row in schedule[:3]], ["2028-02-29", "2028-03-31", "2028-04-30"])
        self.assertEqual(calculation["schedule"], original)
        self.assertEqual(sum(Decimal(row["total_payment"]) for row in schedule), Decimal(calculation["total_repayment"]))
        self.assertEqual(schedule[-1]["closing_balance"], "0.00")

    def test_monthly_payment_uses_local_funding_date(self):
        option = {**calculate_loan("500000.00", 6, "24.00").to_dict()["calculation"]}
        result = loan_cashflow({"need": {}, "financials": {"cash_balance": "300000.00"}}, option, datetime.fromisoformat("2026-10-31T22:30:00+00:00"))
        self.assertEqual(result["funding_date"], "2026-11-01")
        self.assertEqual(result["schedule"][0]["date"], "2026-12-01")
        self.assertEqual(result["cash_flow"]["status"], "needs_information")


class LoanCashflowApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.now = datetime.fromisoformat("2026-10-22T12:00:00+03:00")
        self.app = create_app(Path(self.directory.name) / "test.sqlite3", clock=lambda: self.now)
        self.client = TestClient(self.app).__enter__()
        self.record = self.client.post("/api/demo/scenarios/working_capital_loan/01_approved").json()
        self.id = self.record["application"]["application_id"]
        self.path = "/api/applications/" + self.id
        self.plan = {"start_date": "2026-10-22", "end_date": "2026-12-05", "opening_cash_balance": "1.00", "cash_reserve": "0.00",
                     "transactions": [{"transaction_id": "purchase", "date": "2026-11-01", "amount": "450000.00", "direction": "outflow"},
                                      {"transaction_id": "receipt", "date": "2026-11-08", "amount": "500000.00", "direction": "inflow"},
                                      {"transaction_id": "next-purchase", "date": "2026-11-10", "amount": "600000.00", "direction": "outflow"},
                                      {"transaction_id": "existing-payment", "date": "2026-11-15", "amount": "35000.00", "direction": "outflow"}],
                     "existing_debt_payments": [{"loan_id": "existing-001", "transaction_id": "existing-payment"}]}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def prepare(self, plan=True):
        if plan:
            self.record = self.client.patch(self.path, json={"base_application_version": 1, "changes": {"product_details.overdraft": self.plan, "need.needed_by": "2026-11-01"}}).json()
        self.version = self.record["application"]["application_version"]
        response = self.client.post(self.path + "/explorations", json={"base_application_version": self.version, "product_id": "working_capital_loan"})
        self.assertEqual(response.status_code, 200, response.text)
        self.record = response.json()
        self.exploration = self.record["explorations"][-1]
        self.option = self.exploration["result"]["options"][0]
        self.url = self.path + f"/explorations/{self.exploration['exploration_id']}/options/{self.option['option_id']}/cash-flow"

    def forecast(self, **extra):
        return self.client.get(self.url, params={"base_application_version": self.version, **extra})

    def test_forecast_reconciles_bank_cash_business_operations_and_new_loan_payments(self):
        self.prepare()
        response = self.forecast()
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["funding_date"], "2026-11-01")
        self.assertEqual(result["cash_flow"]["status"], "calculated")
        days = {row["date"]: row for row in result["cash_flow"]["daily"]}
        # Opening cash comes from the bank, not the plan's stale snapshot.
        self.assertEqual(days["2026-11-01"]["cash_without_financing"], "-150000.00")
        self.assertEqual(days["2026-11-01"]["closing_cash"], "350000.00")
        self.assertEqual(days["2026-11-01"]["loan_received"], "500000.00")
        self.assertEqual(days["2026-11-15"]["outflow"], "35000.00")
        payment = result["schedule"][0]
        self.assertEqual(days["2026-12-01"]["loan_payment"], payment["total_payment"])
        self.assertEqual(days["2026-12-01"]["closing_principal"], payment["closing_balance"])
        expected = Decimal("300000.00") + Decimal(self.option["amount"])
        for row in result["cash_flow"]["daily"]:
            expected += Decimal(row["inflow"]) - Decimal(row["outflow"]) - Decimal(row["loan_payment"]) - Decimal(row["loan_fees"])
        self.assertEqual(Decimal(result["cash_flow"]["closing_cash"]), expected)
        self.assertEqual(self.client.get(self.path).json(), self.record)

    def test_delay_creates_shortfall_but_does_not_change_plan_until_confirmed_save(self):
        self.prepare()
        result = self.forecast(transaction_id="receipt", delay_days=10).json()
        self.assertEqual(result["cash_flow"]["status"], "calculated")
        self.assertEqual(result["scenario_cash_flow"]["status"], "cash_shortfall")
        self.assertEqual(result["scenario_cash_flow"]["minimum_cash"], "-285000.00")
        self.assertEqual(result["changes"][0], {"transaction_id": "receipt", "before": "2026-11-08", "after": "2026-11-18"})
        self.assertEqual(self.client.get(self.path).json(), self.record)
        saved = self.client.patch(self.path, json={"base_application_version": self.version, "changes": {"product_details.overdraft": result["projected_plan"]}})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["application"]["need"], self.record["application"]["need"])
        self.assertEqual(self.forecast().status_code, 409)

    def test_missing_plan_still_returns_payment_calendar_without_inventing_business_revenue(self):
        self.prepare(plan=False)
        result = self.forecast().json()
        self.assertTrue(result["schedule"])
        self.assertEqual(result["cash_flow"]["daily"], [])
        self.assertEqual(result["cash_flow"]["issues"][0]["code"], "missing_cash_plan")

    def test_unknown_receipt_and_incomplete_delay_are_rejected(self):
        self.prepare()
        self.assertEqual(self.forecast(transaction_id="not-found", delay_days=3).status_code, 422)
        self.assertEqual(self.forecast(transaction_id="purchase", delay_days=3).status_code, 422)
        self.assertEqual(self.forecast(transaction_id="receipt").status_code, 422)
        self.assertEqual(self.forecast(transaction_id="receipt", delay_days=31).status_code, 422)

    def test_delay_outside_horizon_does_not_silently_extend_plan(self):
        self.prepare()
        result = self.forecast(transaction_id="receipt", delay_days=30).json()
        self.assertEqual(result["scenario_cash_flow"]["status"], "invalid_data")
        self.assertNotIn("projected_plan", result)
        self.assertEqual(self.client.get(self.path).json(), self.record)

    def test_existing_debt_is_required_once_in_complete_month(self):
        self.plan["existing_debt_payments"] = []
        self.prepare()
        result = self.forecast().json()
        self.assertEqual(result["cash_flow"]["status"], "needs_information")
        self.assertEqual(result["cash_flow"]["issues"][0]["code"], "incomplete_debt_payment_plan")

    def test_unreviewed_payment_plan_does_not_silently_confirm_existing_debt(self):
        self.plan["debt_payments_confirmed"] = False
        self.prepare()
        result = self.forecast().json()
        self.assertEqual(result["cash_flow"]["status"], "needs_information")
        self.assertEqual(result["cash_flow"]["issues"][0]["code"], "debt_payments_not_confirmed")

    def test_foreign_option_and_stale_snapshot_cannot_be_read(self):
        self.prepare()
        self.assertEqual(self.client.get(self.url.replace(self.option["option_id"], "another"), params={"base_application_version": self.version}).status_code, 404)
        self.now = self.now.replace(day=30)
        self.assertEqual(self.forecast().status_code, 409)
