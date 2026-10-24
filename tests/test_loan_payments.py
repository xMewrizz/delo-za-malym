from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
import unittest

from tests import test_portfolio as fixture


class LoanPaymentTests(unittest.TestCase):
    setUp = fixture.PortfolioTests.setUp
    tearDown = fixture.PortfolioTests.tearDown
    create = fixture.PortfolioTests.create
    action = fixture.PortfolioTests.action
    ready = fixture.PortfolioTests.ready
    issue = fixture.PortfolioTests.issue

    def opened(self):
        view = self.issue(self.create())
        self.id = view["application"]["application_id"]
        self.url = f"/api/applications/{self.id}/loan"
        return view

    def state(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def pay(self, amount, *, version=None, request_id=None, day=None):
        return self.client.post(self.url + "/payments", json={"amount": amount, "base_loan_version": version or self.state()["version"],
            "request_id": request_id or str(uuid4()), "calculated_on": day or self.state()["today"], "confirmed": True})

    def test_preview_is_read_only_and_partial_payment_reduces_debt_schedule_and_cash(self):
        original = self.opened()
        before = self.client.get("/api/profile").json()
        preview = self.client.post(self.url + "/preview", json={"amount": "100000.00", "base_loan_version": 1})
        self.assertEqual(preview.status_code, 200, preview.text)
        self.assertEqual(preview.json()["remaining_principal"], "400000.00")
        self.assertEqual(self.client.get("/api/profile").json(), before)
        response = self.pay("100000.00")
        self.assertEqual(response.status_code, 200, response.text)
        state = response.json()
        self.assertEqual((state["principal"], state["version"]), ("400000.00", 2))
        self.assertEqual(sum(Decimal(row["principal_payment"]) for row in state["schedule"]), Decimal("400000"))
        self.assertEqual(state["schedule"][-1]["closing_balance"], "0.00")
        self.assertEqual([row["date"] for row in state["schedule"]], [row["date"] for row in original["completion"]["schedule"]])
        self.assertLess(Decimal(state["schedule"][0]["total_payment"]), Decimal(original["completion"]["schedule"][0]["total_payment"]))
        profile = self.client.get("/api/profile").json()["financials"]
        self.assertEqual(profile["cash_balance"], "700000.00")
        self.assertEqual(next(loan for loan in profile["existing_loans"] if loan.get("application_id") == self.id)["outstanding_principal"], "400000.00")
        self.assertEqual(self.client.get(f"/api/applications/{self.id}").json()["completion"]["schedule"], original["completion"]["schedule"])
        calendar = self.client.get("/api/calendar").json()
        actual = [item for item in calendar["events"] if item["application_id"] == self.id and item["kind"] == "loan_repayment"]
        self.assertEqual(len(actual), 1)
        self.assertFalse(actual[0]["forecast"])
        self.assertEqual(actual[0]["amount"], "100000.00")

    def test_full_payment_closes_product_and_removes_future_obligations(self):
        self.opened()
        response = self.pay("500000.00")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()["status"], response.json()["schedule"]), ("closed", []))
        profile = self.client.get("/api/profile").json()["financials"]
        self.assertEqual(profile["cash_balance"], "300000.00")
        self.assertFalse(any(item.get("application_id") == self.id for item in profile["existing_loans"]))
        calendar = self.client.get("/api/calendar").json()
        self.assertEqual(next(item for item in calendar["accounts"] if item["application_id"] == self.id)["status"], "closed")
        self.assertFalse(any(item["application_id"] == self.id and item["forecast"] for item in calendar["events"]))

    def test_one_kopeck_remainder_does_not_create_zero_value_payments(self):
        self.opened()
        response = self.pay("499999.99")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["principal"], "0.01")
        self.assertEqual(len(response.json()["schedule"]), 1)
        self.assertEqual(response.json()["schedule"][0]["total_payment"], "0.01")

    def test_interest_is_paid_before_principal_and_not_charged_twice(self):
        self.opened()
        self.now += timedelta(days=1)
        self.assertEqual(self.state()["accrued_interest"], "322.58")
        response = self.pay("1000.00")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["operations"][0]["interest_paid"], "322.58")
        self.assertEqual(response.json()["principal"], "499322.58")
        self.assertEqual(self.state()["accrued_interest"], "0.00")
        self.pay("1000.00")
        self.assertEqual(self.state()["operations"][-1]["interest_paid"], "0.00")
        self.assertEqual(self.state()["principal"], "498322.58")

    def test_idempotency_version_and_invalid_amounts(self):
        self.opened()
        request = str(uuid4())
        first = self.pay("100000.00", version=1, request_id=request)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(self.pay("100000.00", version=1, request_id=request).json(), first.json())
        self.assertEqual(self.pay("100001.00", version=1, request_id=request).status_code, 409)
        self.assertEqual(self.pay("100000.00", version=1).status_code, 409)
        for amount in ("-1.00", "0.00", "NaN", "1.001", "100", "400000.01"):
            self.assertEqual(self.pay(amount).status_code, 422, amount)
        self.assertEqual(len(self.state()["operations"]), 1)

    def test_parallel_payments_and_expired_quotes(self):
        self.opened()
        day = self.state()["today"]
        def pay(_):
            return self.pay("100000.00", version=1, day=day).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(pay, range(2))), [200, 409])
        self.now += timedelta(days=1)
        self.assertEqual(self.pay("1000.00", day=day).status_code, 409)
        self.assertEqual(len(self.state()["operations"]), 1)

    def test_payment_survives_restart_and_invalidates_unsubmitted_offers(self):
        self.opened()
        draft = self.create()
        self.assertEqual(self.pay("100000.00").status_code, 200)
        refreshed = self.client.get("/api/applications/" + draft["application"]["application_id"]).json()
        self.assertGreater(refreshed["application"]["application_version"], draft["application"]["application_version"])
        from backend.main import create_app
        from fastapi.testclient import TestClient
        with TestClient(create_app(self.path, clock=lambda: self.now)) as client:
            self.assertEqual(client.get(self.url).json(), self.state())

    def test_insufficient_cash_does_not_mutate_the_ledger(self):
        self.opened()
        self.now += timedelta(days=1200)
        close = self.state()["amount_to_close"]
        preview = self.client.post(self.url + "/preview", json={"amount": close, "base_loan_version": 1})
        self.assertEqual(preview.status_code, 200, preview.text)
        self.assertFalse(preview.json()["can_pay"])
        self.assertEqual(self.pay(close).status_code, 422)
        self.assertEqual(self.state()["operations"], [])

    def test_calendar_penalty_endpoint_uses_server_schedule_and_never_changes_cash(self):
        self.opened()
        profile = self.client.get("/api/profile").json()
        response = self.client.post("/api/calendar/penalty-preview", json={"from_date": "2026-10-22", "target_date": "2026-11-30",
            "products": [{"product_id": "app:" + self.id, "daily_rate_percent": "0.05"}]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["products"][0]["payments"][0]["days"], 8)
        self.assertEqual(self.client.get("/api/profile").json(), profile)

    def test_partial_payment_preserves_investment_grace_and_month_end_dates(self):
        from credit_engine.loans import calculate_loan
        from credit_engine.cashflow import payment_calendar
        from backend.loan_payments import reduced_schedule
        from datetime import date
        schedule = payment_calendar(calculate_loan("500000.00", 12, "24.00", principal_grace_months=3).to_dict()["calculation"]["schedule"], date(2028, 1, 31))
        completion = {"completed_at": "2028-01-31T12:00:00+03:00", "schedule": schedule}
        result = reduced_schedule(completion, Decimal("400000.00"), Decimal("0.00"), date(2028, 1, 31), Decimal("24.00"))
        self.assertEqual([row["principal_payment"] for row in result[:3]], ["0.00"] * 3)
        self.assertEqual(result[0]["date"], "2028-02-29")
        self.assertEqual(result[1]["date"], "2028-03-31")
        self.assertEqual(sum(Decimal(row["principal_payment"]) for row in result), Decimal("400000.00"))
        self.assertEqual(result[-1]["closing_balance"], "0.00")

    def quote(self, amount="70000.00", **kwargs):
        payload = {"amount": amount, "base_loan_version": self.state()["version"], **kwargs}
        result = self.client.post(self.url + "/preview", json=payload)
        self.assertEqual(result.status_code, 200, result.text)
        return payload, result.json()

    def confirm_quote(self, payload, quote, request_id=None):
        return self.client.post(self.url + "/payments", json={**payload, "amount": quote["amount"],
            "request_id": request_id or str(uuid4()), "calculated_on": quote["calculated_on"], "confirmed": True})

    def test_strategies_have_different_payment_and_maturity_and_do_not_cancel_next_due(self):
        self.opened()
        _, payment = self.quote(strategy="reduce_payment")
        _, term = self.quote(strategy="reduce_term")
        self.assertLess(Decimal(payment["mandatory_after"]), Decimal(term["mandatory_after"]))
        self.assertEqual(term["mandatory_after"], term["mandatory_before"])
        self.assertEqual(payment["maturity_before"], payment["maturity_after"])
        self.assertLess(term["maturity_after"], term["maturity_before"])
        self.assertGreater(Decimal(term["interest_saving"]), Decimal(payment["interest_saving"]))
        for quote in (payment, term):
            self.assertEqual(Decimal(quote["principal_paid"]) + Decimal(quote["interest_paid"]), Decimal(quote["amount"]))
            self.assertGreater(Decimal(quote["mandatory_after"]), 0)

    def test_scheduled_payment_has_no_cash_or_debt_effect_until_execution_and_is_idempotent(self):
        self.opened()
        before = self.client.get("/api/profile").json()
        due = (self.now + timedelta(days=2)).date().isoformat()
        payload, quote = self.quote(execution_date=due, strategy="reduce_term")
        request_id = str(uuid4())
        response = self.confirm_quote(payload, quote, request_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.confirm_quote(payload, quote, request_id).json(), response.json())
        self.assertEqual(self.client.get("/api/profile").json(), before)
        state = response.json()
        self.assertEqual((state["principal"], len(state["operations"]), state["orders"][0]["status"]), ("500000.00", 0, "pending"))
        calendar = self.client.get("/api/calendar").json()
        order = next(item for item in calendar["events"] if item["kind"] == "loan_payment_order")
        self.assertEqual((order["date"], order["direction"]), (due, "none"))
        self.assertEqual(self.pay("100.00").status_code, 409)
        self.now += timedelta(days=2)
        # Any API read processes due instructions once, before returning its response.
        profile = self.client.get("/api/profile").json()
        self.assertEqual(profile["financials"]["cash_balance"], "730000.00")
        state = self.state()
        self.assertEqual((len(state["operations"]), state["orders"][0]["status"]), (1, "executed"))
        self.assertEqual(state["principal"], quote["remaining_principal"])
        self.assertEqual(state["schedule"], quote["schedule"])
        self.assertEqual(self.confirm_quote(payload, quote, request_id).json(), state)
        self.assertEqual(len(self.state()["operations"]), 1)

    def test_order_can_be_cancelled_without_touching_cash_and_stale_version_cannot_cancel(self):
        self.opened()
        payload, quote = self.quote(execution_date=(self.now + timedelta(days=3)).date().isoformat())
        state = self.confirm_quote(payload, quote).json()
        url = self.url + "/orders/" + state["orders"][0]["order_id"] + "/cancel"
        self.assertEqual(self.client.post(url, json={"base_loan_version": 1}).status_code, 409)
        response = self.client.post(url, json={"base_loan_version": state["version"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["orders"][0]["status"], "cancelled")
        self.now += timedelta(days=4)
        self.assertEqual(self.state()["operations"], [])
        self.assertEqual(self.client.get("/api/profile").json()["financials"]["cash_balance"], "800000.00")

    def test_regular_payment_removes_only_paid_installment_and_keeps_future_schedule(self):
        self.opened()
        original = self.state()["schedule"]
        payload, quote = self.quote(original[0]["total_payment"], execution_date=original[0]["date"], payment_kind="regular")
        self.assertEqual(quote["mandatory_after"], "0.00")
        self.assertEqual(quote["schedule"], original[1:])
        self.assertEqual(self.confirm_quote(payload, quote).status_code, 200)
        from datetime import datetime, timezone
        self.now = datetime.fromisoformat(original[0]["date"] + "T12:00:00+03:00").astimezone(timezone.utc)
        state = self.state()
        self.assertEqual(state["orders"][0]["status"], "executed")
        self.assertEqual(state["schedule"], original[1:])
        self.assertEqual(state["principal"], original[0]["closing_balance"])
        self.assertEqual(state["accrued_interest"], "0.00")

    def test_late_regular_instruction_fails_instead_of_changing_confirmed_amount(self):
        self.opened()
        original = self.state()["schedule"][0]
        payload, quote = self.quote(original["total_payment"], execution_date=original["date"], payment_kind="regular")
        self.confirm_quote(payload, quote)
        from datetime import datetime, timezone
        self.now = datetime.fromisoformat(original["date"] + "T12:00:00+03:00").astimezone(timezone.utc) + timedelta(days=1)
        state = self.state()
        self.assertEqual(state["orders"][0]["status"], "failed")
        self.assertEqual(state["operations"], [])
        self.assertEqual(state["principal"], "500000.00")
        self.assertEqual(self.state(), state)

    def test_full_close_quote_on_future_date_adds_interest_and_closes_without_remaining_due(self):
        self.opened()
        due = (self.now + timedelta(days=2)).date().isoformat()
        payload, quote = self.quote("500000.00", execution_date=due, full_repayment=True)
        self.assertGreater(Decimal(quote["amount"]), Decimal("500000.00"))
        self.assertEqual((quote["schedule"], quote["mandatory_after"]), ([], "0.00"))
        self.assertEqual(self.confirm_quote(payload, quote).status_code, 200)
        self.now += timedelta(days=2)
        self.assertEqual(self.state()["status"], "closed")

    def test_early_payment_on_due_date_keeps_remaining_installment_visible(self):
        self.opened()
        from datetime import datetime, timezone
        due = self.state()["schedule"][0]["date"]
        self.now = datetime.fromisoformat(due + "T12:00:00+03:00").astimezone(timezone.utc)
        _, quote = self.quote("70000.00", strategy="reduce_term")
        self.assertEqual(quote["next_payment"]["date"], due)
        self.assertGreater(Decimal(quote["mandatory_after"]), 0)

    def test_settlement_account_tracks_issuance_and_payment_without_adding_unused_limits(self):
        before = self.client.get("/api/profile").json()
        self.opened()
        issued = self.client.get("/api/profile").json()
        account = issued["accounts"][0]
        self.assertEqual(account["available_balance"], issued["financials"]["cash_balance"])
        self.assertEqual(Decimal(account["balance"]) - Decimal(before["accounts"][0]["balance"]), Decimal("500000.00"))
        self.pay("70000.00")
        paid = self.client.get("/api/profile").json()
        self.assertEqual(Decimal(paid["accounts"][0]["balance"]), Decimal(account["balance"]) - Decimal("70000.00"))
        self.assertEqual(paid["accounts"][0]["balance"], paid["financials"]["cash_balance"])

    def test_late_regular_payment_does_not_charge_elapsed_interest_twice(self):
        self.opened()
        from datetime import datetime, timezone
        original = self.state()["schedule"]
        self.now = datetime.fromisoformat(original[0]["date"] + "T12:00:00+03:00").astimezone(timezone.utc) + timedelta(days=2)
        state = self.state()
        amount = format(Decimal(original[0]["principal_payment"]) + Decimal(state["accrued_interest"]), ".2f")
        payload, quote = self.quote(amount, payment_kind="regular")
        self.assertLess(Decimal(quote["schedule"][0]["interest_payment"]), Decimal(original[1]["interest_payment"]))
        self.assertEqual(self.confirm_quote(payload, quote).status_code, 200)
        self.assertEqual(self.state()["accrued_interest"], "0.00")
        row = self.state()["schedule"][0]
        # The new schedule and the server's next payment calculation agree.
        self.quote(row["total_payment"], payment_kind="regular", execution_date=row["date"])
