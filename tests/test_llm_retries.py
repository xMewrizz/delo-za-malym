"""Generation retries stay bounded and cannot replay business actions."""
from dataclasses import replace
from io import BytesIO
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.assistant import ModelAssistant
from backend.chat_tools import CabinetTools
from backend.main import create_app
from scr.delo_za_malyn.Models.Llm import client as transport
from scr.delo_za_malyn.settings.settings import settings


def response(content="Ответ", *, calls=None, finish="stop"):
    message = {"content": content}
    if calls is not None:
        message["tool_calls"] = calls
    return BytesIO(json.dumps({"choices": [{"message": message, "finish_reason": finish}]}).encode())


class LLMRetryTests(unittest.TestCase):
    def setUp(self):
        self.client = transport.LLMClient(replace(settings, llm_model="test", llm_api_key="private-test-key",
                                                 http_timeout_seconds=6))
        self.enterContext(patch.object(transport, "sleep"))

    def test_temporary_failures_retry_the_same_payload_once(self):
        errors = [TimeoutError(), URLError("private upstream detail")]
        errors += [HTTPError("http://private", code, "private body", {}, None) for code in (408, 500, 502, 503, 504)]
        for error in errors:
            with self.subTest(error=type(error).__name__, code=getattr(error, "code", None)):
                with patch.object(transport, "urlopen", side_effect=[error, response()]) as opening, transport.capture_attempts() as attempts:
                    self.assertEqual(self.client.chat([{"role": "user", "content": "Тест"}]).text, "Ответ")
                self.assertEqual(opening.call_count, 2)
                self.assertEqual(opening.call_args_list[0].args[0].data, opening.call_args_list[1].args[0].data)
                self.assertEqual([row["outcome"] for row in attempts], ["error", "success"])
                self.assertNotIn("private", json.dumps(attempts))

    def test_empty_response_retries_but_tool_only_response_is_success(self):
        with patch.object(transport, "urlopen", side_effect=[response(""), response()]) as opening:
            self.assertEqual(self.client.chat([]).text, "Ответ")
            self.assertEqual(opening.call_count, 2)
        call = {"id": "one", "type": "function", "function": {"name": "compare_options", "arguments": "{}"}}
        with patch.object(transport, "urlopen", return_value=response(None, calls=[call])) as opening:
            self.assertEqual(self.client.chat([]).tool_calls[0].name, "compare_options")
            opening.assert_called_once()

    def test_second_failure_is_final_and_diagnostics_do_not_leak_secrets(self):
        with patch.object(transport, "urlopen", side_effect=URLError("private upstream detail")) as opening:
            with transport.capture_attempts() as attempts, self.assertRaises(transport.LLMTransientError) as caught:
                self.client.chat([])
        self.assertEqual(opening.call_count, 2)
        self.assertEqual(len(attempts), 2)
        self.assertNotIn("private", str(caught.exception) + json.dumps(attempts))

    def test_credentials_quota_and_protocol_errors_are_not_retried(self):
        for status in (400, 401, 402, 403, 404, 422, 429):
            with self.subTest(status=status):
                error = HTTPError("http://private", status, "private body", {}, None)
                with patch.object(transport, "urlopen", side_effect=error) as opening:
                    with self.assertRaises(RuntimeError):
                        self.client.chat([])
                    opening.assert_called_once()
        for reply in (response("<|tool_call>call:sign{}"), response("unfinished", finish="length"),
                      response(123), BytesIO(b"not JSON")):
            with self.subTest(reply=reply), patch.object(transport, "urlopen", return_value=reply) as opening:
                with self.assertRaises(RuntimeError):
                    self.client.chat([])
                opening.assert_called_once()

    def test_long_retry_after_is_respected_without_a_premature_request(self):
        error = HTTPError("http://private", 503, "busy", {"Retry-After": "30"}, None)
        with patch.object(transport, "urlopen", side_effect=error) as opening:
            with self.assertRaises(transport.LLMTransientError):
                self.client.chat([])
            opening.assert_called_once()
        transport.sleep.assert_not_called()

    def test_timeout_reserves_second_attempt_without_extending_parent_budget(self):
        clock = [0.0]
        timeouts = []
        def unavailable(_request, *, timeout):
            timeouts.append(timeout)
            clock[0] += timeout
            raise TimeoutError()
        with patch.object(transport, "monotonic", side_effect=lambda: clock[0]), \
             patch.object(transport, "sleep", side_effect=lambda seconds: clock.__setitem__(0, clock[0] + seconds)), \
             patch.object(transport, "urlopen", side_effect=unavailable):
            with transport.request_budget(4), self.assertRaises(transport.LLMTransientError):
                self.client.chat([])
        self.assertEqual(timeouts, [2.0, 1.5])
        self.assertEqual(clock[0], 4.0)

    def test_expired_budget_never_starts_a_request(self):
        with transport.request_budget(0), patch.object(transport, "urlopen") as opening:
            with self.assertRaises(transport.LLMTransientError):
                self.client.chat([])
            opening.assert_not_called()


class RetryPersistenceTests(unittest.TestCase):
    def test_failed_attempts_leave_no_partial_chat_and_same_request_can_be_retried(self):
        with TemporaryDirectory() as directory, patch.dict(os.environ, {
            "LLM_MODEL": "test", "HTTP_TIMEOUT_SECONDS": "6", "AGENT_TOOLS_ENABLED": "true",
        }):
            with TestClient(create_app(Path(directory) / "failed.sqlite3", assistant=ModelAssistant())) as client:
                view = client.post("/api/chats", json={}).json()
                path = "/api/chats/" + view["chat"]["chat_id"]
                body = {"base_chat_version": 1, "request_id": str(uuid4()), "text": "Нужны 500 тысяч на закупку"}
                with patch.object(transport, "urlopen", side_effect=TimeoutError()) as opening, patch.object(transport, "sleep"):
                    self.assertEqual(client.post(path + "/messages", json=body).status_code, 503)
                    self.assertEqual(opening.call_count, 2)
                current = client.get(path).json()
                self.assertEqual(current["chat"]["messages"], [])
                self.assertEqual(current["record"]["application"], view["record"]["application"])
                final = json.dumps({"text": "Проверьте сумму", "changes": {"need.requested_amount": "500000.00"},
                                    "overdraft_plan": None, "question": None})
                with patch.object(transport, "urlopen", return_value=response(final)) as opening:
                    result = client.post(path + "/messages", json=body)
                    self.assertEqual(result.status_code, 200, result.text)
                    self.assertEqual(len(result.json()["chat"]["messages"]), 2)
                    self.assertEqual(result.json()["record"]["application"], view["record"]["application"])
                    opening.assert_called_once()

    def test_retry_after_tool_execution_saves_one_comparison_and_one_message_pair(self):
        with TemporaryDirectory() as directory, patch.dict(os.environ, {
            "LLM_MODEL": "test", "AGENT_TOOLS_ENABLED": "true", "TAVILY_API_KEY": "",
            "HTTP_TIMEOUT_SECONDS": "6", "LLM_CONTEXT_SIZE": "16384", "LLM_MAX_OUTPUT_TOKENS": "1024",
        }):
            model = ModelAssistant()
            with TestClient(create_app(Path(directory) / "retry.sqlite3", assistant=model)) as client:
                record = client.post("/api/applications", json={"need": {
                    "purpose": "working_capital", "preferred_product": "working_capital_loan",
                    "requested_amount": "500000.00", "term_months": 12}}).json()
                view = client.post("/api/chats", json={"application_id": record["application"]["application_id"]}).json()
                path = "/api/chats/" + view["chat"]["chat_id"]
                body = {"base_chat_version": 1, "request_id": str(uuid4()),
                        "text": "Покажи несколько вариантов кредита с платежом не больше 40 тысяч в месяц. Саму заявку не меняй."}
                tool_call = {"id": "one", "type": "function", "function": {"name": "compare_options", "arguments": json.dumps({
                    "product_id": "working_capital_loan", "preferences": {"maximum_monthly_payment": "40000.00"}})}}
                final = json.dumps({"text": "Сравните условия в карточках.", "intent": "answer_question", "changes": {}})
                execute = CabinetTools.execute
                with patch.object(transport, "urlopen", side_effect=[response(None, calls=[tool_call]), TimeoutError(), response(final)]) as opening, \
                     patch.object(transport, "sleep"), \
                     patch.object(CabinetTools, "execute", autospec=True, side_effect=execute) as tools:
                    result = client.post(path + "/messages", json=body)
                    self.assertEqual(result.status_code, 200, result.text)
                    value = result.json()
                    self.assertEqual(len(value["chat"]["messages"]), 2)
                    self.assertEqual(len(value["record"]["explorations"]), 1)
                    self.assertEqual(value["record"]["application"], record["application"])
                    self.assertEqual(client.post(path + "/messages", json=body).json(), value)
                    self.assertEqual(opening.call_count, 3)
                    self.assertEqual(tools.call_count, 1)


if __name__ == "__main__":
    unittest.main()
