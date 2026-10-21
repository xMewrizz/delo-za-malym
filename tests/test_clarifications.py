from copy import deepcopy
from datetime import datetime
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from backend.assistant import ModelAssistant, build_messages
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

    def test_loan_cards_skip_known_values_and_produce_real_options_without_model(self):
        original = deepcopy(self.view["record"]["application"])
        self.assertEqual(self.view["clarification"]["field"], "need.purpose")
        self.answer("purchase")
        self.assertEqual(self.view["clarification"]["field"], "need.financing_pattern")
        self.answer("gradual")
        self.assertEqual(self.view["clarification"]["field"], "need.requested_amount")
        self.answer(value="500 000,00")
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
        self.assertIsInstance(focused["active_prompt"], str)
        self.assertEqual(focused["answer_target"]["transaction_id"], target)
        self.assertNotIn("question_id", json.dumps(focused))
        self.assertNotIn("choices", json.dumps(focused))

    def test_full_month_cannot_be_confirmed_without_regular_loan_payment(self):
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
        self.assertNotIn("debt_reviewed", [choice["choice_id"] for choice in self.view["clarification"]["choices"]])
        self.assertIn("loan_1", [choice["choice_id"] for choice in self.view["clarification"]["choices"]])


if __name__ == "__main__":
    unittest.main()
