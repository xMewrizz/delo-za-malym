"""Связка протокола провайдера, инструментов и сохранённого кабинета."""
from collections import deque
from copy import deepcopy
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event, Thread
from concurrent.futures import ThreadPoolExecutor
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from backend.assistant import AssistantReply, ModelAssistant
from backend.chat_tools import CabinetTools
from backend.main import create_app
from scr.delo_za_malyn.Models.Llm.client import Reply, ToolCall


class IntegratedChatTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.now = datetime.fromisoformat("2026-10-21T12:00:00+03:00")
        with patch.dict(os.environ, {"LLM_MODEL":"test", "AGENT_TOOLS_ENABLED":"true", "TAVILY_API_KEY":""}):
            self.model = ModelAssistant()
        self.model.client = Mock()
        self.app = create_app(Path(self.directory.name)/"test.db", clock=lambda:self.now, assistant=self.model)
        self.client = self.enterContext(TestClient(self.app))
        self.record = self.client.post("/api/demo/scenarios/working_capital_loan/01_approved").json()
        self.view = self.client.post("/api/chats",json={"application_id":self.record["application"]["application_id"]}).json()
        self.path = "/api/chats/"+self.view["chat"]["chat_id"]

    def send(self,text="Покажи несколько вариантов"):
        return self.client.post(self.path+"/messages",json={"base_chat_version":self.view["chat"]["chat_version"],"request_id":str(uuid4()),"text":text})

    def comparison(self, args=None):
        self.model.client.chat.side_effect = [
            Reply("","tool_calls",(ToolCall("c1","compare_options",json.dumps(args or {"product_id":"working_capital_loan","preferences":{"maximum_monthly_payment":"30000.00"}})),)),
            Reply('{"text":"Расчёт готов. Сравните условия в карточках.","intent":"answer_question","changes":{}}',"stop")]

    def test_future_operations_are_collected_in_one_structured_call_without_calculating_saved_plan(self):
        self.model.client.chat.return_value = Reply(json.dumps({"text":"Проверьте будущие операции.",
            "changes":{}, "overdraft_plan":{"transactions":[
                {"transaction_id":"payment","direction":"outflow","amount":"450000.00","date":"2026-10-22"},
                {"transaction_id":"receipt","direction":"inflow","amount":"500000.00","date":"2026-10-28"}]}}), "stop")
        response = self.send("Завтра нужно оплатить поставщику 450 тысяч, через неделю покупатель перечислит 500 тысяч")
        self.assertEqual(response.status_code, 200, response.text)
        view = response.json()
        self.assertEqual(self.model.client.chat.call_count, 1)
        self.assertNotIn("tools", self.model.client.chat.call_args.kwargs)
        self.assertIn("response_format", self.model.client.chat.call_args.kwargs)
        self.assertEqual(view["record"]["application"], self.record["application"])
        self.assertEqual(view["record"]["explorations"], [])
        self.assertIn("product_details.overdraft", view["chat"]["messages"][-1]["proposal"]["changes"])

    def test_native_comparison_is_saved_once_with_schedule_and_can_be_applied(self):
        self.comparison()
        response=self.send()
        self.assertEqual(response.status_code,200,response.text)
        view=response.json()
        self.assertEqual(view["record"]["application"],self.record["application"])
        self.assertEqual(len(view["record"]["explorations"]),1)
        exploration=view["record"]["explorations"][0]
        self.assertEqual([x["term_months"] for x in exploration["result"]["options"]],[24,36])
        self.assertEqual(len(exploration["result"]["options"][0]["schedule"]),24)
        tool=view["chat"]["messages"][-1]["tools"][0]
        self.assertNotIn("schedule",json.dumps(tool))
        self.assertEqual(tool["exploration_id"],exploration["exploration_id"])
        option=exploration["result"]["options"][0]
        path="/api/applications/"+self.record["application"]["application_id"]
        applied=self.client.post(path+"/explorations/"+exploration["exploration_id"]+"/apply",json={"base_application_version":1,"confirmed":True,"option_id":option["option_id"]})
        self.assertEqual(applied.status_code,200,applied.text)
        self.assertEqual(applied.json()["application"]["need"]["term_months"],24)
        self.assertEqual(applied.json()["state"]["status"],"draft")

    def test_failed_native_comparison_does_not_trigger_loan_fallback(self):
        self.record=self.client.post("/api/demo/scenarios/overdraft/01_overdraft_approved").json()
        self.view=self.client.post("/api/chats",json={"application_id":self.record["application"]["application_id"]}).json()
        self.path="/api/chats/"+self.view["chat"]["chat_id"]
        self.model.client.chat.side_effect = [
            Reply("","tool_calls",(ToolCall("c1","compare_options",'{"product_id":"overdraft","delay":{"transaction_id":"missing","days":10}}'),)),
            Reply('{"text":"Нужно уточнение","intent":"compare_options","changes":{}}',"stop")]
        result=self.send().json()
        self.assertFalse(result["chat"]["messages"][-1]["tools"][0]["ok"])
        self.assertEqual(result["record"]["explorations"],[])
        self.assertEqual(result["record"]["application"],self.record["application"])

    def test_comparison_intent_keeps_overdraft_product_without_native_tools(self):
        class Simple:
            mode="model";model="test"
            def reply(self,messages):return AssistantReply(text="Расчёт плана",intent="compare_options")
        self.app.state.chats.assistant=Simple()
        record=self.client.post("/api/demo/scenarios/overdraft/01_overdraft_approved").json()
        self.view=self.client.post("/api/chats",json={"application_id":record["application"]["application_id"]}).json()
        self.path="/api/chats/"+self.view["chat"]["chat_id"]
        response=self.send()
        self.assertEqual(response.status_code,200,response.text)
        result=response.json()
        self.assertEqual(result["record"]["explorations"][-1]["product_id"],"overdraft")
        self.assertEqual(result["record"]["application"],record["application"])

    def test_rejected_comparison_arguments_cannot_inject_changes(self):
        self.comparison({"product_id":"working_capital_loan","confirmed":True})
        response=self.send()
        self.assertEqual(response.status_code,200,response.text)
        view=response.json()
        self.assertEqual(view["record"]["explorations"],[])
        self.assertFalse(view["chat"]["messages"][-1]["tools"][0]["ok"])
        self.assertEqual(view["record"]["application"],self.record["application"])

    def test_simultaneous_form_edit_rejects_stale_comparison_without_losing_form(self):
        replies=iter([Reply("","tool_calls",(ToolCall("c1","compare_options",'{"product_id":"working_capital_loan"}'),)), Reply('{"text":"Готово","intent":"answer_question","changes":{}}',"stop")])
        calls=0
        def answer(*args,**kwargs):
            nonlocal calls
            calls+=1
            if calls==2:
                self.app.state.process.patch(self.record["application"]["application_id"],1,{"need.term_months":18})
            return next(replies)
        self.model.client.chat.side_effect=answer
        response=self.send()
        self.assertEqual(response.status_code,409,response.text)
        current=self.client.get(self.path).json()
        self.assertEqual(current["record"]["application"]["need"]["term_months"],18)
        self.assertEqual(current["record"]["explorations"],[])
        self.assertEqual(current["chat"]["messages"],[])

    def test_overdraft_comparison_uses_existing_plan_and_keeps_original_need(self):
        record=self.client.post("/api/demo/scenarios/overdraft/01_overdraft_approved").json()
        self.view=self.client.post("/api/chats",json={"application_id":record["application"]["application_id"]}).json()
        self.path="/api/chats/"+self.view["chat"]["chat_id"]
        self.comparison({"product_id":"overdraft"})
        view=self.send().json()
        self.assertEqual(view["record"]["application"],record["application"])
        self.assertTrue(view["record"]["explorations"][-1]["result"]["daily"])
        self.assertNotIn("daily",view["chat"]["messages"][-1]["tools"][0]["result"])


class ProviderCompatibilityTests(unittest.TestCase):
    def test_custom_endpoint_key_model_json_object_and_rate_limit(self):
        captured=[]
        replies=deque([200,429])
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                captured.append((self.path,self.headers.get("Authorization"),json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                status=replies.popleft();self.send_response(status);self.send_header("Content-Type","application/json");self.end_headers()
                self.wfile.write(json.dumps({"choices":[{"finish_reason":"stop","message":{"content":'{"text":"Готово","intent":"answer_question","changes":{}}'}}]}).encode())
        server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
        thread=Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with patch.dict(os.environ,{"LLM_API_BASE_URL":f"http://127.0.0.1:{server.server_port}/custom/v1","LLM_API_KEY":"private-test-key","LLM_MODEL":"replaceable-model","LLM_RESPONSE_FORMAT":"json_object","HTTP_TIMEOUT_SECONDS":"3","AGENT_TOOLS_ENABLED":"false"}):
                model=ModelAssistant()
            with TemporaryDirectory() as directory,TestClient(create_app(Path(directory)/"test.db",assistant=model)) as client:
                view=client.post("/api/chats",json={}).json();path="/api/chats/"+view["chat"]["chat_id"]
                def send(version):return client.post(path+"/messages",json={"base_chat_version":version,"request_id":str(uuid4()),"text":"Проверка"})
                self.assertEqual(send(1).status_code,200)
                failed=send(2)
                self.assertEqual(failed.status_code,503)
                self.assertEqual(failed.json()["detail"]["code"],"assistant_rate_limited")
                self.assertEqual(len(client.get(path).json()["chat"]["messages"]),2)
                self.assertNotIn("private-test-key",failed.text)
            self.assertEqual(captured[0][0],"/custom/v1/chat/completions")
            self.assertEqual(captured[0][1],"Bearer private-test-key")
            self.assertEqual(captured[0][2]["model"],"replaceable-model")
            self.assertEqual(captured[0][2]["response_format"],{"type":"json_object"})
            self.assertEqual(len(captured),2)
        finally:
            server.shutdown();server.server_close();thread.join(2)

    def test_busy_model_does_not_block_forms_or_accept_unbounded_queue(self):
        entered,release=Event(),Event()
        class Slow:
            mode="model";model="test"
            def reply(self,messages):
                entered.set()
                if not release.wait(5):raise TimeoutError()
                return AssistantReply(text="Готово",intent="answer_question")
        with patch.dict(os.environ,{"CHAT_MAX_CONCURRENT_GENERATIONS":"1"}),TemporaryDirectory() as directory,TestClient(create_app(Path(directory)/"test.db",assistant=Slow())) as client:
            view=client.post("/api/chats",json={}).json();path="/api/chats/"+view["chat"]["chat_id"]
            body={"base_chat_version":1,"request_id":str(uuid4()),"text":"Запрос"}
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(client.post,path+"/messages",json=body)
                self.assertTrue(entered.wait(2))
                try:
                    busy=client.post(path+"/messages",json={**body,"request_id":str(uuid4())})
                    self.assertEqual(busy.status_code,503)
                    self.assertEqual(busy.json()["detail"]["code"],"assistant_busy")
                    edited=client.patch("/api/applications/"+view["chat"]["application_id"],json={"base_application_version":1,"changes":{"need.term_months":18}})
                    self.assertEqual(edited.status_code,200)
                finally:release.set()
                self.assertEqual(future.result(timeout=5).status_code,200)
            self.assertEqual(len(client.get(path).json()["chat"]["messages"]),2)


if __name__=="__main__":unittest.main()
