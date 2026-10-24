from copy import deepcopy
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4
import unittest

from fastapi.testclient import TestClient

from backend.main import create_app
from credit_engine.refinancing import selected_debts


class RefinancingTests(unittest.TestCase):
    def test_monthly_peak_uses_combined_calendar_instead_of_sum_of_individual_peaks(self):
        application = {"product_details": {"refinancing": {"loan_ids": ["first", "second"]}}, "financials": {"existing_loans": [
            {"loan_id": "first", "outstanding_principal": "100000.00", "monthly_payment": "90000.00", "schedule": [
                {"date": "2026-11-15", "total_payment": "90000.00"}, {"date": "2026-12-15", "total_payment": "10000.00"}]},
            {"loan_id": "second", "outstanding_principal": "100000.00", "monthly_payment": "90000.00", "schedule": [
                {"date": "2026-11-25", "total_payment": "10000.00"}, {"date": "2026-12-25", "total_payment": "90000.00"}]}]}}
        comparison = selected_debts(application, datetime.fromisoformat("2026-10-23T12:00:00+03:00"))
        self.assertEqual(comparison["current_monthly_payment"], "100000.00")
        self.assertEqual(comparison["current_payment_in_comparison_month"], "100000.00")
        self.assertEqual(comparison["comparison_month"], "2026-11")
        midnight = selected_debts(application, datetime.fromisoformat("2026-10-31T22:30:00+00:00"))
        self.assertEqual(midnight["comparison_month"], "2026-12")

    def test_refinancing_during_investment_grace_shows_first_month_increase_and_replaces_debt(self):
        first = self.client.post("/api/applications", json={"need": {"purpose": "investment", "project_cost": "1000000.00",
            "own_funds": "200000.00", "principal_grace_months": 3, "term_months": 36}}).json()
        first = self.action(first, "submit", confirmed=True)
        assessment = first["result"]["assessment"]
        first = self.action(first, "select-offer", assessment_id=assessment["assessment_id"], offer_id=assessment["offers"][0]["offer_id"])
        first = self.sign(first)
        first_id = first["application"]["application_id"]
        before = self.client.get("/api/profile").json()
        old_id = next(loan["loan_id"] for loan in before["financials"]["existing_loans"] if loan.get("application_id") == first_id)
        ready = self.ready(self.create([old_id]), term=36)
        offer = ready["result"]["assessment"]["offers"][0]
        comparison = offer["refinancing"]
        self.assertEqual(comparison["current_payment_in_comparison_month"], "12000.00")
        self.assertGreater(Decimal(comparison["monthly_payment_reduction"]), 0)
        self.assertGreater(Decimal(comparison["first_month_payment_change"]), 0)
        self.assertEqual(Decimal(comparison["first_month_payment_change"]), Decimal(offer["schedule"][0]["total_payment"]) - Decimal("12000.00"))
        self.assertEqual(Decimal(comparison["current_total_repayment"]), sum(Decimal(row["total_payment"]) for row in first["completion"]["schedule"]))
        completed = self.sign(ready)
        after = self.client.get("/api/profile").json()
        self.assertEqual(after["financials"]["cash_balance"], before["financials"]["cash_balance"])
        self.assertNotIn(old_id, [loan["loan_id"] for loan in after["financials"]["existing_loans"]])
        self.assertEqual(len(after["financials"]["existing_loans"]), 2)
        calendar = self.client.get("/api/calendar").json()
        self.assertFalse(any(event["application_id"] == first_id and event["direction"] == "outflow" for event in calendar["events"]))
        self.assertTrue(any(event["application_id"] == completed["application"]["application_id"] and event["direction"] == "outflow" for event in calendar["events"]))
        self.assertEqual(self.sign(ready)["completion"], completed["completion"])
        self.assertEqual(self.client.get("/api/profile").json(), after)

        self.client.__exit__(None, None, None)
        self.client = TestClient(create_app(self.path, clock=lambda: self.now)).__enter__()
        self.assertEqual(self.client.get("/api/profile").json(), after)
        self.assertEqual(self.client.get("/api/calendar").json(), calendar)

    def setUp(self):
        from backend import demo
        from unittest.mock import patch
        original_profile = demo.profile
        fixture = patch("backend.demo.profile", side_effect=lambda now: original_profile(now, include_sample_loan=True))
        fixture.start()
        self.addCleanup(fixture.stop)
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "refinancing.sqlite3"
        self.now = datetime.fromisoformat("2026-10-22T12:00:00+03:00")
        self.client = TestClient(create_app(self.path, clock=lambda: self.now)).__enter__()
        self.addCleanup(lambda: self.client.__exit__(None, None, None))
        self.initial = self.client.get("/api/profile").json()

    def create(self, ids=None):
        response = self.client.post("/api/applications", json={"need": {"purpose": "refinancing"},
            "product_details": {"refinancing": {"loan_ids": ["existing-001"] if ids is None else ids}}})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def action(self, view, path, **body):
        response = self.client.post(f"/api/applications/{view['application']['application_id']}/{path}",
            json={"base_application_version": view["application"]["application_version"], **body})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def ready(self, view, term=24):
        view = self.action(view, "explorations", product_id="refinancing")
        exploration = view["explorations"][-1]
        option = next(item for item in exploration["result"]["options"] if item["term_months"] == term)
        view = self.action(view, f"explorations/{exploration['exploration_id']}/apply", confirmed=True, option_id=option["option_id"])
        view = self.action(view, "submit", confirmed=True)
        assessment = view["result"]["assessment"]
        self.assertEqual(len(assessment["offers"]), 1)
        return self.action(view, "select-offer", assessment_id=assessment["assessment_id"], offer_id=assessment["offers"][0]["offer_id"])

    def sign(self, view):
        return self.action(view, "sign", confirmed=True, offer_id=view["state"]["selected_offer_id"])

    def test_repeat_excludes_debts_already_closed_by_the_original_refinancing(self):
        original = self.sign(self.ready(self.create()))
        identifier = original["application"]["application_id"]
        before = self.client.get("/api/profile").json()
        response = self.client.post(f"/api/applications/{identifier}/repeat", json={})
        self.assertEqual(response.status_code, 201, response.text)
        repeated = response.json()
        self.assertEqual(repeated["application"]["product_details"]["refinancing"]["loan_ids"], [])
        self.assertIsNone(repeated["application"]["need"]["requested_amount"])
        self.assertEqual(repeated["application"]["need"]["preferred_product"], "refinancing")
        self.assertEqual(repeated["state"]["status"], "draft")
        self.assertEqual(self.client.get(f"/api/applications/{identifier}").json(), original)
        self.assertEqual(self.client.get("/api/profile").json(), before)

    def test_multiple_offers_distinguish_payment_reduction_and_total_cost(self):
        original = self.create()
        view = self.action(original, "explorations", product_id="refinancing")
        self.assertEqual(view["application"], original["application"])
        options = view["explorations"][-1]["result"]["options"]
        terms = [item["term_months"] for item in options]
        self.assertEqual(terms, [12, 18, 24, 36, 48])
        self.assertTrue(all(item["product_id"] == "refinancing" and item["amount"] == "700000.00" for item in options))
        short, long = options[0], options[-1]
        self.assertLess(Decimal(short["refinancing"]["monthly_payment_reduction"]), 0)
        self.assertLess(Decimal(short["refinancing"]["total_cost_change"]), 0)
        self.assertGreater(Decimal(long["refinancing"]["monthly_payment_reduction"]), 0)
        self.assertGreater(Decimal(long["refinancing"]["total_cost_change"]), 0)
        self.assertEqual(short["refinancing"]["current_total_repayment"], "805000.00")
        self.assertTrue(all(item.get("schedule") for item in options))

    def test_bank_credit_replaced_without_extra_cash_and_calendar_double_count(self):
        old_draft = self.client.post("/api/applications", json={}).json()
        ready = self.ready(self.create())
        completed = self.sign(ready)
        self.assertEqual(completed["completion"]["cash_to_client"], "0.00")
        self.assertEqual([loan["loan_id"] for loan in completed["completion"]["repaid_loans"]], ["existing-001"])
        profile = self.client.get("/api/profile").json()
        self.assertEqual(profile["financials"]["cash_balance"], self.initial["financials"]["cash_balance"])
        self.assertEqual(len(profile["financials"]["existing_loans"]), 1)
        new_loan = profile["financials"]["existing_loans"][0]
        self.assertNotEqual(new_loan["loan_id"], "existing-001")
        calendar = self.client.get("/api/calendar").json()
        self.assertFalse(any(item["kind"] == "existing_loan_payment" for item in calendar["events"]))
        self.assertEqual(len([item for item in calendar["events"] if item["kind"] in ("loan_payment", "loan_final_payment")]), 24)
        self.assertEqual(next(item for item in calendar["events"] if item["kind"] == "refinancing_completed")["direction"], "none")
        self.assertEqual(len([item for item in calendar["events"] if item["kind"] == "loan_refinanced"]), 1)
        updated = self.client.get("/api/applications/" + old_draft["application"]["application_id"]).json()
        self.assertEqual(updated["application"]["application_version"], 2)
        self.assertEqual(updated["application"]["financials"], profile["financials"])
        next_request = self.client.post("/api/applications", json={"need": {"purpose": "working_capital", "preferred_product": "working_capital_loan", "requested_amount": "100000.00", "term_months": 12}}).json()
        preview = self.action(next_request, "preview")
        self.assertEqual(Decimal(preview["result"]["financial_metrics"]["existing_monthly_debt_service"]), Decimal(new_loan["monthly_payment"]))
        self.assertEqual(self.sign(ready)["completion"], completed["completion"])
        self.assertEqual(self.client.get("/api/profile").json(), profile)

    def test_refinancing_previously_issued_credit_preserves_received_cash_and_closes_old_schedule(self):
        first = self.client.post("/api/applications", json={"need": {"purpose": "working_capital", "preferred_product": "working_capital_loan", "requested_amount": "500000.00", "term_months": 12}}).json()
        first = self.action(first, "submit", confirmed=True)
        assessment = first["result"]["assessment"]
        first = self.action(first, "select-offer", assessment_id=assessment["assessment_id"], offer_id=assessment["offers"][0]["offer_id"])
        first = self.sign(first)
        profile = self.client.get("/api/profile").json()
        old_id = next(loan["loan_id"] for loan in profile["financials"]["existing_loans"] if loan.get("application_id"))
        completed = self.sign(self.ready(self.create([old_id])))
        after = self.client.get("/api/profile").json()
        self.assertEqual(after["financials"]["cash_balance"], "800000.00")
        self.assertEqual(len(after["financials"]["existing_loans"]), 2)
        self.assertFalse(any(loan["loan_id"] == old_id for loan in after["financials"]["existing_loans"]))
        calendar = self.client.get("/api/calendar").json()
        old_account = next(item for item in calendar["accounts"] if item["application_id"] == first["application"]["application_id"])
        self.assertEqual(old_account["status"], "refinanced")
        self.assertEqual(old_account["outstanding_principal"], "0.00")
        self.assertFalse(any(item["application_id"] == first["application"]["application_id"] and item["direction"] == "outflow" for item in calendar["events"]))
        original = self.client.get("/api/applications/" + first["application"]["application_id"]).json()
        self.assertEqual(original["completion"]["refinanced_by"], completed["application"]["application_id"])
        self.assertEqual(len(original["submitted_versions"]), 1)

    def test_two_prepared_applications_cannot_pay_the_same_debt_twice(self):
        first, second = self.ready(self.create()), self.ready(self.create())
        self.sign(first)
        response = self.client.post(f"/api/applications/{second['application']['application_id']}/sign", json={
            "base_application_version": second["application"]["application_version"], "offer_id": second["state"]["selected_offer_id"], "confirmed": True})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(len(self.client.get("/api/profile").json()["financials"]["existing_loans"]), 1)

    def test_bank_and_cabinet_loans_consolidate_into_one_with_original_cash_preserved(self):
        first = self.client.post("/api/applications", json={"need": {"purpose": "working_capital", "preferred_product": "working_capital_loan", "requested_amount": "500000.00", "term_months": 12}}).json()
        first = self.action(first, "submit", confirmed=True)
        assessment = first["result"]["assessment"]
        first = self.action(first, "select-offer", assessment_id=assessment["assessment_id"], offer_id=assessment["offers"][0]["offer_id"])
        self.sign(first)
        ids = [loan["loan_id"] for loan in self.client.get("/api/profile").json()["financials"]["existing_loans"]]
        completed = self.sign(self.ready(self.create(ids)))
        self.assertEqual(completed["completion"]["amount"], "1200000.00")
        self.assertEqual({item["loan_id"] for item in completed["completion"]["repaid_loans"]}, set(ids))
        profile = self.client.get("/api/profile").json()["financials"]
        self.assertEqual(profile["cash_balance"], "800000.00")
        self.assertEqual(len(profile["existing_loans"]), 1)
        self.assertEqual(profile["existing_loans"][0]["application_id"], completed["application"]["application_id"])
        calendar = self.client.get("/api/calendar").json()
        payments = [item for item in calendar["events"] if item["direction"] == "outflow"]
        self.assertEqual(len(payments), 24)
        self.assertTrue(all(item["application_id"] == completed["application"]["application_id"] for item in payments))

    def test_closed_bank_loan_manual_payment_is_removed_from_future_plan(self):
        from backend.portfolio import include_scheduled_payments
        plan = {"start_date": "2026-11-01", "end_date": "2026-11-30", "transactions": [
            {"transaction_id": "manual-debt", "date": "2026-11-05", "direction": "outflow", "amount": "35000.00"},
            {"transaction_id": "supplier", "date": "2026-11-06", "direction": "outflow", "amount": "50000.00"}],
            "existing_debt_payments": [{"loan_id": "existing-001", "transaction_id": "manual-debt"}]}
        updated = include_scheduled_payments(plan, [], closed={"existing-001"})
        self.assertEqual([row["transaction_id"] for row in updated["transactions"]], ["supplier"])
        self.assertEqual(updated["existing_debt_payments"], [])

    def test_amount_is_server_derived_and_unknown_or_duplicate_loans_are_rejected(self):
        record = self.create()
        url = "/api/applications/" + record["application"]["application_id"]
        patched = self.client.patch(url, json={"base_application_version": 1, "changes": {"need.requested_amount": "100000.00"}})
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.json()["application"]["need"]["requested_amount"], "700000.00")
        for ids in (["not-a-bank-loan"], ["existing-001", "existing-001"]):
            with self.subTest(ids=ids):
                response = self.client.patch(url, json={"base_application_version": 2, "changes": {"product_details.refinancing": {"loan_ids": ids}}})
                self.assertEqual(response.status_code, 422)
                self.assertEqual(self.client.get(url).json()["application"]["application_version"], 2)

    def test_client_cannot_inject_cash_accounting_watermark(self):
        financials = deepcopy(self.initial["financials"])
        financials["portfolio_cash_total"] = "99999999.00"
        response = self.client.post("/api/applications", json={"financials": financials})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["application"]["financials"]["cash_balance"], "300000.00")
        self.assertEqual(response.json()["application"]["financials"]["portfolio_cash_total"], "0.00")

    def test_financial_section_update_retains_server_cash_accounting(self):
        completed = self.sign(self.ready(self.create()))
        record = self.client.post("/api/applications", json={}).json()
        financials = deepcopy(record["application"]["financials"])
        financials.pop("portfolio_cash_total")
        response = self.client.patch("/api/applications/" + record["application"]["application_id"], json={
            "base_application_version": 1, "changes": {"financials": financials}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["application"]["financials"]["portfolio_cash_total"], "0.00")
        self.assertEqual(response.json()["application"]["financials"]["cash_balance"], "300000.00")
        self.assertEqual(response.json()["application"]["financials"]["existing_loans"][0]["application_id"], completed["application"]["application_id"])

    def test_missing_selection_and_incomplete_bank_schedule_need_information(self):
        empty = self.action(self.create([]), "explorations", product_id="refinancing")
        self.assertFalse(empty["explorations"][-1]["result"]["options"])
        self.assertEqual(empty["explorations"][-1]["result"]["status"], "needs_information")
        record = self.create()
        process = self.client.app.state.process
        with process.store.connect(write=True) as connection:
            stored = process.store.get(connection, record["application"]["application_id"])
            for financials in (stored["application"]["financials"], stored["simulator"]["bank_financials"]):
                financials["existing_loans"][0]["schedule"] = []
            stored["simulator"]["known_loans"] = deepcopy(stored["application"]["financials"]["existing_loans"])
            process.store.save(connection, stored)
        result = self.action(record, "explorations", product_id="refinancing")["explorations"][-1]["result"]
        self.assertEqual(result["status"], "needs_information")
        self.assertFalse(result["options"])

    def test_assistant_refinancing_intent_opens_selection_without_asking_bank_amounts(self):
        from backend.assistant import AssistantReply
        class Assistant:
            mode, model = "model", "refinancing-contract"
            def reply(self, messages):
                return AssistantReply(text="Выберите кредиты в рабочей области.", intent="propose_changes",
                    changes={"need.purpose": "refinancing", "need.preferred_product": "refinancing"})
        self.client.app.state.chats.assistant = Assistant()
        view = self.client.post("/api/chats", json={}).json()
        path = "/api/chats/" + view["chat"]["chat_id"]
        response = self.client.post(path + "/messages", json={"base_chat_version": view["chat"]["chat_version"],
            "request_id": str(uuid4()), "text": "Хочу объединить действующие кредиты."})
        self.assertEqual(response.status_code, 200, response.text)
        view = response.json()
        proposal = view["chat"]["messages"][-1]["proposal"]
        response = self.client.post(path + "/proposals/" + proposal["proposal_id"] + "/confirm", json={
            "base_chat_version": view["chat"]["chat_version"], "confirmed": True})
        self.assertEqual(response.status_code, 200, response.text)
        view = response.json()
        self.assertIsNone(view["clarification"])
        self.assertEqual(view["record"]["application"]["need"]["preferred_product"], "refinancing")
        self.assertIsNone(view["record"]["application"]["need"]["requested_amount"])
        self.assertEqual(view["record"]["application"]["financials"], self.initial["financials"])
        record = view["record"]
        response = self.client.patch("/api/applications/" + record["application"]["application_id"], json={
            "base_application_version": record["application"]["application_version"],
            "changes": {"product_details.refinancing": {"loan_ids": ["existing-001"]}}})
        self.assertEqual(response.status_code, 200, response.text)
        record = self.action(response.json(), "explorations", product_id="refinancing")
        self.assertTrue(record["explorations"][-1]["result"]["options"])

    def test_restart_retains_replacement_and_no_cash_increase(self):
        completed = self.sign(self.ready(self.create()))
        original = self.client.get("/api/profile").json()
        with TestClient(create_app(self.path, clock=lambda: self.now)) as restarted:
            self.assertEqual(restarted.get("/api/profile").json(), original)
            request = restarted.post("/api/applications", json={}).json()
            self.assertEqual(request["application"]["financials"], original["financials"])
            self.assertEqual(request["application"]["financials"]["existing_loans"][0]["application_id"], completed["application"]["application_id"])

    def test_assistant_comparison_uses_payment_budget_and_includes_48_months(self):
        from backend.assistant import AssistantReply
        from backend.models import LoanPreferences
        class Assistant:
            mode, model = "model", "refinancing-comparison"
            def reply(self, messages):
                return AssistantReply(text="Сравним варианты с платежом до 30 тысяч.", intent="compare_options",
                    preferences=LoanPreferences(maximum_monthly_payment="30000.00"))
        self.client.app.state.chats.assistant = Assistant()
        record = self.create()
        view = self.client.post("/api/chats", json={"application_id": record["application"]["application_id"]}).json()
        response = self.client.post("/api/chats/" + view["chat"]["chat_id"] + "/messages", json={
            "base_chat_version": view["chat"]["chat_version"], "request_id": str(uuid4()),
            "text": "Сравни рефинансирование с платежом до 30 тысяч."})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()["record"]["explorations"][-1]["result"]
        self.assertEqual(result["preferences"]["maximum_monthly_payment"], "30000.00")
        self.assertEqual([option["term_months"] for option in result["options"]], [36, 48])
        self.assertEqual(response.json()["record"]["application"], record["application"])

    def test_impossible_payment_preference_is_not_reported_as_approval(self):
        view = self.action(self.create(), "explorations", product_id="refinancing", preferences={"maximum_monthly_payment": "10000.00"})
        result = view["explorations"][-1]["result"]
        self.assertFalse(result["options"])
        self.assertEqual(result["status"], "no_matching_options")
        self.assertEqual(result["reasons"][0]["code"], "preferences_exclude_options")
