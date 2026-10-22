from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4
import unittest

from fastapi.testclient import TestClient
from backend.main import create_app


class RevolvingTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "line.sqlite3"
        self.now = datetime.fromisoformat("2026-10-23T12:00:00+03:00")
        self.client = TestClient(create_app(self.path, clock=lambda: self.now)).__enter__()
        self.addCleanup(lambda: self.client.__exit__(None, None, None))

    def create(self, amount="500000.00"):
        response = self.client.post("/api/applications", json={"need": {"purpose": "working_capital", "preferred_product": "revolving_credit_line", "requested_amount": amount, "term_months": 12}})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def action(self, view, path, **extra):
        response = self.client.post("/api/applications/" + view["application"]["application_id"] + "/" + path, json={"base_application_version": view["application"]["application_version"], **extra})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def opened(self):
        view = self.action(self.create(), "submit", confirmed=True)
        result = view["result"]["assessment"]
        offer = next(offer for offer in result["offers"] if offer["term_months"] == 12)
        view = self.action(view, "select-offer", assessment_id=result["assessment_id"], offer_id=offer["offer_id"])
        view = self.action(view, "sign", confirmed=True, offer_id=offer["offer_id"])
        self.id = view["application"]["application_id"]
        self.url = "/api/applications/" + self.id + "/credit-line"
        return view

    def state(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def operate(self, kind, amount=None, *, version=None, request_id=None, expected=200):
        payload = {"kind": kind, "base_line_version": version or self.state()["version"], "request_id": request_id or str(uuid4()), "confirmed": True}
        if amount is not None:
            payload["amount"] = amount
        response = self.client.post(self.url + "/operations", json=payload)
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    def test_options_and_opening_do_not_disburse_limit_or_claim_fixed_cost(self):
        view = self.action(self.create(), "explorations", product_id="revolving_credit_line")
        options = view["explorations"][-1]["result"]["options"]
        self.assertTrue(options)
        self.assertTrue(all(offer["monthly_payment"] is None and offer["total_repayment"] is None for offer in options))
        opened = self.opened()
        self.assertEqual(opened["state"]["status"], "limit_opened")
        self.assertNotIn("schedule", opened["completion"])
        state = self.state()
        self.assertEqual((state["principal"], state["available_limit"], state["schedule"]), ("0.00", "500000.00", []))
        profile = self.client.get("/api/profile").json()["financials"]
        self.assertEqual(profile["cash_balance"], "300000.00")
        loan = next(loan for loan in profile["existing_loans"] if loan.get("is_commitment"))
        self.assertGreater(Decimal(loan["monthly_payment"]), 0)
        self.assertEqual(loan["outstanding_principal"], "0.00")
        self.assertFalse(any(event["direction"] == "inflow" for event in self.client.get("/api/calendar").json()["events"]))

    def test_draw_repay_draw_restores_only_principal_and_updates_cash_calendar(self):
        self.opened()
        self.operate("draw", "100000.00")
        self.now += timedelta(days=30)
        state = self.state()
        self.assertEqual(state["accrued_interest"], "1808.22")
        state = self.operate("repay", "20000.00")
        self.assertEqual(state["principal"], "81808.22")
        self.assertEqual(state["available_limit"], "418191.78")
        self.assertEqual(state["accrued_interest"], "0.00")
        self.assertEqual(state["operations"][-1]["interest_paid"], "1808.22")
        state = self.operate("draw", "50000.00")
        self.assertEqual(state["principal"], "131808.22")
        self.assertEqual(self.client.get("/api/profile").json()["financials"]["cash_balance"], "430000.00")
        events = [row for row in self.client.get("/api/calendar").json()["events"] if row["application_id"] == self.id]
        self.assertEqual(len([row for row in events if row["kind"] == "line_draw"]), 2)
        self.assertEqual(len([row for row in events if row["kind"] == "line_repay"]), 1)
        self.assertEqual(next(row["amount"] for row in events if row["kind"] == "line_final_payment"), state["schedule"][-1]["total_payment"])

    def test_repeat_stale_version_and_limits_are_safe(self):
        self.opened()
        request = str(uuid4())
        first = self.operate("draw", "100000.00", version=1, request_id=request)
        again = self.operate("draw", "100000.00", version=1, request_id=request)
        self.assertEqual(first, again)
        self.operate("draw", "200000.00", version=1, request_id=request, expected=409)
        self.operate("draw", "100000.00", version=1, expected=409)
        self.operate("draw", "400000.01", expected=422)
        self.operate("repay", "100000.01", expected=422)
        self.assertEqual(len(self.state()["operations"]), 1)

    def test_parallel_draws_cannot_exceed_approved_limit(self):
        self.opened()
        def draw(_):
            return self.client.post(self.url + "/operations", json={"kind": "draw", "amount": "350000.00", "confirmed": True, "base_line_version": 1, "request_id": str(uuid4())}).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = sorted(pool.map(draw, range(2)))
        self.assertEqual(statuses, [200, 409])
        self.assertEqual(self.state()["principal"], "350000.00")

    def test_interest_arrears_and_expiry_block_draws_but_allow_repayment(self):
        self.opened()
        self.operate("draw", "100000.00")
        self.now = datetime.fromisoformat("2026-11-24T12:00:00+03:00")
        state = self.state()
        self.assertTrue(state["overdue_interest"])
        self.assertEqual(state["available_limit"], "0.00")
        self.operate("draw", "1000.00", expected=409)
        self.operate("repay", state["accrued_interest"])
        self.operate("draw", "1000.00")
        self.now = datetime.fromisoformat("2027-10-23T12:00:00+03:00")
        self.assertTrue(self.state()["matured"])
        self.operate("draw", "1000.00", expected=409)
        self.operate("close", expected=422)
        self.operate("repay", self.state()["amount_to_close"])
        self.assertEqual(self.operate("close")["status"], "closed")
        self.operate("draw", "1000.00", expected=409)

    def test_open_line_reserves_next_credit_capacity_and_close_releases_it(self):
        draft = self.client.post("/api/applications", json={}).json()
        self.opened()
        refreshed = self.client.get("/api/applications/" + draft["application"]["application_id"]).json()
        self.assertGreater(refreshed["application"]["application_version"], 1)
        self.assertTrue(any(loan.get("is_commitment") for loan in refreshed["application"]["financials"]["existing_loans"]))
        self.operate("close")
        self.assertFalse(any(loan.get("is_commitment") for loan in self.client.get("/api/profile").json()["financials"]["existing_loans"]))
        self.assertEqual(self.client.get("/api/profile").json()["financials"]["cash_balance"], "300000.00")

    def test_leap_year_interest_restart_and_refinancing_isolation(self):
        self.now = datetime.fromisoformat("2028-02-28T12:00:00+03:00")
        self.opened()
        self.operate("draw", "100000.00")
        self.now += timedelta(days=2)
        self.assertEqual(self.state()["accrued_interest"], "120.22")
        with TestClient(create_app(self.path, clock=lambda: self.now)) as client:
            self.assertEqual(client.get(self.url).json(), self.state())
        loan = next(loan for loan in self.client.get("/api/profile").json()["financials"]["existing_loans"] if loan.get("is_commitment"))
        view = self.client.post("/api/applications", json={"need": {"purpose": "refinancing"}, "product_details": {"refinancing": {"loan_ids": [loan["loan_id"]]}}}).json()
        view = self.action(view, "explorations", product_id="refinancing")
        self.assertEqual(view["explorations"][-1]["result"]["status"], "needs_information")

    def test_invalid_operations_are_rejected_before_mutating_ledger(self):
        self.opened()
        for amount in ("-1.00", "0.00", "NaN", "100", "1.001"):
            self.operate("draw", amount, expected=422)
        self.assertEqual(self.state()["version"], 1)
