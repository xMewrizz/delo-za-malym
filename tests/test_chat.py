from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier, Thread
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.assistant import AssistantReply, AssistantResponseError, DemoAssistant, ModelAssistant, assistant_response_schema
from backend.main import create_app
from scr.delo_za_malyn.Models.Llm.client import LLMContextLimit, LLMOutputLimit, LLMProtocolError


class RecordingAssistant:
    mode = "model"
    model = "test-model"

    def __init__(self):
        self.calls = []
        self.response = AssistantReply(text="Изменить сумму?", intent="propose_changes",
                                       changes={"need.requested_amount": "500000.00"})
        self.error = None

    def reply(self, messages):
        self.calls.append(messages)
        if self.error:
            raise self.error
        return self.response


class ChatTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.database = Path(self.directory.name) / "cabinet.sqlite3"
        self.assistant = RecordingAssistant()
        self.now = datetime.fromisoformat("2026-10-21T12:00:00+03:00")
        self.app = create_app(self.database, clock=lambda: self.now, assistant=self.assistant)
        self.client = TestClient(self.app).__enter__()
        self.view = self.client.post("/api/chats", json={}).json()
        self.path = "/api/chats/" + self.view["chat"]["chat_id"]

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def send(self, text="Нужно 500 тысяч", request_id=None, version=None):
        return self.client.post(self.path + "/messages", json={"base_chat_version": version or self.view["chat"]["chat_version"],
            "text": text, "request_id": request_id or str(uuid4())})

    def resolve(self, action="confirm", proposal=None, confirmed=True):
        proposal = proposal or self.view["chat"]["messages"][-1]["proposal"]
        return self.client.post(self.path + "/proposals/" + proposal["proposal_id"] + "/" + action,
            json={"base_chat_version": self.view["chat"]["chat_version"], **({"confirmed": confirmed} if action == "confirm" else {})})

    def test_page_assets_and_configuration(self):
        self.assertEqual(self.client.get("/chat").status_code, 200)
        self.assertEqual(self.client.get("/chat-assets/chat.js").status_code, 200)
        self.assertEqual(self.client.get("/api/chat/config").json()["model"], "test-model")
        self.assertNotIn("LLM_API_KEY", self.client.get("/api/chat/config").text)

    def test_history_context_and_confirmed_patch(self):
        original = self.view["record"]["application"]
        self.view = self.send().json()
        self.assertEqual(self.view["record"]["application"], original)
        context = json.loads(self.assistant.calls[-1][1]["content"].split("\n", 1)[1])
        self.assertEqual(context["application"]["application_id"], original["application_id"])
        self.assertEqual(len(context["catalog"]), 4)
        self.view = self.resolve().json()
        self.assertEqual(self.view["record"]["application"]["need"]["requested_amount"], "500000.00")
        self.assertEqual(self.view["record"]["application"]["application_version"], 2)
        self.assertEqual(self.view["chat"]["messages"][-1]["proposal"]["status"], "applied")
        self.assertEqual(self.resolve().status_code, 409)
        self.assistant.response = AssistantReply(text="Какой срок?", intent="ask_clarification", question="Какой срок?")
        self.view = self.send("На год").json()
        messages = self.assistant.calls[-1]
        self.assertEqual([item["role"] for item in messages], ["system", "user", "user", "assistant", "user"])
        self.assertEqual(messages[-3]["content"], "Нужно 500 тысяч")
        context = json.loads(messages[1]["content"].split("\n", 1)[1])
        self.assertEqual(context["application"]["need"]["requested_amount"], "500000.00")
        self.assertEqual(context["previous_proposals"][0]["status"], "applied")

    def test_context_and_output_limits_are_actionable_not_server_unavailable(self):
        for exception, code in ((LLMContextLimit("Контекст заполнен. Начните новый диалог."), "context_limit"),
                                (LLMOutputLimit("Модель не завершила ответ."), "assistant_output_limit")):
            with self.subTest(code=code):
                self.assistant.error = exception
                response = self.send()
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIn(code, response.text)
                self.assertIn(str(exception), response.text)
                self.assertEqual(self.client.get("/api/chats/" + self.view["chat"]["chat_id"]).json()["chat"]["messages"], [])

    def test_model_protocol_failure_has_specific_error_without_saving_history(self):
        self.assistant.error = LLMProtocolError("empty_response")
        response = self.send()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"]["code"], "assistant_empty_response")
        self.assertNotIn("Не удалось получить ответ сервера", response.text)
        self.assertEqual(self.client.get("/api/chats/" + self.view["chat"]["chat_id"]).json()["chat"]["messages"], [])

    def test_reject_does_not_change_application(self):
        original = self.view["record"]["application"]
        self.view = self.send().json()
        self.view = self.resolve("reject").json()
        self.assertEqual(self.view["record"]["application"], original)
        self.assertEqual(self.view["chat"]["messages"][-1]["proposal"]["status"], "rejected")

    def test_new_turn_supersedes_pending_proposal(self):
        self.view = self.send().json()
        old = self.view["chat"]["messages"][-1]["proposal"]
        self.view = self.send("Другой вопрос").json()
        self.assertEqual(self.view["chat"]["messages"][1]["proposal"]["status"], "superseded")
        self.assertEqual(self.resolve(proposal=old).status_code, 409)

    def test_form_edit_makes_proposal_stale(self):
        self.view = self.send().json()
        application = self.view["record"]["application"]
        response = self.client.patch("/api/applications/" + application["application_id"],
            json={"base_application_version": 1, "changes": {"need.requested_amount": "600000.00"}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.resolve().json()["detail"]["code"], "version_conflict")
        self.assertEqual(self.resolve("reject").status_code, 200)

    def test_idempotent_message_and_conflicting_id(self):
        request_id = str(uuid4())
        self.view = self.send(request_id=request_id).json()
        again = self.send(request_id=request_id, version=1)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(len(again.json()["chat"]["messages"]), 2)
        self.assertEqual(len(self.assistant.calls), 1)
        self.assertEqual(self.send(text="Другой текст", request_id=request_id).status_code, 409)
        self.assertEqual(self.send(version=1).status_code, 409)

    def test_model_failure_preserves_history_and_allows_retry(self):
        self.assistant.error = RuntimeError("secret-api-key")
        request_id = str(uuid4())
        response = self.send(request_id=request_id)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret-api-key", response.text)
        self.assertEqual(self.client.get(self.path).json()["chat"]["messages"], [])
        self.assistant.error = None
        self.assertEqual(self.send(request_id=request_id).status_code, 200)

    def test_invalid_reply_is_distinguished_and_logged_without_contents(self):
        self.assistant.error = AssistantResponseError("secret-api-key and private client data")
        with self.assertLogs("backend.chat", level="WARNING") as captured:
            response = self.send()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "assistant_invalid_response")
        self.assertIn("AssistantResponseError", captured.output[0])
        self.assertNotIn("secret-api-key", response.text + str(captured.output))
        self.assertNotIn("private client data", response.text + str(captured.output))
        self.assertEqual(self.client.get(self.path).json()["chat"]["messages"], [])

    def test_invalid_model_output_cannot_change_protected_fields(self):
        for changes in ({"state.status": "disbursed"}, {"need.requested_amount": 500000},
                        {"need.term_months": True}, {"need.recurring": "yes"}, {"need.purpose": "made_up"}):
            with self.subTest(changes=changes):
                self.assistant.response = {"text": "Да", "intent": "propose_changes", "changes": changes}
                self.assertEqual(self.send().status_code, 503)
                self.assertEqual(self.client.get(self.path).json()["chat"]["messages"], [])

    def test_validation_blank_oversize_and_confirmation(self):
        self.assertEqual(self.send(text="  ").status_code, 422)
        self.assertEqual(self.send(text="а" * 8001).status_code, 422)
        self.view = self.send().json()
        self.assertEqual(self.resolve(confirmed=False).status_code, 422)

    def test_restart_and_new_dialog_preserve_application(self):
        self.view = self.send().json()
        new = self.client.post("/api/chats", json={"application_id": self.view["chat"]["application_id"]}).json()
        self.assertEqual(new["chat"]["messages"], [])
        self.assertEqual(new["record"]["application"], self.view["record"]["application"])
        with TestClient(create_app(self.database, assistant=self.assistant)) as other:
            self.assertEqual(other.get(self.path).json()["chat"], self.view["chat"])
        self.assertEqual(self.client.post("/api/chats", json={"application_id":"absent"}).status_code, 404)

    def test_real_assessment_is_in_next_model_context(self):
        record = self.client.post("/api/demo/scenarios/working_capital_loan/01_approved").json()
        application_id = record["application"]["application_id"]
        self.view = self.client.post("/api/chats", json={"application_id":application_id}).json()
        self.path = "/api/chats/" + self.view["chat"]["chat_id"]
        response = self.client.post("/api/applications/" + application_id + "/preview", json={"base_application_version":1})
        self.assertEqual(response.json()["result"]["assessment"]["outcome"], "approved")
        self.send("Объясни результат")
        context = json.loads(self.assistant.calls[-1][1]["content"].split("\n",1)[1])
        self.assertEqual(context["result"]["assessment"]["outcome"], "approved")
        self.assertTrue(context["result"]["assessment"]["offers"])

    def test_confirmation_is_blocked_after_completion(self):
        record = self.client.post("/api/demo/scenarios/working_capital_loan/01_approved").json()
        application_id = record["application"]["application_id"]
        self.view = self.client.post("/api/chats", json={"application_id":application_id}).json()
        self.path = "/api/chats/" + self.view["chat"]["chat_id"]
        self.view = self.send().json()
        process = self.app.state.process
        record = process.submit(application_id,1)
        assessment = record["result"]["assessment"]
        offer = assessment["offers"][0]
        process.select(application_id,1,assessment["assessment_id"],offer["offer_id"])
        process.sign(application_id,1,offer["offer_id"])
        response = self.resolve()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["code"], "editing_not_allowed")

    def test_concurrent_turns_cannot_overwrite_history(self):
        barrier = Barrier(2)
        answer = self.assistant.response
        def reply(messages):
            barrier.wait(timeout=5)
            return answer
        self.assistant.reply = reply
        def send(number):
            try:
                return self.app.state.chats.send(self.view["chat"]["chat_id"],1,str(number),str(uuid4()))
            except Exception as exc:
                return exc
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(send,[1,2]))
        self.assertEqual(sum(isinstance(result,dict) for result in results),1)
        self.assertEqual(len(self.client.get(self.path).json()["chat"]["messages"]),2)

    def test_demo_is_explicit_and_produces_confirmable_card(self):
        with TestClient(create_app(self.database,assistant=DemoAssistant())) as client:
            response = client.post(self.path + "/messages", json={"base_chat_version":1,"text":"Нужно 500 000 ₽ на закупку на 12 месяцев","request_id":str(uuid4())})
            self.assertEqual(response.status_code,200)
            result = response.json()
            self.assertEqual(result["assistant"]["mode"],"demo")
            self.assertEqual(result["chat"]["messages"][-1]["proposal"]["changes"]["need.requested_amount"],"500000.00")


class ModelAdapterTests(unittest.TestCase):
    def test_default_context_fits_first_cabinet_turn_with_tools_and_output_reserve(self):
        with TemporaryDirectory() as directory, patch.dict(os.environ):
            os.environ.pop("LLM_CONTEXT_SIZE", None)
            os.environ.update(LLM_MODEL="test", LLM_RESPONSE_FORMAT="json_object",
                              LLM_MAX_OUTPUT_TOKENS="4096", AGENT_TOOLS_ENABLED="true")
            model = ModelAssistant()
            app = create_app(Path(directory) / "first-turn.sqlite3", assistant=model)
            app.state.chats.store.initialize()
            view = app.state.chats.create()
            response = {"choices": [{"message": {"content": json.dumps({
                "text": "Какой срок нужен?", "intent": "ask_clarification", "changes": {},
                "question": "Какой срок нужен?"}, ensure_ascii=False)}, "finish_reason": "stop"}]}
            with patch.object(model.client, "_request", return_value=response) as request:
                result = app.state.chats.send(view["chat"]["chat_id"], 1,
                                             "Что такое поручительство?", str(uuid4()))
            request.assert_called_once()
            self.assertEqual(result["chat"]["messages"][-1]["text"], "Какой срок нужен?")
            self.assertEqual(result["record"]["application"]["application_version"], 1)

    def test_reasoning_prefix_is_never_returned_and_json_stays_strict(self):
        from scr.delo_za_malyn.Models.Llm.client import Reply
        body = '{"text":"Готово","intent":"answer_question","changes":{}}'
        original = Reply('<think>private-reasoning</think>\n'+body, "stop")
        reply = ModelAssistant.parse_reply(original)
        self.assertEqual(reply.text, "Готово")
        self.assertNotIn("private-reasoning", reply.model_dump_json())
        self.assertIn("private-reasoning", original.as_message()["content"])
        for invalid in ('<think>private-reasoning', '<think>x</think>',
                        '<think>x</think>'+body+'extra',
                        '<think>x</think><think>y</think>'+body,
                        '<think>x</think>{"text":"Да","intent":"propose_changes","changes":{"state.status":"disbursed"}}'):
            with self.subTest(content=invalid), self.assertRaises(AssistantResponseError):
                ModelAssistant.parse_reply(Reply(invalid, "stop"), log_errors=False)

    def test_null_question_is_absent_and_real_question_is_preserved(self):
        for value in (None, "null", " NULL ", "", "  "):
            with self.subTest(value=value):
                reply = AssistantReply(text="Ответ", intent="answer_question", question=value)
                self.assertIsNone(reply.model_dump()["question"])
        reply = AssistantReply(text="Ответ", intent="ask_clarification", question=" Какой срок? ")
        self.assertEqual(reply.question, "Какой срок?")

    def test_existing_client_sends_history_and_parses_structured_response(self):
        captured = []
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                captured.append((self.path,json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                content = {"text":"Какой срок?","intent":"ask_clarification","changes":{},"question":"Какой срок?"}
                body = json.dumps({"choices":[{"message":{"content":json.dumps(content,ensure_ascii=False)},"finish_reason":"stop"}]}).encode()
                self.send_response(200);self.send_header("Content-Type","application/json");self.end_headers();self.wfile.write(body)
            def log_message(self,*args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1",0),Handler)
        thread = Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with patch.dict(os.environ,{"LLM_API_BASE_URL":f"http://127.0.0.1:{server.server_port}/v1","LLM_MODEL":"test","HTTP_TIMEOUT_SECONDS":"3"}):
                model = ModelAssistant()
            messages = [{"role":"user","content":"Нужен кредит"}]
            self.assertEqual(model.reply(messages).intent,"ask_clarification")
            self.assertEqual(captured[0][0],"/v1/chat/completions")
            self.assertEqual(captured[0][1]["messages"],messages)
            self.assertEqual(captured[0][1]["model"],"test")
            response_format = captured[0][1]["response_format"]
            self.assertEqual(response_format["type"], "json_schema")
            self.assertTrue(response_format["json_schema"]["strict"])
            self.assertEqual(response_format["json_schema"]["schema"], assistant_response_schema())
            self.assertNotIn("maxLength", json.dumps(response_format))
            self.assertEqual(AssistantReply.model_json_schema()["properties"]["text"]["maxLength"], 12000)
        finally:
            server.shutdown();thread.join();server.server_close()

    def test_malformed_json_or_unsafe_changes_are_never_repaired_or_applied(self):
        with patch.dict(os.environ, {"LLM_MODEL": "test"}):
            model = ModelAssistant()
        for content in (
            '{"text":"Здравствуйте",""intent":"answer_question","changes":{}}',
            '{"text":"Одобрено","intent":"propose_changes","changes":{"state.status":"disbursed"}}',
        ):
            with self.subTest(content=content), patch.object(model.client, "_request", return_value={
                "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
            }):
                with self.assertRaises(AssistantResponseError):
                    model.reply([{"role": "user", "content": "Здравствуйте"}])


if __name__ == "__main__":
    unittest.main()
