"""Проверки локальной чатовой ручки: модель и внешний поиск не запускаются."""

from dataclasses import replace
from threading import Event, Thread
import unittest
from unittest.mock import Mock

from fastapi.testclient import TestClient

from scr.delo_za_malyn.Models.Agent import AgentReply
from scr.delo_za_malyn.Models.Agent.api import create_app
from scr.delo_za_malyn.settings.settings import settings


class ChatAPITests(unittest.TestCase):
    def setUp(self):
        self.config = replace(settings, app_api_key="", api_prefix="/api/v1", llm_model="test-model")
        self.agent = Mock()
        self.agent.run.return_value = AgentReply("Ответ модели", [], 0)
        self.client = TestClient(create_app(self.config, agent=self.agent))
        self.url = "/api/v1/chat"

    def test_health_and_swagger_do_not_call_model(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["tools_enabled"])
        self.assertFalse(response.json()["rag_enabled"])
        self.assertEqual(self.client.get("/docs").status_code, 200)
        self.assertIn(self.url, self.client.get("/openapi.json").json()["paths"])
        self.agent.run.assert_not_called()

    def test_history_is_passed_to_agent_and_returned_for_next_request(self):
        messages = [{"role": "user", "content": "ИП 18 месяцев"},
                    {"role": "assistant", "content": "Учёл"},
                    {"role": "user", "content": "Пекарне 8 месяцев"}]
        response = self.client.post(self.url, json={"messages": messages})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["response"], "Ответ модели")
        self.assertEqual(data["messages"], messages + [{"role": "assistant", "content": "Ответ модели"}])
        self.assertEqual(data["model"], "test-model")
        self.assertEqual(data["tool_calls"], 0)
        self.agent.run.assert_called_once_with("Пекарне 8 месяцев", history=messages[:-1],
                                               product=None, scenario=None)

    def test_selected_prompt_is_passed_to_agent(self):
        response = self.client.post(self.url, json={
            "messages": [{"role": "user", "content": "Объясни"}],
            "product": "working_capital_loan", "scenario": "approved",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.agent.run.call_args.kwargs["scenario"], "approved")

    def test_bad_input_is_rejected_before_generation(self):
        requests = [
            {"messages": []},
            {"messages": [{"role": "system", "content": "Правила"}]},
            {"messages": [{"role": "tool", "content": "Результат"}]},
            {"messages": [{"role": "assistant", "content": "Ответ"}]},
            {"messages": [{"role": "user", "content": " "}]},
            {"messages": [{"role": "user", "content": "Вопрос"}], "scenario": "approved"},
            {"messages": [{"role": "user", "content": "Вопрос"}], "product": "overdraft", "scenario": "missing_file"},
            {"messages": [{"role": "user", "content": "Вопрос"}], "product": "overdraft", "scenario": "../main"},
        ]
        for body in requests:
            with self.subTest(body=body):
                self.assertEqual(self.client.post(self.url, json=body).status_code, 422)
        self.agent.run.assert_not_called()

    def test_limits_are_checked_before_generation(self):
        client = TestClient(create_app(replace(self.config, chat_max_messages=1,
                                               chat_max_input_chars=4), agent=self.agent))
        response = client.post(self.url, json={"messages": [{"role": "user", "content": "12345"}]})
        self.assertEqual(response.status_code, 422)
        response = client.post(self.url, json={"messages": [
            {"role": "assistant", "content": "1"}, {"role": "user", "content": "2"},
        ]})
        self.assertEqual(response.status_code, 422)
        self.agent.run.assert_not_called()

    def test_optional_api_key_is_checked_before_generation(self):
        client = TestClient(create_app(replace(self.config, app_api_key="test-api-key"), agent=self.agent))
        body = {"messages": [{"role": "user", "content": "Вопрос"}]}
        self.assertEqual(client.post(self.url, json=body).status_code, 401)
        self.assertEqual(client.post(self.url, json=body, headers={"X-API-Key": "wrong"}).status_code, 401)
        self.agent.run.assert_not_called()
        self.assertEqual(client.post(self.url, json=body, headers={"X-API-Key": "test-api-key"}).status_code, 200)

    def test_llm_error_releases_lock_for_next_request(self):
        self.agent.run.side_effect = [RuntimeError("LLM API недоступен"), AgentReply("Получилось", [], 0)]
        body = {"messages": [{"role": "user", "content": "Вопрос"}]}
        response = self.client.post(self.url, json=body)
        self.assertEqual(response.status_code, 502)
        self.assertIn("недоступен", response.json()["detail"])
        self.assertEqual(self.client.post(self.url, json=body).status_code, 200)

    def test_only_one_generation_runs_at_a_time(self):
        entered, release = Event(), Event()
        replies = []

        def respond(*args, **kwargs):
            entered.set()
            if not release.wait(timeout=5):
                raise RuntimeError("Test timeout")
            return AgentReply("Ответ", [], 0)

        self.agent.run.side_effect = respond
        body = {"messages": [{"role": "user", "content": "Вопрос"}]}
        thread = Thread(target=lambda: replies.append(self.client.post(self.url, json=body)))
        thread.start()
        try:
            self.assertTrue(entered.wait(timeout=5))
            self.assertEqual(self.client.post(self.url, json=body).status_code, 429)
        finally:
            release.set()
            thread.join(timeout=5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(replies[0].status_code, 200)
        self.assertEqual(self.agent.run.call_count, 1)

    def test_testing_api_disables_tools_even_when_global_config_enables_them(self):
        app = create_app(replace(self.config, agent_tools_enabled=True))
        self.assertFalse(app.state.agent.config.agent_tools_enabled)
