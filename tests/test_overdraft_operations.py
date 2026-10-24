from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from backend.main import create_app


class OverdraftOperationsTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.now = datetime.fromisoformat("2026-10-23T12:00:00+03:00")
        self.path = Path(self.directory.name) / "bank.sqlite3"
        self.client = TestClient(create_app(self.path, clock=lambda: self.now)).__enter__()
        self.record = self.issue_overdraft()
        self.identifier = self.record["application"]["application_id"]
        self.url = f"/api/applications/{self.identifier}/overdraft"

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def issue_overdraft(self):
        opening = self.client.get("/api/profile").json()["financials"]["cash_balance"]
        created = self.client.post("/api/applications", json={"need": {"purpose": "working_capital", "preferred_product": "overdraft",
            "financing_pattern": "cash_gap", "requested_amount": "150000.00"}, "product_details": {"overdraft": {
            "start_date": "2026-10-23", "end_date": "2026-10-30", "opening_cash_balance": opening, "cash_reserve": "0.00",
            "transactions": [{"transaction_id": "pay", "date": "2026-10-24", "direction": "outflow", "amount": str(Decimal(opening) + 150000)},
                             {"transaction_id": "income", "date": "2026-10-30", "direction": "inflow", "amount": "200000.00"}], "existing_debt_payments": []}}})
        self.assertEqual(created.status_code, 201, created.text)
        record = created.json()
        identifier = record["application"]["application_id"]
        version = record["application"]["application_version"]
        record = self.client.post(f"/api/applications/{identifier}/submit", json={"base_application_version": version, "confirmed": True}).json()
        self.assertEqual(record["state"]["status"], "offers_ready", record)
        assessment = record["result"]["assessment"]
        offer = assessment["offers"][0]
        record = self.client.post(f"/api/applications/{identifier}/select-offer", json={"base_application_version": version,
            "assessment_id": assessment["assessment_id"], "offer_id": offer["offer_id"]}).json()
        for condition in offer.get("conditions", []):
            record = self.client.post(f"/api/applications/{identifier}/conditions/{condition['code']}/complete", json={"base_application_version": version, "offer_id": offer["offer_id"], "confirmed": True}).json()
        record = self.client.post(f"/api/applications/{identifier}/sign", json={"base_application_version": version, "offer_id": offer["offer_id"], "confirmed": True}).json()
        self.assertEqual(record["state"]["status"], "limit_opened", record)
        return record

    def state(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def payload(self, amount, kind="expense", state=None):
        state = state or self.state()
        return {"base_account_version": state["account_version"], "amount": amount, "kind": kind, "purpose": "revenue" if kind == "receipt" else "supplier"}

    def execute(self, amount, kind="expense"):
        payload = self.payload(amount, kind)
        quote = self.client.post(self.url + "/preview", json=payload)
        self.assertEqual(quote.status_code, 200, quote.text)
        request = {**payload, "request_id": str(uuid4()), "calculated_on": quote.json()["calculated_on"], "confirmed": True}
        response = self.client.post(self.url + "/operations", json=request)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json(), request

    def use_debt(self):
        return self.execute(str(Decimal(self.state()["cash_balance"]) + 100000))[0]

    def test_opening_does_not_credit_cash_and_forecasts_never_post(self):
        state = self.state()
        self.assertEqual(state["cash_balance"], "300000.00")
        self.assertEqual(state["principal"], "0.00")
        self.assertEqual(state["available_limit"], "150000.00")
        self.now += timedelta(days=10)
        self.assertEqual(self.state()["principal"], "0.00")
        self.assertEqual(self.state()["operations"], [])
        self.assertFalse(any(event["forecast"] and event["kind"].startswith("overdraft_") for event in self.client.get("/api/calendar").json()["events"]))

    def test_expense_uses_own_money_then_overdraft_and_all_views_agree(self):
        result = self.use_debt()
        self.assertEqual(result["receipt"]["own_money"], "300000.00")
        self.assertEqual(result["receipt"]["overdraft_used"], "100000.00")
        self.assertEqual(result["state"]["cash_balance"], "0.00")
        self.assertEqual(result["state"]["principal"], "100000.00")
        self.assertEqual(result["state"]["available_limit"], "50000.00")
        account = next(row for row in self.client.get("/api/calendar").json()["accounts"] if row["application_id"] == self.identifier)
        self.assertEqual(account["outstanding_principal"], "100000.00")
        profile = self.client.get("/api/profile").json()
        self.assertEqual(profile["financials"]["cash_balance"], "0.00")
        self.assertEqual(profile["accounts"][0]["available_for_payments"], "50000.00")
        debt = next(loan for loan in profile["financials"]["existing_loans"] if loan["product_id"] == "overdraft")
        self.assertEqual(debt["outstanding_principal"], "100000.00")
        self.assertTrue(debt["is_commitment"])

    def test_payment_above_overdraft_limit_can_use_account_cash_without_creating_debt(self):
        before = self.state()
        quote = self.client.post(self.url + "/preview", json=self.payload("200000.00"))
        self.assertEqual(quote.status_code, 200, quote.text)
        self.assertEqual(quote.json()["own_money"], "200000.00")
        self.assertEqual(quote.json()["overdraft_used"], "0.00")
        self.assertEqual(self.state(), before)
        result, _ = self.execute("200000.00")
        self.assertEqual(result["state"]["principal"], "0.00")
        self.assertEqual(result["state"]["cash_balance"], "100000.00")
        self.assertEqual(result["state"]["available_limit"], "150000.00")
        self.assertEqual(result["state"]["accrued_interest"], "0.00")

    def test_receipt_pays_interest_then_principal_restores_limit_and_keeps_excess(self):
        self.use_debt()
        self.now += timedelta(days=7)
        state = self.state()
        expected = (Decimal("100000") * Decimal(state["annual_rate_percent"]) / 100 * 7 / 365).quantize(Decimal("0.01"))
        self.assertEqual(Decimal(state["accrued_interest"]), expected)
        result, _ = self.execute("50000.00", "receipt")
        self.assertEqual(Decimal(result["receipt"]["interest_paid"]), expected)
        self.assertEqual(Decimal(result["state"]["principal"]), 50000 + expected)
        self.assertEqual(result["state"]["cash_balance"], "0.00")
        self.assertEqual(result["state"]["accrued_interest"], "0.00")
        result, _ = self.execute("100000.00", "receipt")
        self.assertEqual(result["state"]["principal"], "0.00")
        self.assertEqual(result["state"]["available_limit"], "150000.00")
        self.assertEqual(Decimal(result["state"]["cash_balance"]), 50000 - expected)
        self.assertIsNone(result["state"]["repay_by"])

    def test_idempotency_and_stale_quotes_prevent_duplicate_and_over_limit_spending(self):
        state = self.state()
        over = self.client.post(self.url + "/preview", json=self.payload("450000.01", state=state))
        self.assertEqual(over.status_code, 422)
        self.assertEqual(self.state(), state)
        result, request = self.execute("400000.00")
        again = self.client.post(self.url + "/operations", json=request)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json(), result)
        changed = self.client.post(self.url + "/operations", json={**request, "amount": "1.00"})
        self.assertEqual(changed.status_code, 409)
        stale = self.client.post(self.url + "/preview", json=self.payload("1.00", state=state))
        self.assertEqual(stale.status_code, 409)

    def test_concurrent_expenses_cannot_spend_the_same_cash_or_limit_twice(self):
        state = self.state()
        payload = self.payload("400000.00", state=state)
        def pay(_):
            return self.client.post(self.url + "/operations", json={**payload, "request_id": str(uuid4()), "calculated_on": state["today"], "confirmed": True}).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(pay, range(2))), [200, 409])
        self.assertEqual(self.state()["principal"], "100000.00")

    def test_deadline_blocks_new_usage_but_incoming_money_still_repays(self):
        self.use_debt()
        first_deadline = self.state()["repay_by"]
        self.now += timedelta(days=30)
        self.execute("10000.00")
        self.assertEqual(self.state()["repay_by"], first_deadline)
        self.now += timedelta(days=30)
        self.assertTrue(self.state()["blocked"])
        self.assertEqual(self.client.post(self.url + "/preview", json=self.payload("1.00")).status_code, 422)
        result, _ = self.execute("200000.00", "receipt")
        self.assertEqual(result["state"]["principal"], "0.00")
        self.assertFalse(result["state"]["blocked"])

    def test_incoming_loan_credit_sweeps_existing_overdraft_and_persists_on_restart(self):
        self.use_debt()
        process = self.client.app.state.process
        # Та же проводка выдачи, которую фиксирует подписание разового кредита.
        record = process.create()
        with process.store.connect(write=True) as connection:
            stored = process.store.get(connection, record["application"]["application_id"])
            stored["completion"] = {"type": "disbursement", "product_id": "working_capital_loan", "amount": "70000.00", "operation_id": str(uuid4()), "completed_at": self.now.isoformat()}
            process.store.save(connection, stored)
            process.sync_portfolio(connection)
        self.assertEqual(self.state()["principal"], "30000.00")
        self.assertEqual(self.state()["cash_balance"], "0.00")
        with TestClient(create_app(self.path, clock=lambda: self.now)) as reopened:
            self.assertEqual(reopened.get(self.url).json(), self.state())

    def test_confirmation_contract_and_scenario_isolation(self):
        payload = self.payload("1.00")
        for extra in ({"purpose": "loan_repayment"}, {"confirmed": False}):
            response = self.client.post(self.url + "/operations", json={**payload, "request_id": str(uuid4()), "calculated_on": self.state()["today"], "confirmed": True, **extra})
            self.assertEqual(response.status_code, 422)
        request = {**payload, "request_id": str(uuid4()), "calculated_on": "2026-10-22", "confirmed": True}
        self.assertEqual(self.client.post(self.url + "/operations", json=request).status_code, 409)
        self.now += timedelta(days=366)
        self.assertEqual(self.state()["available_limit"], "0.00")
        self.assertEqual(self.state()["principal"], "0.00")
