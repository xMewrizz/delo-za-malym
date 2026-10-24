from copy import deepcopy
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4
import unittest

from fastapi.testclient import TestClient
from backend.main import create_app
from backend import demo
from backend.assistant import FactsExtractionReply
from pydantic import ValidationError
from credit_engine.investment import assess_investment
from credit_engine.loans import calculate_loan


class InvestmentTests(unittest.TestCase):
    def test_nested_model_need_is_normalized_but_bank_fields_are_rejected(self):
        response = FactsExtractionReply.model_validate({"changes": {"need": {"project_cost": "1000000.00", "principal_grace_months": 3}}})
        self.assertEqual(response.changes, {"need.project_cost": "1000000.00", "need.principal_grace_months": 3})
        response = FactsExtractionReply.model_validate({"changes": {"minimum_acceptable_amount": "400000.00"}})
        self.assertEqual(response.changes, {"need.minimum_acceptable_amount": "400000.00"})
        for changes in ({"need": {"financials.cash_balance": "99999999.00"}}, {"financials": {"cash_balance": "99999999.00"}},
                        {"need": {"project_cost": "1000000.00"}, "need.project_cost": "900000.00"}):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                FactsExtractionReply.model_validate({"changes": changes})

    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.now = datetime.fromisoformat("2026-10-23T12:00:00+03:00")
        self.app = create_app(Path(directory.name) / "investment.sqlite3", clock=lambda: self.now)
        self.client = TestClient(self.app).__enter__()
        self.addCleanup(lambda: self.client.__exit__(None, None, None))

    def create(self, **need):
        body = {"purpose": "investment", "preferred_product": "investment_loan", "project_cost": "1000000.00",
                "own_funds": "200000.00", "principal_grace_months": 3, "term_months": 36, **need}
        response = self.client.post("/api/applications", json={"need": body})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def action(self, view, path, **body):
        response = self.client.post("/api/applications/" + view["application"]["application_id"] + "/" + path,
            json={"base_application_version": view["application"]["application_version"], **body})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_grace_interest_and_principal_reconcile_to_the_cent(self):
        calc = calculate_loan("800000.00", 36, "18.00", principal_grace_months=3).to_dict()["calculation"]
        rows = calc["schedule"]
        self.assertEqual(len(rows), 36)
        self.assertTrue(all(row["principal_payment"] == "0.00" and row["total_payment"] == "12000.00" for row in rows[:3]))
        self.assertEqual(rows[3]["opening_balance"], "800000.00")
        self.assertEqual(rows[-1]["closing_balance"], "0.00")
        self.assertEqual(sum(Decimal(row["principal_payment"]) for row in rows), Decimal("800000.00"))
        self.assertEqual(sum(Decimal(row["total_payment"]) for row in rows), Decimal(calc["total_repayment"]))
        without = calculate_loan("800000.00", 36, "18.00").to_dict()["calculation"]
        self.assertGreater(Decimal(calc["maximum_payment"]), Decimal(without["maximum_payment"]))
        self.assertGreater(Decimal(calc["total_interest"]), Decimal(without["total_interest"]))
        zero = calculate_loan("800000.00", 36, "0.00", principal_grace_months=6).to_dict()["calculation"]
        self.assertEqual(zero["total_repayment"], "800000.00")
        self.assertTrue(all(row["total_payment"] == "0.00" for row in zero["schedule"][:6]))

    def test_invalid_grace_is_rejected(self):
        for grace in (-1, 12, 13, True, "3"):
            with self.subTest(grace=grace):
                self.assertEqual(calculate_loan("100000.00", 12, "18.00", principal_grace_months=grace).status, "invalid_data")

    def test_amount_is_derived_and_options_cover_the_whole_project(self):
        view = self.create(requested_amount="999999.00")
        self.assertEqual(view["application"]["need"]["requested_amount"], "800000.00")
        view = self.action(view, "explorations", product_id="investment_loan")
        options = view["explorations"][-1]["result"]["options"]
        self.assertGreaterEqual(len(options), 2)
        for offer in options:
            self.assertEqual(offer["amount"], "800000.00")
            self.assertEqual(offer["product_id"], "investment_loan")
            self.assertEqual(len(offer["schedule"]), offer["term_months"])
            self.assertEqual(Decimal(offer["monthly_payment"]), max(Decimal(row["total_payment"]) for row in offer["schedule"]))

    def test_missing_project_or_small_contribution_requests_specific_information(self):
        for changes, field in (({"project_cost": None}, "need.project_cost"), ({"own_funds": "100000.00"}, "need.own_funds"),
                               ({"principal_grace_months": None}, "need.principal_grace_months"), ({"own_funds": "1000000.00"}, "need.own_funds")):
            with self.subTest(changes=changes):
                view = self.action(self.create(**changes), "explorations", product_id="investment_loan")
                result = view["explorations"][-1]["result"]
                self.assertEqual(result["status"], "needs_information")
                self.assertEqual(result["options"], [])
                self.assertIn(field, [item["field"] for item in result["required_information"]])

    def test_underwriting_checks_payment_after_grace_not_interest_only(self):
        view = self.create(project_cost="5000000.00", own_funds="1000000.00", principal_grace_months=6, term_months=60)
        app = view["application"]
        _, simulator = demo.profile(self.now)
        checks = demo.simulate_checks(app, simulator, self.now)
        result = assess_investment(app, checks, calculated_at=self.now, stage="preliminary", seasonal=True).to_dict()
        # Проценты укладываются в доступную нагрузку, платёж после отсрочки — нет.
        self.assertLess(Decimal("60000"), Decimal(result["financial_metrics"]["available_monthly_payment"]))
        self.assertEqual(result["assessment"]["offers"], [])
        self.assertEqual(result["assessment"]["required_information"][0]["field"], "need.own_funds")

    def test_minimum_contribution_rounds_up_to_an_achievable_kopeck(self):
        view = self.action(self.create(project_cost="1000000.01"), "explorations", product_id="investment_loan")
        question = view["explorations"][-1]["result"]["required_information"][0]
        self.assertIn("200000.01", question["question"])
        view = self.action(self.create(project_cost="1000000.01", own_funds="200000.01"), "explorations", product_id="investment_loan")
        self.assertTrue(view["explorations"][-1]["result"]["options"])

    def test_issue_schedule_calendar_and_next_application_use_same_debt(self):
        view = self.action(self.create(), "submit", confirmed=True)
        assessment = view["result"]["assessment"]
        offer = assessment["offers"][0]
        self.assertEqual(offer["product_id"], "investment_loan")
        view = self.action(view, "select-offer", assessment_id=assessment["assessment_id"], offer_id=offer["offer_id"])
        view = self.action(view, "sign", confirmed=True, offer_id=offer["offer_id"])
        self.assertEqual(view["state"]["status"], "disbursed")
        self.assertEqual(view["completion"]["schedule"], offer["schedule"])
        profile = self.client.get("/api/profile").json()["financials"]
        self.assertEqual(profile["cash_balance"], "1100000.00")
        loan = next(item for item in profile["existing_loans"] if item.get("application_id") == view["application"]["application_id"])
        self.assertEqual(loan["outstanding_principal"], "800000.00")
        self.assertEqual(loan["monthly_payment"], offer["monthly_payment"])
        self.assertEqual(loan["schedule"], offer["schedule"])
        calendar = [row for row in self.client.get("/api/calendar").json()["events"] if row["application_id"] == view["application"]["application_id"] and row["direction"] == "outflow"]
        self.assertEqual(len(calendar), offer["term_months"])
        self.assertEqual(calendar[0]["amount"], "12000.00")
        next_view = self.create(project_cost="250000.00", own_funds="50000.00")
        self.assertIn(loan["loan_id"], [item["loan_id"] for item in next_view["application"]["financials"]["existing_loans"]])

    def test_payment_filter_does_not_change_project_or_hide_reason(self):
        view = self.create()
        original = deepcopy(view["application"]["need"])
        view = self.action(view, "explorations", product_id="investment_loan", preferences={"maximum_monthly_payment": "100.00"})
        self.assertEqual(view["explorations"][-1]["result"]["status"], "no_matching_options")
        self.assertEqual(view["application"]["need"], original)
        response = self.client.post("/api/applications/" + view["application"]["application_id"] + "/explorations",
            json={"base_application_version": 1, "product_id": "investment_loan", "preferences": {"requested_amount": "100000.00"}})
        self.assertEqual(response.status_code, 422)

    def test_short_chat_cards_collect_project_and_confirmation_runs_engine(self):
        view = self.create(project_cost=None, own_funds=None, principal_grace_months=None)
        chat = self.client.post("/api/chats", json={"application_id": view["application"]["application_id"]}).json()
        path = "/api/chats/" + chat["chat"]["chat_id"]
        for field, answer in (("need.project_cost", {"value": "1000000"}), ("need.own_funds", {"value": "200000"}),
                              ("need.principal_grace_months", {"choice_id": "three"})):
            self.assertEqual(chat["clarification"]["field"], field)
            response = self.client.post(path + "/clarifications/" + chat["clarification"]["question_id"] + "/answer", json={
                "base_chat_version": chat["chat"]["chat_version"], "base_application_version": chat["record"]["application"]["application_version"],
                "request_id": str(uuid4()), **answer})
            self.assertEqual(response.status_code, 200, response.text)
            chat = response.json()
        self.assertIsNone(chat["clarification"])
        proposal = chat["chat"]["messages"][-1]["proposal"]
        response = self.client.post(path + "/proposals/" + proposal["proposal_id"] + "/confirm",
            json={"base_chat_version": chat["chat"]["chat_version"], "confirmed": True})
        self.assertEqual(response.status_code, 200, response.text)
        record = response.json()["record"]
        self.assertEqual(record["application"]["need"]["requested_amount"], "800000.00")
        self.assertTrue(record["explorations"][-1]["result"]["options"])
        self.assertEqual(record["application"]["financials"], view["application"]["financials"])

    def test_invoice_cost_conflict_requires_confirmation_and_recalculates_loan(self):
        view = self.create()
        path = "/api/applications/" + view["application"]["application_id"]
        uploaded = self.client.post(path + "/documents", params={"filename": "equipment.pdf", "base_application_version": 1},
            content=Path("contracts/documents/supplier-invoice.pdf").read_bytes(), headers={"Content-Type": "application/pdf"})
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        document = uploaded.json()["documents"][0]
        body = {"base_application_version": 1, "document_revision": document["revision"], "confirmed": True,
                "target": "project_cost", "amount": "450000.00"}
        url = path + "/documents/" + document["document_id"] + "/use"
        self.assertEqual(self.client.post(url, json=body).status_code, 409)
        response = self.client.post(url, json={**body, "replace_existing": True})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["application"]["need"]["requested_amount"], "250000.00")
        self.assertEqual(result["field_sources"]["need.project_cost"]["original"]["page"], 1)
        self.assertEqual(result["application"]["financials"], view["application"]["financials"])
