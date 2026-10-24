from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient
from backend.main import create_app
from backend.assistant import AssistantReply


class DraftDeletionTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.app = create_app(Path(self.directory.name) / "test.sqlite3", clock=lambda: datetime.fromisoformat("2026-10-25T12:00:00+03:00"))
        self.client = TestClient(self.app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def create(self):
        response = self.client.post("/api/demo/scenarios/working_capital_loan/01_approved")
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def remove(self, view, **fields):
        return self.client.request("DELETE", f"/api/applications/{view['application']['application_id']}", json={"base_application_version": view["application"]["application_version"], "confirmed": True, **fields})

    def test_deletes_only_the_target_draft_and_its_related_chat_and_document(self):
        draft, other = self.create(), self.create()
        identifier, other_id = draft["application"]["application_id"], other["application"]["application_id"]
        chat = self.client.post("/api/chats", json={"application_id": identifier}).json()["chat"]["chat_id"]
        other_chat = self.client.post("/api/chats", json={"application_id": other_id}).json()["chat"]["chat_id"]
        store = self.app.state.process.store
        with store.connect(write=True) as connection:
            connection.execute("INSERT INTO documents VALUES (?, ?, ?)", ("draft-doc", identifier, b"draft"))
            connection.execute("INSERT INTO documents VALUES (?, ?, ?)", ("other-doc", other_id, b"keep"))
        before = self.client.get("/api/profile").json()["financials"]
        response = self.remove(draft)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"application_id": identifier, "deleted": True})
        self.assertEqual([item["application_id"] for item in self.client.get("/api/applications").json()], [other_id])
        self.assertEqual(self.client.get(f"/api/applications/{identifier}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/chats/{chat}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/chats/{other_chat}").status_code, 200)
        self.assertEqual(self.client.get("/api/profile").json()["financials"], before)
        with store.connect() as connection:
            self.assertEqual(connection.execute("SELECT document_id FROM documents").fetchall(), [("other-doc",)])
        self.assertEqual(self.remove(draft).status_code, 404)

    def test_requires_confirmation_and_current_version(self):
        draft = self.create()
        for body in ({"confirmed": False}, {"base_application_version": 2}):
            response = self.remove(draft, **body)
            self.assertEqual(response.status_code, 422 if "confirmed" in body else 409)
        self.assertEqual(self.client.get(f"/api/applications/{draft['application']['application_id']}").status_code, 200)

    def test_refuses_submitted_and_issued_applications(self):
        draft = self.create()
        identifier = draft["application"]["application_id"]
        result = self.client.post(f"/api/applications/{identifier}/submit", json={"base_application_version": 1, "confirmed": True})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.remove(result.json()).status_code, 409)
        store = self.app.state.process.store
        for protected in ("signature", "completion"):
            with self.subTest(protected=protected):
                with store.connect(write=True) as connection:
                    record = store.get(connection, identifier)
                    record["state"]["status"] = "draft"
                    record["signature"] = None
                    record["completion"] = None
                    record[protected] = {"operation_id": "protected"}
                    store.save(connection, record)
                self.assertEqual(self.remove(draft).status_code, 409)

    def test_accepts_cross_origin_delete_preflight(self):
        response = self.client.options("/api/applications/example", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "DELETE"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("DELETE", response.headers["access-control-allow-methods"])

    def test_inflight_model_reply_does_not_recreate_a_deleted_draft(self):
        started, release = Event(), Event()
        class WaitingAssistant:
            mode, model = "model", "test-blocking"
            def reply(self, messages):
                started.set()
                release.wait(5)
                return AssistantReply(text="Можно уточнить сумму и срок.", intent="answer_question")
        self.app.state.chats.assistant = WaitingAssistant()
        draft = self.create()
        identifier = draft["application"]["application_id"]
        chat = self.client.post("/api/chats", json={"application_id": identifier}).json()["chat"]["chat_id"]
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(self.client.post, f"/api/chats/{chat}/messages", json={"base_chat_version": 1, "text": "Здравствуйте", "request_id": str(uuid4())})
            try:
                self.assertTrue(started.wait(3))
                self.assertEqual(self.remove(draft).status_code, 200)
            finally:
                release.set()
            self.assertEqual(pending.result(timeout=5).status_code, 404)
        self.assertEqual(self.client.get(f"/api/applications/{identifier}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/chats/{chat}").status_code, 404)


if __name__ == "__main__":
    unittest.main()
