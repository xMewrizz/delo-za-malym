from copy import deepcopy
from datetime import datetime, timedelta
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.assistant import AssistantReply
from backend.main import create_app
from backend.overdraft_chat import PLAN_PATH


class PlanAssistant:
    mode = "model"
    model = "test"

    def reply(self, messages):
        self.messages = messages
        return self.response


class OverdraftChatTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.now = datetime.fromisoformat("2026-10-21T15:00:00+03:00")
        self.assistant = PlanAssistant()
        self.app = create_app(Path(self.directory.name) / "chat.db", clock=lambda: self.now, assistant=self.assistant)
        self.client = TestClient(self.app).__enter__()
        self.view = self.client.post("/api/chats", json={}).json()
        self.path = "/api/chats/" + self.view["chat"]["chat_id"]
        self.app_path = "/api/applications/" + self.view["chat"]["application_id"]

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def send(self, update=None, text="План будущих операций", **reply):
        self.assistant.response = AssistantReply(text="Проверьте операции и подтвердите.", intent="propose_changes",
            overdraft_plan=update, **reply)
        response = self.client.post(self.path + "/messages", json={"base_chat_version": self.view["chat"]["chat_version"],
            "request_id": str(uuid4()), "text": text})
        self.assertEqual(response.status_code, 200, response.text)
        self.view = response.json()
        return self.proposal()

    def proposal(self):
        return next(message["proposal"] for message in reversed(self.view["chat"]["messages"])
                    if message.get("proposal") and message["proposal"]["status"] == "pending")

    def confirm(self):
        response = self.client.post(self.path + "/proposals/" + self.proposal()["proposal_id"] + "/confirm",
            json={"base_chat_version": self.view["chat"]["chat_version"], "confirmed": True})
        if response.status_code == 200:
            self.view = response.json()
        return response

    @staticmethod
    def operations(**extra):
        return {"transactions": [
            {"transaction_id": "purchase", "direction": "outflow", "amount": "450000.00", "date": "2026-10-22"},
            {"transaction_id": "customer", "direction": "inflow", "amount": "500000.00", "date": "2026-10-28"}], **extra}

    def test_plan_requires_debt_review_then_confirms_and_calculates_without_changing_bank_data(self):
        original = deepcopy(self.view["record"]["application"])
        proposal = self.send(self.operations(), "Завтра поставщику 450 тысяч, через неделю придут 500 тысяч")
        self.assertEqual(self.view["record"]["application"], original)
        self.assertEqual(proposal["changes"][PLAN_PATH]["opening_cash_balance"], original["financials"]["cash_balance"])
        self.assertTrue(proposal["plan_issues"])
        self.assertEqual(self.confirm().json()["detail"]["code"], "plan_incomplete")
        proposal = self.send({"debt_payments_confirmed": True}, "Платежей по текущим кредитам за этот период нет")
        self.assertEqual(proposal["plan_issues"], [])
        self.assertEqual(self.confirm().status_code, 200)
        record = self.view["record"]
        self.assertEqual(record["application"]["financials"], original["financials"])
        self.assertEqual(record["application"]["application_version"], 2)
        self.assertIsNone(record["application"]["need"]["requested_amount"])
        self.assertEqual(record["application"]["need"]["financing_pattern"], "cash_gap")
        self.assertNotIn("debt_payments_confirmed", record["application"]["product_details"]["overdraft"])
        result = record["explorations"][-1]["result"]
        self.assertEqual(result["status"], "options_ready")
        self.assertEqual(result["suggested_amount"], "150000.00")

    def test_live_preview_calculates_without_confirming_or_saving_application(self):
        proposal = self.send(self.operations())
        before = deepcopy(self.client.get(self.path).json())
        response = self.client.post(self.path + "/proposals/" + proposal["proposal_id"] + "/preview",
                                    json={"base_chat_version": self.view["chat"]["chat_version"]})
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertFalse(preview["confirmed"])
        self.assertTrue(preview["result"]["daily"])
        self.assertEqual(preview["result"]["suggested_amount"], "150000.00")
        self.assertEqual(preview["result"]["options"], [])
        self.assertTrue(preview["issues"])
        self.assertEqual(self.client.get(self.path).json(), before)

    def test_live_preview_can_show_options_after_clarification_but_keeps_progress_unconfirmed(self):
        proposal = self.send(self.operations(debt_payments_confirmed=True))
        before = deepcopy(self.view)
        path = self.path + "/proposals/" + proposal["proposal_id"] + "/preview"
        response = self.client.post(path, json={"base_chat_version": self.view["chat"]["chat_version"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["result"]["options"])
        self.assertEqual(self.client.get(self.path).json(), before)
        self.assertEqual(self.client.post(path, json={"base_chat_version": 1}).status_code, 409)
        self.confirm()
        self.assertEqual(self.client.post(path, json={"base_chat_version": self.view["chat"]["chat_version"]}).status_code, 409)

    def test_independent_drafts_and_transition_to_applications_after_selecting_conditions(self):
        second = self.client.post("/api/chats", json={}).json()
        self.assertNotEqual(second["chat"]["application_id"], self.view["chat"]["application_id"])
        proposal = self.send(self.operations(debt_payments_confirmed=True))
        self.assertEqual(self.client.get("/api/chats/" + second["chat"]["chat_id"]).json(), second)
        self.confirm()
        records = self.client.get("/api/applications").json()
        self.assertFalse(next(row for row in records if row["application_id"] == self.view["chat"]["application_id"])["ready_for_application"])
        record = self.view["record"]
        exploration = record["explorations"][-1]
        result = self.client.post(self.app_path + "/explorations/" + exploration["exploration_id"] + "/apply", json={
            "base_application_version": record["application"]["application_version"], "confirmed": True,
            "option_id": exploration["result"]["options"][0]["option_id"]})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(next(row for row in self.client.get("/api/applications").json() if row["application_id"] == self.view["chat"]["application_id"])["ready_for_application"])

    def test_partial_operations_and_corrections_accumulate_without_duplicates(self):
        self.send({"transactions": [{"transaction_id": "purchase", "direction": "outflow", "amount": "450000.00"}]})
        self.send({"transactions": [{"transaction_id": "customer", "direction": "inflow", "date": "2026-10-28"}]})
        proposal = self.send({"transactions": [{"transaction_id": "purchase", "date": "2026-10-22", "amount": "460000.00"},
            {"transaction_id": "customer", "amount": "500000.00"}], "debt_payments_confirmed": True})
        plan = proposal["changes"][PLAN_PATH]
        self.assertEqual(len(plan["transactions"]), 2)
        self.assertEqual(plan["transactions"][0]["direction"], "outflow")
        self.assertEqual(plan["transactions"][0]["amount"], "460000.00")
        self.assertEqual(proposal["plan_issues"], [])
        self.assertEqual(self.confirm().status_code, 200)

    def save_old_plan(self):
        old = {"start_date": "2026-11-02", "end_date": "2026-11-12", "opening_cash_balance": "300000.00",
               "cash_reserve": "0.00", "existing_debt_payments": [], "transactions": [
                   {"transaction_id": "old-expense", "direction": "outflow", "amount": "250000.00", "date": "2026-11-02"},
                   {"transaction_id": "old-receipt", "direction": "inflow", "amount": "200000.00", "date": "2026-11-12"}]}
        response = self.client.patch(self.app_path, json={"base_application_version": 1, "changes": {PLAN_PATH: old}})
        self.assertEqual(response.status_code, 200, response.text)
        self.view = self.client.get(self.path).json()
        return old

    def test_new_plan_does_not_silently_append_old_demo_rows_or_keep_future_period(self):
        old = self.save_old_plan()
        # Даже если провайдер пропустил mode, новый независимый список не дополняет старый.
        proposal = self.send(self.operations(debt_payments_confirmed=True))
        plan = proposal["changes"][PLAN_PATH]
        self.assertEqual([row["transaction_id"] for row in plan["transactions"]], ["purchase", "customer"])
        self.assertEqual((plan["start_date"], plan["end_date"]), ("2026-10-21", "2026-10-28"))
        self.assertEqual(proposal["plan_issues"], [])
        self.assertEqual(self.view["record"]["application"]["product_details"]["overdraft"], old)
        self.assertEqual(self.confirm().status_code, 200)
        self.assertEqual(len(self.view["record"]["application"]["product_details"]["overdraft"]["transactions"]), 2)
        self.assertEqual(self.view["record"]["explorations"][-1]["result"]["suggested_amount"], "150000.00")

    def test_explicit_addition_keeps_saved_rows_and_expands_period_for_earlier_expense(self):
        self.save_old_plan()
        proposal = self.send({"mode": "merge", "transactions": [self.operations()["transactions"][0]]})
        plan = proposal["changes"][PLAN_PATH]
        self.assertEqual(len(plan["transactions"]), 3)
        self.assertEqual(plan["start_date"], "2026-10-21")
        self.assertEqual(plan["end_date"], "2026-11-12")
        self.assertFalse(any("вне периода" in issue["message"] for issue in proposal["plan_issues"]))

    def test_editor_replaces_full_pending_list_without_leftover_rows_or_dates(self):
        self.save_old_plan()
        proposal = self.send(self.operations(mode="merge"))
        self.assertEqual(len(proposal["changes"][PLAN_PATH]["transactions"]), 4)
        response = self.client.post(self.path + "/proposals/" + proposal["proposal_id"] + "/edit", json={
            "base_chat_version": self.view["chat"]["chat_version"], "base_application_version": 2,
            "changes": {}, "overdraft_plan": self.operations(mode="replace", debt_payments_confirmed=True)})
        self.assertEqual(response.status_code, 200, response.text)
        self.view = response.json()
        self.assertEqual(len(self.proposal()["changes"][PLAN_PATH]["transactions"]), 2)
        self.assertEqual(self.proposal()["changes"][PLAN_PATH]["end_date"], "2026-10-28")
        self.assertIsNone(self.view["chat"]["messages"][-1]["question"])
        self.assertEqual(self.confirm().status_code, 200)

    def test_calculation_after_confirmation_uses_overdraft_without_explicit_product(self):
        self.send(self.operations(debt_payments_confirmed=True))
        self.assertEqual(self.confirm().status_code, 200)
        self.assertIsNone(self.view["record"]["application"]["need"]["preferred_product"])
        self.assistant.response = AssistantReply(text="Рассчитываю план.", intent="compare_options")
        response = self.client.post(self.path + "/messages", json={"base_chat_version": self.view["chat"]["chat_version"],
            "request_id": str(uuid4()), "text": "Рассчитай план ещё раз"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["record"]["explorations"][-1]["product_id"], "overdraft")

    def test_new_turn_compacts_old_plan_copies_and_preserves_pending_operations(self):
        self.send(self.operations())
        self.send({"transactions": [{"transaction_id": "purchase", "amount": "460000.00"}]})
        self.send({"debt_payments_confirmed": True})
        context = json.loads(self.assistant.messages[1]["content"].split("\n", 1)[1])
        proposals = context["previous_proposals"]
        self.assertNotIn(PLAN_PATH, proposals[0]["changes"])
        self.assertEqual(proposals[0]["previous_plan_operations"], 2)
        self.assertEqual(proposals[1]["changes"][PLAN_PATH]["transactions"][0]["amount"], "460000.00")

    def test_bare_question_does_not_cancel_plan_and_clock_uses_moscow(self):
        self.now = datetime.fromisoformat("2026-10-21T22:30:00+00:00")
        proposal = self.send({"transactions": [{"transaction_id": "purchase", "direction": "outflow", "amount": "450000.00"}]})
        context = json.loads(self.assistant.messages[1]["content"].split("\n", 1)[1])
        self.assertEqual(context["current_datetime"], "2026-10-22T01:30:00+03:00")
        self.assertEqual(context["timezone"], "Europe/Moscow")
        self.assistant.response = AssistantReply(text="Это будущий расход.", intent="answer_question")
        response = self.client.post(self.path + "/messages", json={"base_chat_version": self.view["chat"]["chat_version"],
            "request_id": str(uuid4()), "text": "Что это за операция?"})
        self.view = response.json()
        self.assertEqual(self.proposal()["proposal_id"], proposal["proposal_id"])

    def test_manual_plan_conflict_blocks_confirmation_until_reviewed(self):
        proposal = self.send(self.operations(debt_payments_confirmed=True))
        edited_plan = deepcopy(proposal["changes"][PLAN_PATH])
        edited_plan.pop("debt_payments_confirmed")
        edited_plan["transactions"][0]["amount"] = "480000.00"
        response = self.client.patch(self.app_path, json={"base_application_version": 1,
            "changes": {"product_details.overdraft": edited_plan}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.confirm().status_code, 409)
        current = self.client.get(self.app_path).json()
        self.assertEqual(current["application"]["product_details"]["overdraft"], edited_plan)
        self.assertEqual(self.view["record"]["application"]["application_version"], 1)

    def test_unrelated_form_edit_does_not_block_plan_confirmation(self):
        self.send(self.operations(debt_payments_confirmed=True))
        response = self.client.patch(self.app_path, json={"base_application_version": 1,"changes": {"need.recurring": False}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.confirm().status_code, 200)
        self.assertFalse(self.view["record"]["application"]["need"]["recurring"])

    def test_card_edits_remove_operation_and_credit_payment_is_counted_once(self):
        loan = self.view["record"]["application"]["financials"]["existing_loans"][0]
        proposal = self.send(self.operations())
        response = self.client.post(self.path + "/proposals/" + proposal["proposal_id"] + "/edit", json={
            "base_chat_version": self.view["chat"]["chat_version"], "base_application_version": 1,
            "changes": {key: value for key, value in proposal["changes"].items() if key != PLAN_PATH},
            "overdraft_plan": {"transactions": [{"transaction_id": "debt", "direction": "outflow", "date": "2026-10-25",
                "amount": loan["monthly_payment"], "loan_id": loan["loan_id"]}], "debt_payments_confirmed": True}})
        self.assertEqual(response.status_code, 200, response.text)
        self.view = response.json()
        self.assertEqual(self.confirm().status_code, 200)
        plan = self.view["record"]["application"]["product_details"]["overdraft"]
        self.assertEqual(len(plan["transactions"]), 3)
        self.assertEqual(len(plan["existing_debt_payments"]), 1)
        result = self.view["record"]["explorations"][-1]["result"]
        self.assertEqual(sum(float(day["outflow"]) for day in result["daily"]), 485000.0)

    def test_model_cannot_supply_bank_balance_or_arbitrary_product_details(self):
        for reply in ({"overdraft_plan": {"opening_cash_balance": "99999999.00"}},
                      {"changes": {"product_details.overdraft": {"transactions": []}}},
                      {"overdraft_plan": {"transactions": [{"transaction_id": "x", "amount": "-1.00"}]}}):
            with self.subTest(reply=reply):
                self.assistant.response = {"text": "Подтвердите", "intent": "propose_changes", **reply}
                response = self.client.post(self.path + "/messages", json={"base_chat_version": 1,
                    "request_id": str(uuid4()), "text": "Данные"})
                self.assertEqual(response.status_code, 503, response.text)
                self.assertEqual(self.client.get(self.path).json()["chat"]["messages"], [])

    def test_reserve_change_cannot_implicitly_confirm_unknown_debt_payments(self):
        self.send(self.operations())
        proposal = self.send({"cash_reserve": "10000.00"})
        self.assertFalse(proposal["changes"][PLAN_PATH]["debt_payments_confirmed"])
        self.assertEqual(self.confirm().status_code, 422)

    def test_explicit_rejection_and_plan_removal_do_not_change_application(self):
        original = deepcopy(self.view["record"]["application"])
        proposal = self.send(self.operations(debt_payments_confirmed=True))
        response = self.client.post(self.path + "/proposals/" + proposal["proposal_id"] + "/edit", json={
            "base_chat_version": self.view["chat"]["chat_version"], "base_application_version": 1,
            "changes": {}, "remove_overdraft_plan": True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["chat"]["messages"][-1]["proposal"]["status"], "rejected")
        self.assertEqual(response.json()["record"]["application"], original)

    def test_incomplete_plan_stays_pending_after_server_restart(self):
        proposal = self.send({"transactions": [{"transaction_id": "purchase", "direction": "outflow", "amount": "450000.00"}]})
        self.assertTrue(proposal["plan_issues"])
        with TestClient(create_app(Path(self.directory.name) / "chat.db", clock=lambda: self.now, assistant=self.assistant)) as restarted:
            restored = restarted.get(self.path).json()
            self.assertEqual(restored, self.view)


if __name__ == "__main__":
    unittest.main()
