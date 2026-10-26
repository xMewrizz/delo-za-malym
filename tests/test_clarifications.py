from copy import deepcopy
from datetime import datetime
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4
from unittest.mock import Mock, patch
from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.assistant import AssistantReply, ModelAssistant, build_messages
from backend.main import create_app
from backend.overdraft_chat import PLAN_PATH
from scr.delo_za_malyn.Models.Llm.client import Reply


class UnavailableModel:
    mode = "model"
    model = "unavailable"

    def reply(self, messages):
        raise AssertionError("Готовые ответы не должны вызывать модель")


class ClarificationTests(unittest.TestCase):
    def setUp(self):
        from backend import demo
        original_profile = demo.profile
        fixture = patch("backend.demo.profile", side_effect=lambda now: original_profile(now, include_sample_loan=True))
        fixture.start()
        self.addCleanup(fixture.stop)
        self.directory = TemporaryDirectory()
        self.now = datetime.fromisoformat("2026-10-21T22:30:00+00:00")  # В Москве уже 22 октября.
        self.database = Path(self.directory.name) / "test.db"
        self.app = create_app(self.database, clock=lambda: self.now, assistant=UnavailableModel())
        self.client = TestClient(self.app).__enter__()
        self.view = self.client.post("/api/chats", json={}).json()
        self.path = "/api/chats/" + self.view["chat"]["chat_id"]
        self.app_path = "/api/applications/" + self.view["chat"]["application_id"]

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def answer(self, choice=None, value=None, *, expected=200):
        card = self.view["clarification"]
        self.last_body = {"request_id": str(uuid4()), "base_chat_version": self.view["chat"]["chat_version"],
                          "base_application_version": self.view["record"]["application"]["application_version"],
                          **({"choice_id": choice} if choice else {"value": value})}
        self.last_path = self.path + "/clarifications/" + card["question_id"] + "/answer"
        response = self.client.post(self.last_path, json=self.last_body)
        self.assertEqual(response.status_code, expected, response.text)
        if response.status_code == 200:
            self.view = response.json()
        return response

    def pending(self):
        return next(m["proposal"] for m in reversed(self.view["chat"]["messages"]) if (m.get("proposal") or {}).get("status") == "pending")

    def start_plan(self):
        self.answer("cash_gap")
        self.answer(value="450 000,00")
        self.answer("tomorrow")
        self.answer(value="500000")
        self.answer("week")

    def named_need(self, plan=None):
        self.app.state.chats.assistant = SimpleNamespace(mode="model", model="test", reply=lambda messages: AssistantReply(
            text="Учла потребность в 50 000 ₽.", intent="propose_changes",
            changes={"need.purpose": "working_capital", "need.requested_amount": "50000.00"},
            overdraft_plan=plan))
        response = self.client.post(self.path + "/messages", json={
            "base_chat_version": self.view["chat"]["chat_version"], "request_id": str(uuid4()),
            "text": "Надо закрыть кассовую яму в 50 000 р"})
        self.assertEqual(response.status_code, 200, response.text)
        self.view = response.json()

    def test_named_financing_amount_can_be_reused_as_payment_without_retyping_or_inventing_expense(self):
        self.named_need()
        self.answer("receipt")
        card = self.view["clarification"]
        self.assertIn("50 000 ₽", card["description"])
        self.assertIn("300 000 ₽", card["description"])
        self.assertEqual(card["input_label"], "Предстоящие расходы, ₽")
        self.assertNotIn(PLAN_PATH, self.pending()["changes"])
        self.answer("use_known_amount")
        operations = self.pending()["changes"][PLAN_PATH]["transactions"]
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0]["amount"], "50000.00")
        self.assertIsNone(operations[0]["date"])
        self.assertEqual(self.view["clarification"]["field"], PLAN_PATH + ".date")
        self.assertIn("50 000 ₽", self.view["clarification"]["title"])
        self.assertEqual(self.client.post(self.last_path, json=self.last_body).json(), self.view)
        self.assertEqual(self.view["record"]["application"]["financials"]["cash_balance"], "300000.00")
        self.assertIsNone(self.view["record"]["application"]["need"]["requested_amount"])
        self.assertEqual(self.view["chat"]["messages"][-1]["text"], self.view["clarification"]["title"])

    def test_full_payment_can_differ_from_financing_amount_without_overwriting_it(self):
        self.named_need()
        self.answer("receipt")
        self.answer(value="350000")
        self.assertEqual(self.pending()["changes"]["need.requested_amount"], "50000.00")
        self.assertEqual(self.pending()["changes"][PLAN_PATH]["transactions"][0]["amount"], "350000.00")

    def test_cash_covers_named_payment_so_no_unnecessary_repayment_question_or_credit(self):
        self.named_need()
        self.answer("receipt")
        self.answer("use_known_amount")
        self.answer("tomorrow")
        self.assertEqual(self.view["clarification"]["field"], PLAN_PATH + ".existing_debt_payments")
        self.answer("debt_reviewed")
        self.assertIsNone(self.view["clarification"])
        self.assertEqual(self.pending()["plan_issues"], [])
        response = self.client.post(self.path + "/proposals/" + self.pending()["proposal_id"] + "/confirm", json={
            "base_chat_version": self.view["chat"]["chat_version"], "confirmed": True})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()["record"]["explorations"][-1]["result"]
        self.assertEqual(result["calculation"]["required_limit"], "0.00")
        self.assertEqual(result["options"], [])

    def test_real_shortfall_or_explicit_cash_reserve_still_requires_repayment_inflow(self):
        for amount, reserve in (("350000.00", None), ("50000.00", "280000.00")):
            with self.subTest(amount=amount, reserve=reserve):
                self.view = self.client.post("/api/chats", json={}).json()
                self.path = "/api/chats/" + self.view["chat"]["chat_id"]
                plan = {"transactions": [{"transaction_id": "payment", "direction": "outflow", "amount": amount, "date": "2026-10-23"}]}
                if reserve is not None:
                    plan["cash_reserve"] = reserve
                self.named_need(plan)
                self.assertEqual(self.view["clarification"]["field"], PLAN_PATH + ".new_operation")
                self.assertEqual(self.view["clarification"]["direction"], "inflow")

    def test_known_operation_amount_skips_amount_question_and_partial_operation_is_updated_in_place(self):
        for amount in ("50000.00", None):
            with self.subTest(amount=amount):
                self.view = self.client.post("/api/chats", json={}).json()
                self.path = "/api/chats/" + self.view["chat"]["chat_id"]
                self.named_need({"transactions": [{"transaction_id": "supplier", "direction": "outflow", "amount": amount}]})
                if amount is None:
                    self.answer("use_known_amount")
                self.assertEqual(self.view["clarification"]["field"], PLAN_PATH + ".date")
                self.assertEqual(self.view["clarification"]["transaction_id"], "supplier")
                self.assertEqual(len(self.pending()["changes"][PLAN_PATH]["transactions"]), 1)

    def test_loan_cards_skip_known_values_and_produce_real_options_without_model(self):
        original = deepcopy(self.view["record"]["application"])
        self.assertEqual(self.view["clarification"]["field"], "need.purpose")
        self.answer("purchase")
        self.assertEqual(self.view["clarification"]["field"], "need.financing_pattern")
        self.answer("gradual")
        self.assertEqual(self.view["clarification"]["field"], "need.requested_amount")
        self.answer(value="500 000,00")
        self.assertEqual(self.view["clarification"]["field"], "need.term_months")
        self.answer("compare_terms")
        self.assertIsNone(self.view["clarification"])
        self.assertEqual(self.view["record"]["application"], original)
        self.assertEqual(self.pending()["changes"]["need.requested_amount"], "500000.00")
        response = self.client.post(self.path + "/proposals/" + self.pending()["proposal_id"] + "/confirm", json={
            "base_chat_version": self.view["chat"]["chat_version"], "confirmed": True})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertTrue(result["record"]["explorations"][-1]["result"]["options"])
        self.assertEqual(result["record"]["application"]["financials"], original["financials"])
        self.assertIsNone(result["clarification"])

    def test_question_and_form_stay_in_sync_and_every_answer_has_a_next_step(self):
        for trial in range(3):
            with self.subTest(trial=trial):
                self.view = self.client.post("/api/chats", json={}).json()
                self.path = "/api/chats/" + self.view["chat"]["chat_id"]
                self.app.state.chats.assistant = SimpleNamespace(mode="model", model="test", reply=lambda messages: AssistantReply(
                    text="Поняла. На какой срок нужны 300 000 рублей?", intent="propose_changes",
                    question="На какой срок нужны 300 000 рублей?",
                    changes={"need.purpose": "working_capital", "need.requested_amount": "300000.00"}))
                response = self.client.post(self.path + "/messages", json={
                    "base_chat_version": self.view["chat"]["chat_version"], "request_id": str(uuid4()), "text": "Оборотные средства, 300 тысяч"})
                self.assertEqual(response.status_code, 200, response.text)
                self.view = response.json()
                self.assertEqual(self.view["clarification"]["field"], "need.financing_pattern")
                message = self.view["chat"]["messages"][-1]
                self.assertEqual(message["question"], self.view["clarification"]["title"])
                self.assertIn(message["question"], message["text"])
                self.assertNotIn("На какой срок", message["text"])
                self.answer("gradual")
                self.assertEqual(self.view["clarification"]["field"], "need.term_months")
                self.assertEqual(self.view["chat"]["messages"][-2]["role"], "user")
                self.assertEqual(self.view["chat"]["messages"][-2]["text"], "Постепенно из выручки")
                self.assertEqual(self.view["chat"]["messages"][-1]["text"], self.view["clarification"]["title"])
                self.answer("12")
                self.assertIsNone(self.view["clarification"])
                self.assertEqual(self.pending()["changes"]["need.term_months"], 12)
                self.assertIn("подтвердите", self.view["chat"]["messages"][-1]["text"])
                self.assertIsNone(self.view["record"]["application"]["need"]["requested_amount"])
                self.assertEqual(self.client.get(self.path).json(), self.view)

    def test_optional_term_comparison_does_not_invent_a_term_or_repeat_after_reload(self):
        self.named_need()
        self.answer("gradual")
        self.assertEqual(self.view["clarification"]["field"], "need.term_months")
        self.answer("compare_terms")
        self.assertIsNone(self.view["clarification"])
        self.assertNotIn("need.term_months", self.pending()["changes"])
        self.assertIsNone(self.client.get(self.path).json()["clarification"])
        self.assertEqual(self.client.post(self.last_path, json=self.last_body).json(), self.view)

    def test_operation_questions_target_each_row_and_dates_use_moscow(self):
        original = deepcopy(self.view["record"]["application"])
        self.start_plan()
        plan = self.pending()["changes"][PLAN_PATH]
        self.assertEqual(len(plan["transactions"]), 2)
        self.assertEqual([(row["amount"], row["date"]) for row in plan["transactions"]],
                         [("450000.00", "2026-10-23"), ("500000.00", "2026-10-29")])
        self.assertEqual(self.view["clarification"]["field"], PLAN_PATH + ".existing_debt_payments")
        self.answer("debt_reviewed")
        self.assertIsNone(self.view["clarification"])
        self.assertTrue(self.pending()["changes"][PLAN_PATH]["debt_payments_confirmed"])
        self.assertEqual(self.view["record"]["application"], original)

    def test_known_loan_payment_is_inserted_once_with_unknown_date(self):
        self.start_plan()
        self.answer("loan_1")
        plan = self.pending()["changes"][PLAN_PATH]
        self.assertEqual(len(plan["transactions"]), 3)
        self.assertIsNone(plan["transactions"][-1]["date"])
        self.assertEqual(plan["transactions"][-1]["amount"], "35000.00")
        self.assertEqual(self.view["clarification"]["transaction_id"], plan["transactions"][-1]["transaction_id"])
        self.answer("today")
        self.answer("debt_reviewed")
        plan = self.pending()["changes"][PLAN_PATH]
        self.assertEqual(len(plan["existing_debt_payments"]), 1)
        self.assertEqual(plan["transactions"][0]["date"], "2026-10-23")
        self.assertEqual(sum(float(row["amount"]) for row in plan["transactions"] if row["direction"] == "outflow"), 485000)

    def test_replay_is_idempotent_and_reused_id_with_different_value_is_rejected(self):
        self.answer("purchase")
        before = deepcopy(self.view)
        self.assertEqual(self.client.post(self.last_path, json=self.last_body).json(), before)
        self.assertEqual(self.client.post(self.last_path, json={**self.last_body, "choice_id": "other"}).status_code, 409)
        self.assertEqual(len(self.client.get(self.path).json()["chat"]["messages"]), 2)

    def test_stale_card_and_stale_application_cannot_change_progress(self):
        old = deepcopy(self.view)
        self.answer("purchase")
        response = self.client.post(self.path + "/clarifications/" + old["clarification"]["question_id"] + "/answer", json={
            **self.last_body, "request_id": str(uuid4()), "base_chat_version": self.view["chat"]["chat_version"]})
        self.assertEqual(response.status_code, 409)
        self.client.patch(self.app_path, json={"base_application_version": 1, "changes": {"need.recurring": True}})
        self.answer("gradual", expected=409)
        self.assertEqual(self.client.get(self.path).json()["chat"]["messages"], self.view["chat"]["messages"])

    def test_invalid_money_dates_and_choice_do_not_create_messages(self):
        self.answer("purchase")
        self.answer("gradual")
        before = deepcopy(self.view)
        for value in ["0", "-1", "NaN", "1000000000000", "500.123", "пятьсот"]:
            self.answer(value=value, expected=422)
        self.answer("invented", expected=422)
        self.assertEqual(self.client.get(self.path).json(), before)
        self.answer(value="500000")
        # У готового ответа нет возможности поменять финансовые данные.
        response = self.client.post(self.last_path, json={**self.last_body, "financials": {"cash_balance": "9999999.00"}})
        self.assertEqual(response.status_code, 422)

    def test_card_restarts_and_short_free_text_has_explicit_question_context(self):
        self.answer("cash_gap")
        self.answer(value="450000")
        before = deepcopy(self.view)
        with TestClient(create_app(self.database, clock=lambda: self.now, assistant=UnavailableModel())) as restarted:
            self.assertEqual(restarted.get(self.path).json(), before)
        with self.app.state.chats.store.connect() as connection:
            record = self.app.state.chats.store.get(connection, self.view["chat"]["application_id"])
        messages = build_messages(self.view["chat"], record, "завтра", [], now=self.now)
        context = json.loads(messages[1]["content"].split("\n", 1)[1])
        self.assertEqual(context["clarification"]["transaction_id"], self.view["clarification"]["transaction_id"])
        self.assertIn("Ответ на вопрос", messages[4]["content"])
        self.assertEqual(messages[-1]["content"], "завтра")

    def test_invalid_dates_do_not_modify_pending_operations(self):
        self.answer("cash_gap")
        self.answer(value="450000")
        before = deepcopy(self.view)
        for value in ["2026-10-21", "2026-02-30", "2028-01-01", "завтра", "2026-1-2"]:
            self.answer(value=value, expected=422)
        self.assertEqual(self.client.get(self.path).json(), before)

    def test_free_text_fills_target_date_without_replacing_known_amount_or_generating_card(self):
        self.answer("cash_gap")
        self.answer(value="450000")
        target = self.view["clarification"]["transaction_id"]
        original = deepcopy(self.view["record"]["application"])
        with patch.dict(os.environ, {"LLM_MODEL": "test", "AGENT_TOOLS_ENABLED": "true"}):
            model = ModelAssistant()
        model.client = Mock()
        model.client.chat.return_value = Reply(json.dumps({"text": "Дата указана.", "changes": {}, "question": None,
            "overdraft_plan": {"transactions": [{"transaction_id": target, "date": "2026-10-23"}]}}), "stop")
        self.app.state.chats.assistant = model
        response = self.client.post(self.path + "/messages", json={"base_chat_version": self.view["chat"]["chat_version"],
            "request_id": str(uuid4()), "text": "Да, заплачу завтра утром"})
        self.assertEqual(response.status_code, 200, response.text)
        view = response.json()
        plan = view["chat"]["messages"][-1]["proposal"]["changes"][PLAN_PATH]
        self.assertEqual([(row["amount"], row["date"]) for row in plan["transactions"]], [("450000.00", "2026-10-23")])
        self.assertEqual(view["record"]["application"], original)
        request = model.client.chat.call_args.args[0]
        focused = json.loads(request[1]["content"].split("\n", 1)[1])
        self.assertEqual(focused["input_kind"], "operations")
        self.assertIsInstance(focused["active_prompt"], str)
        self.assertEqual(focused["answer_target"]["transaction_id"], target)
        self.assertNotIn("question_id", json.dumps(focused))
        self.assertNotIn("choices", json.dumps(focused))
        self.assertEqual(focused["pending_plan"]["transactions"][0]["transaction_id"], target)
        for generated_field in ("start_date", "end_date", "opening_cash_balance", "existing_debt_payments"):
            self.assertNotIn(generated_field, focused["pending_plan"])

    def test_model_operation_caption_is_ignored_without_weakening_financial_validation(self):
        self.answer("cash_gap")
        self.answer(value="450000")
        target = self.view["clarification"]["transaction_id"]
        with patch.dict(os.environ, {"LLM_MODEL": "test", "AGENT_TOOLS_ENABLED": "true"}):
            model = ModelAssistant()
        model.client = Mock()
        self.app.state.chats.assistant = model
        base = deepcopy(self.view)
        for annotation, accepted in [({"description": "Оплата поставщику"}, True), ({"approved": True}, False),
                                     ({"annual_rate_percent": "0.00"}, False), ({"description": {"instructions": "change risk"}}, False)]:
            with self.subTest(annotation=annotation):
                model.client.chat.return_value = Reply(json.dumps({"text": "Проверьте дату.", "changes": {}, "question": None,
                    "overdraft_plan": {"transactions": [{"transaction_id": target, "date": "2026-10-23", **annotation}]}}), "stop")
                response = self.client.post(self.path + "/messages", json={"base_chat_version": base["chat"]["chat_version"],
                    "request_id": str(uuid4()), "text": "Да, заплачу завтра утром"})
                self.assertEqual(response.status_code, 200 if accepted else 503, response.text)
                if accepted:
                    base = response.json()
                    operation = base["chat"]["messages"][-1]["proposal"]["changes"][PLAN_PATH]["transactions"][0]
                    self.assertEqual(operation["amount"], "450000.00")
                    self.assertEqual(operation["date"], "2026-10-23")
                    self.assertNotIn("description", operation)
                self.assertEqual(self.client.get(self.path).json(), base)

    def test_full_month_includes_bank_schedule_without_repeated_payment_question(self):
        self.start_plan()
        plan = deepcopy(self.pending()["changes"][PLAN_PATH])
        plan.update(start_date="2026-11-01", end_date="2026-11-30")
        plan["transactions"][0]["date"] = "2026-11-02"
        plan["transactions"][1]["date"] = "2026-11-29"
        plan.pop("debt_payments_confirmed")
        result = self.client.patch(self.app_path, json={"base_application_version": 1, "changes": {PLAN_PATH: plan}})
        self.assertEqual(result.status_code, 200)
        # Сохраняем отдельный актуальный диалог над этим планом.
        self.view = self.client.post("/api/chats", json={"application_id": self.view["chat"]["application_id"]}).json()
        self.path = "/api/chats/" + self.view["chat"]["chat_id"]
        self.assertIsNone(self.view["clarification"])
        saved = self.view["record"]["application"]["product_details"]["overdraft"]
        bank_payments = [row for row in saved["transactions"] if row["transaction_id"].startswith("bank-payment:")]
        self.assertEqual(len(bank_payments), 1)
        self.assertEqual(bank_payments[0]["date"], "2026-11-15")
        self.assertEqual(bank_payments[0]["amount"], "35000.00")


if __name__ == "__main__":
    unittest.main()
