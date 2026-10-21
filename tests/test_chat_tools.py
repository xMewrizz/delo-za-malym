from copy import deepcopy
from datetime import datetime
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from backend import demo
from backend.assistant import ModelAssistant, AssistantResponseError, AssistantReply, checked_search_reply, build_messages
from backend.chat_tools import CabinetTools
from backend.main import create_app
from backend.service import CreditProcess
from backend.store import Store
from credit_engine import calculate_loan
from scr.delo_za_malyn.Models.Agent.tavily import TavilyClient
from scr.delo_za_malyn.Models.Llm.client import Reply, ToolCall


class CabinetToolsTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = Store(Path(self.directory.name) / "test.sqlite3")
        self.store.initialize()
        self.now = datetime.fromisoformat("2026-10-21T12:00:00+03:00")
        self.process = CreditProcess(self.store, lambda: self.now)
        self.search = Mock(spec=TavilyClient)
        self.search.available = True
        self.search.search.return_value = {"ok": True, "sources": [
            {"title": "МСП", "url": "https://corpmsp.ru", "content": "Публичные условия"},
        ]}
        view = self.process.create(scenario=("working_capital_loan", "01_approved"))
        self.id = view["application"]["application_id"]
        self.record = self.load()
        self.tools = CabinetTools(self.process, self.record, self.now, self.search)

    def load(self):
        with self.store.connect() as connection:
            return self.store.get(connection, self.id)

    def test_all_fourteen_scenarios_use_engine_without_database_changes(self):
        for scenario in demo.scenarios():
            with self.subTest(scenario=scenario["scenario_id"]):
                view = self.process.create(scenario=(scenario["product_id"], scenario["scenario_id"]))
                identifier = view["application"]["application_id"]
                with self.store.connect() as connection:
                    before = self.store.get(connection, identifier)
                tools = CabinetTools(self.process, before, self.now, self.search)
                result = tools.execute("assess_credit", "{}")
                self.assertTrue(result["ok"], result)
                self.assertFalse(result["saved"])
                self.assertEqual(result["stage"], "preliminary")
                self.assertIn(result["result"]["status"], {"assessed", "invalid_data", "needs_checks", "check_retry_pending"})
                expected = deepcopy(before)
                self.process._assess(expected, self.now, stage="preliminary")
                self.assertEqual(result["result"]["status"], expected["result"]["status"])
                if result["result"]["assessment"]:
                    self.assertEqual(result["result"]["assessment"]["outcome"], expected["result"]["assessment"]["outcome"])
                with self.store.connect() as connection:
                    self.assertEqual(self.store.get(connection, identifier), before)

    def test_alternative_uses_changed_amount_and_preserves_original_and_simulator(self):
        before = deepcopy(self.record)
        result = self.tools.execute("simulate_alternative", json.dumps({"changes": {
            "need.requested_amount": "800000.00", "need.term_months": 18,
        }}))
        self.assertTrue(result["ok"], result)
        offers = result["result"]["assessment"]["offers"]
        self.assertTrue(any(offer["amount"] == "800000.00" and offer["term_months"] == 18 for offer in offers))
        self.assertEqual(self.load(), before)
        self.assertEqual(self.record, before)
        self.assertFalse(result["saved"])

    def test_recommendation_and_argument_validation(self):
        self.assertTrue(self.tools.execute("recommend_financing", "{}")["ok"])
        for name, args in (("assess_credit", '{"application_id":"other"}'),
                           ("simulate_alternative", '{"changes":{"state.status":"disbursed"}}'),
                           ("simulate_alternative", '{"changes":{"need.term_months":true}}'),
                           ("simulate_alternative", '{"changes":{}}'),
                           ("submit", "{}"), ("assess_credit", "[]")):
            with self.subTest(name=name, args=args):
                self.assertFalse(self.tools.execute(name, args)["ok"])
        self.assertEqual(self.load(), self.record)

    def test_assessment_is_not_offered_until_product_is_selected(self):
        record = deepcopy(self.record)
        record["application"]["need"]["preferred_product"] = None
        tools = CabinetTools(self.process, record, self.now, self.search)
        names = {item["function"]["name"] for item in tools.definitions}
        self.assertNotIn("assess_credit", names)
        self.assertIn("recommend_financing", names)
        self.assertIn("simulate_alternative", names)
        self.assertIn("calculate_loan", names)
        self.assertEqual(tools.execute("assess_credit", "{}")["error"]["code"], "product_required")
        self.assertTrue(tools.execute("simulate_alternative", json.dumps({"changes": {
            "need.preferred_product": "working_capital_loan",
        }}))["ok"])
        self.assertIsNone(record["application"]["need"]["preferred_product"])

    def test_arbitrary_payment_delegates_to_engine_beyond_product_limits(self):
        before = deepcopy(self.record)
        record = deepcopy(before)
        record["application"]["need"]["preferred_product"] = None
        tools = CabinetTools(self.process, record, self.now, self.search)
        for rate in ("0.00", "18.00"):
            with self.subTest(rate=rate):
                expected = calculate_loan("30000000.00", 60, rate).to_dict()
                schedule = expected["calculation"].pop("schedule")
                with patch("backend.chat_tools.calculate_loan", wraps=calculate_loan) as engine:
                    result = tools.execute("calculate_loan", json.dumps({
                        "amount": "30000000.00", "term_months": 60, "annual_rate_percent": rate,
                    }))
                engine.assert_called_once_with("30000000.00", 60, rate)
                self.assertTrue(result["ok"], result)
                self.assertEqual(result["result"], expected)
                self.assertEqual(schedule[-1]["closing_balance"], "0.00")
                self.assertFalse(result["saved"])
                self.assertFalse(result["eligibility_assessed"])
                self.assertEqual(result["mode"], "illustrative")
                self.assertFalse(result["assumptions"]["fees_included"])
                if rate == "0.00":
                    self.assertEqual(result["result"]["calculation"]["monthly_payment"], "500000.00")
                    self.assertEqual(result["result"]["calculation"]["total_interest"], "0.00")
        self.assertIsNone(record["application"]["need"]["preferred_product"])
        self.assertEqual(self.load(), before)
        self.assertEqual(self.record, before)

    def test_arbitrary_payment_reports_missing_and_invalid_parameters(self):
        result = self.tools.execute("calculate_loan", '{"amount":"30000000.00"}')
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "needs_information")
        self.assertEqual(set(result["missing_fields"]), {"term_months", "annual_rate_percent"})
        self.assertIsNone(result["result"]["calculation"])
        self.assertIn("годовую ставку", result["error"]["message"])
        invalid = ({"amount": "0.00"}, {"amount": "-1.00"}, {"amount": 30000000},
                   {"amount": "30 000 000,00"}, {"term_months": True}, {"term_months": "60"},
                   {"term_months": 0}, {"term_months": 601}, {"annual_rate_percent": "-1.00"},
                   {"annual_rate_percent": "NaN"}, {"amount": "1" * 65 + ".00"},
                   {"annual_rate_percent": "1" * 65 + ".00"}, {"salary": "100000.00"})
        for override in invalid:
            with self.subTest(override=override):
                args = {"amount": "30000000.00", "term_months": 60, "annual_rate_percent": "18.00", **override}
                self.assertFalse(self.tools.execute("calculate_loan", json.dumps(args))["ok"])
        self.assertEqual(self.load(), self.record)

    def test_arbitrary_payment_native_call_round_trip_without_application_changes(self):
        model = self.model()
        arguments = json.dumps({"amount": "30000000.00", "term_months": 60, "annual_rate_percent": "18.00"})
        model.client.chat.side_effect = [
            Reply("", "tool_calls", (ToolCall("payment1", "calculate_loan", arguments),)),
            Reply('{"text":"Расчёт платежа готов. Одобрение не оценивалось.","intent":"answer_question","changes":{}}', "stop"),
        ]
        with TestClient(create_app(self.store.path, clock=lambda: self.now, assistant=model)) as client:
            view = client.post("/api/chats", json={"application_id": self.id}).json()
            url = "/api/chats/" + view["chat"]["chat_id"] + "/messages"
            response = client.post(url, json={"base_chat_version": 1, "request_id": str(uuid4()),
                "text": "Рассчитай платёж для 30 млн на 60 месяцев под 18% годовых"})
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            message = result["chat"]["messages"][-1]
            self.assertEqual(message["tools"][0]["name"], "calculate_loan")
            self.assertTrue(message["tools"][0]["ok"])
            self.assertIsNone(message["proposal"])
            self.assertEqual(result["record"]["application"], view["record"]["application"])
            saved = client.get("/api/chats/" + view["chat"]["chat_id"]).json()
            self.assertEqual(saved["chat"]["messages"][-1]["tools"], message["tools"])
        sent = model.client.chat.call_args.args[0]
        self.assertEqual(sent[-1]["tool_call_id"], "payment1")
        self.assertEqual(json.loads(sent[-1]["content"])["result"]["status"], "calculated")
        self.assertEqual(self.load(), self.record)

    def test_model_context_keeps_application_facts_without_internal_duplicates(self):
        tool = self.tools.execute("assess_credit", "{}")
        chat = {"messages": [{"role": "user", "text": "Рассчитай"},
                            {"role": "assistant", "text": "Готово", "model_content": "EXTRA_JSON", "tools": [tool]}]}
        record = deepcopy(self.record)
        record["result"] = {"status": "assessed", "assessment": {"offers": [
            {"amount": "500000.00", "monthly_payment": "47000.00", "schedule": [{"technical": "x" * 10000}]}]},
                            "scoring": {"private": "x" * 10000}}
        before = deepcopy(record)
        messages = build_messages(chat, record, "Почему?", [])
        context = json.loads(messages[1]["content"].split("\n", 1)[1])
        self.assertEqual(context["application"], record["application"])
        self.assertEqual(context["result"]["assessment"]["offers"][0]["monthly_payment"], "47000.00")
        self.assertNotIn("schedule", messages[1]["content"])
        self.assertNotIn("scoring", messages[1]["content"])
        self.assertEqual(messages[-2]["content"], "Готово")
        self.assertEqual(record, before)

    def test_new_chat_calculator_fits_deployment_context_in_both_model_phases(self):
        from scr.delo_za_malyn.Models.Llm.client import LLMContextLimit
        # Use the real client preflight, but stub its HTTP transport entirely.
        with patch.dict(os.environ, {"LLM_MODEL": "test", "AGENT_TOOLS_ENABLED": "true", "TAVILY_API_KEY": "test-key",
                                     "LLM_CONTEXT_SIZE": "8192", "LLM_MAX_OUTPUT_TOKENS": "1024"}):
            model = ModelAssistant()
        view = self.process.create()
        with self.store.connect() as connection:
            record = self.store.get(connection, view["application"]["application_id"])
        messages = build_messages({"messages": []}, record, "Рассчитай 30 млн на 60 месяцев под 18% годовых", [])
        arguments = json.dumps({"amount": "30000000.00", "term_months": 60, "annual_rate_percent": "18.00"})
        responses = [{"choices": [{"finish_reason": "tool_calls", "message": {"tool_calls": [
            {"id": "p1", "type": "function", "function": {"name": "calculate_loan", "arguments": arguments}}]}}]},
                     {"choices": [{"finish_reason": "stop", "message": {"content": '{"text":"Готово","intent":"answer_question","changes":{}}'}}]}]
        with patch.object(model.client, "_request", side_effect=responses) as request:
            turn = model.reply_with_tools(messages, process=self.process, record=record, now=self.now)
        self.assertEqual(request.call_count, 2)
        self.assertTrue(turn.tools[0]["ok"])
        long_messages = deepcopy(messages)
        long_messages.insert(-1, {"role": "user", "content": "Длинная история " * 2000})
        with patch.object(model.client, "_request") as request:
            with self.assertRaises(LLMContextLimit):
                model.reply_with_tools(long_messages, process=self.process, record=record, now=self.now)
            request.assert_not_called()

    def test_successful_calculator_is_saved_even_when_final_explanation_fails(self):
        from scr.delo_za_malyn.Models.Llm.client import LLMProtocolError
        model = self.model()
        model.client.chat.side_effect = [
            Reply("", "tool_calls", (ToolCall("p1", "calculate_loan", '{"amount":"8000000.00","term_months":18,"annual_rate_percent":"24.00"}'),)),
            LLMProtocolError("empty_response"),
        ]
        with TestClient(create_app(self.store.path, clock=lambda: self.now, assistant=model)) as client:
            view = client.post("/api/chats", json={"application_id": self.id}).json()
            response = client.post("/api/chats/" + view["chat"]["chat_id"] + "/messages", json={
                "base_chat_version": 1, "request_id": str(uuid4()), "text": "Рассчитай 8 млн на 18 месяцев под 24% годовых"})
            self.assertEqual(response.status_code, 200, response.text)
            answer = response.json()["chat"]["messages"][-1]
            self.assertIn("Объяснение модели получить не удалось", answer["text"])
            self.assertEqual(answer["tools"][0]["result"]["calculation"]["monthly_payment"], "533616.82")
            self.assertIsNone(answer["proposal"])
        self.assertEqual(model.client.chat.call_count, 2)
        self.assertEqual(self.load(), self.record)

    def test_reply_accepts_only_known_control_suffixes_and_still_enforces_schema(self):
        raw = '{"text":"Готово","intent":"answer_question","changes":{}}'
        for suffix in ("<|tool_response>", "<turn|>", "<|tool_response> <turn|>"):
            with self.subTest(suffix=suffix):
                self.assertEqual(ModelAssistant.parse_reply(Reply(raw + suffix, "stop")).text, "Готово")
        for invalid in (raw + "Подтвердите", raw + '{"changes":{}}', '{"text":"Готово","intent":"answer_question","changes":{"need.term_months":18}}<turn|>'):
            with self.subTest(invalid=invalid):
                with self.assertRaises(AssistantResponseError):
                    ModelAssistant.parse_reply(Reply(invalid, "stop"))

    def test_search_is_public_and_missing_key_does_not_disable_calculations(self):
        result = self.tools.execute("web_search", '{"query":"поддержка малого бизнеса site:corpmsp.ru"}')
        self.assertTrue(result["ok"])
        self.search.search.assert_called_once()
        self.search.reset_mock()
        result = self.tools.execute("web_search", '{"query":"проверь ИНН 0000000000"}')
        self.assertEqual(result["error"]["code"], "private_query")
        self.search.search.assert_not_called()
        self.search.available = False
        names = {item["function"]["name"] for item in self.tools.definitions}
        self.assertNotIn("web_search", names)
        self.assertIn("assess_credit", names)

    def test_invented_search_domains_are_not_shown_as_verified_links(self):
        events = [{"name": "web_search", "ok": True, "sources": [{
            "title": "Корпорация МСП", "url": "https://corpmsp.ru", "content": "Официальная информация",
        }]}]
        for text in ("Сайт https://corp.msp.ru", "Ещё один сайт msp.bank.ru", "Сайт https://[bad"):
            reply = checked_search_reply(AssistantReply(text=text, intent="answer_question"), events)
            self.assertNotIn("corp.msp.ru", reply.text)
            self.assertNotIn("msp.bank.ru", reply.text)
        valid = AssistantReply(text="Источник: https://corpmsp.ru.", intent="answer_question")
        self.assertEqual(checked_search_reply(valid, events), valid)

    def model(self, limit="3"):
        with patch.dict(os.environ, {"LLM_MODEL": "test", "AGENT_TOOLS_ENABLED": "true", "AGENT_MAX_TOOL_CALLS": limit, "TAVILY_API_KEY": ""}):
            model = ModelAssistant()
        model.client = Mock()
        return model

    def test_tool_round_trip_is_saved_with_reply_and_context_without_mutation(self):
        model = self.model()
        requests = []
        replies = iter([
            Reply("", "tool_calls", (ToolCall("c1", "assess_credit", "{}"),)),
            Reply(json.dumps({"text": "По предварительному расчёту доступны предложения.", "intent": "answer_question", "changes": {}}), "stop"),
            Reply("Сейчас отвечу", "stop"),
            Reply(json.dumps({"text": "Это предварительный расчёт.", "intent": "answer_question", "changes": {}}), "stop"),
        ])
        def respond(messages, **kwargs):
            requests.append(deepcopy(messages))
            return next(replies)
        model.client.chat.side_effect = respond
        with TestClient(create_app(self.store.path, clock=lambda: self.now, assistant=model)) as client:
            view = client.post("/api/chats", json={"application_id": self.id}).json()
            url = "/api/chats/" + view["chat"]["chat_id"] + "/messages"
            response = client.post(url, json={"base_chat_version": 1, "request_id": str(uuid4()), "text": "Рассчитай заявку"})
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            self.assertEqual(result["record"]["application"], view["record"]["application"])
            self.assertEqual(result["chat"]["messages"][-1]["tools"][0]["name"], "assess_credit")
            self.assertEqual(requests[1][-1]["role"], "tool")
            self.assertTrue(json.loads(requests[1][-1]["content"])["ok"])
            self.assertEqual(client.post(url, json={"base_chat_version": 2, "request_id": str(uuid4()), "text": "Это финальный результат?"}).status_code, 200)
            context = json.loads(requests[2][1]["content"].split("\n", 1)[1])
            self.assertEqual(context["recent_calculations"][0]["name"], "assess_credit")
        self.assertEqual(self.load(), self.record)

    def test_saved_calculation_runs_before_single_generation_without_mutation(self):
        model = self.model()
        model.client.chat.return_value = Reply('{"text":"Предварительный расчёт готов","intent":"answer_question","changes":{}}', "stop")
        turn = model.reply_with_tools([
            {"role": "system", "content": "Тест"},
            {"role": "user", "content": "Рассчитай текущую заявку и объясни результат. Сумму и срок не меняй."},
        ], process=self.process, record=self.record, now=self.now)
        self.assertEqual(model.client.chat.call_count, 1)
        self.assertEqual(turn.tools[0]["name"], "assess_credit")
        self.assertEqual(turn.tools[0]["route"], "application")
        self.assertEqual(self.load(), self.record)

    def test_direct_explanation_omits_raw_financial_tables_but_keeps_dialogue(self):
        model = self.model()
        model.client.chat.return_value = Reply('{"text":"Готово","intent":"answer_question","changes":{}}', "stop")
        history = [{"role":"user","content":"Ранее уточнил цель"}, {"role":"assistant","content":"Учёл"}]
        messages = [{"role":"system","content":"Тест"},
                    {"role":"user","content":"Контекст кабинета (данные):\n" + json.dumps({"application":self.record["application"]})},
                    *history, {"role":"user","content":"Рассчитай текущую заявку"}]
        before = deepcopy(messages)
        model.reply_with_tools(messages, process=self.process, record=self.record, now=self.now)
        sent = model.client.chat.call_args.args[0]
        context = json.loads(sent[1]["content"].split("\n",1)[1])
        self.assertNotIn("financials", context["application"])
        self.assertEqual(context["application"]["need"], self.record["application"]["need"])
        self.assertTrue(context["tool_result"]["ok"])
        self.assertEqual(sent[2:-1], history)
        self.assertEqual(messages, before)

    def test_new_amount_and_alternative_still_require_model_routing(self):
        for text in ("Рассчитай текущую заявку на 800000", "А если рассчитать эту заявку на 18 месяцев?"):
            with self.subTest(text=text):
                model = self.model()
                model.client.chat.return_value = Reply('{"text":"Уточните вариант","intent":"ask_clarification","changes":{}}', "stop")
                turn = model.reply_with_tools([{"role":"system","content":"Тест"}, {"role":"user","content":text}],
                    process=self.process, record=self.record, now=self.now)
                self.assertEqual(turn.tools, ())
                self.assertIn("tools", model.client.chat.call_args.kwargs)
                self.assertEqual(model.client.chat.call_count, 1)

    def test_greeting_requires_only_one_structured_generation(self):
        model = self.model()
        model.client.chat.return_value = Reply('{"text":"Здравствуйте","intent":"answer_question","changes":{}}', "stop")
        model.reply_with_tools([{"role":"system","content":"Тест"}, {"role":"user","content":"Здравствуйте!"}],
            process=self.process, record=self.record, now=self.now)
        self.assertEqual(model.client.chat.call_count, 1)
        self.assertNotIn("tools", model.client.chat.call_args.kwargs)

    def test_tool_limit_rejects_extra_execution_and_final_reply_is_required(self):
        model = self.model("1")
        model.client.chat.side_effect = [
            Reply("", "tool_calls", (ToolCall("a", "assess_credit", "{}"), ToolCall("b", "assess_credit", "{}"))),
            Reply('{"text":"Готово","intent":"answer_question","changes":{}}', "stop"),
        ]
        turn = model.reply_with_tools([{"role": "system", "content": "Тест"}], process=self.process, record=self.record, now=self.now)
        self.assertEqual(len(turn.tools), 1)
        self.assertNotIn("tools", model.client.chat.call_args.kwargs)
        self.assertIn("response_format", model.client.chat.call_args.kwargs)
        model.client.chat.side_effect = [Reply("", "tool_calls", (ToolCall("a", "assess_credit", "{}"),))] * 2
        with self.assertRaises(AssistantResponseError):
            model.reply_with_tools([{"role": "system", "content": "Тест"}], process=self.process, record=self.record, now=self.now)


if __name__ == "__main__":
    unittest.main()
