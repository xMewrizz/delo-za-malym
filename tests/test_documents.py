from copy import deepcopy
from datetime import datetime
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from pypdf import PdfWriter

from backend.assistant import DemoAssistant
from backend.invoice_pdf import fields_from_pages
from backend.main import create_app
from backend.sources import operation_path

PDF = Path("contracts/documents/supplier-invoice.pdf").read_bytes()


class InvoiceExtractionTests(unittest.TestCase):
    def test_total_does_not_confuse_vat_unit_price_or_issue_date_with_payment(self):
        result = fields_from_pages([{"page": 1, "text": "Счёт №119 от 22.10.2026\nЦена: 4 500,00 руб.\nИтого к оплате: 450 000,00 руб.\nВ том числе НДС: 75 000,00\nОплатить до: 05.11.2026"}])
        self.assertEqual([item["value"] for item in result["amount"]], ["450000.00"])
        self.assertEqual([item["value"] for item in result["due_date"]], ["2026-11-05"])

    def test_multiple_totals_are_preserved_for_review_and_missing_date_is_not_invented(self):
        result = fields_from_pages([{"page": 1, "text": "Итого: 100 000,00\nВсего к оплате:\n120 000,00 руб.\nДата счёта: 22.10.2026"}])
        self.assertEqual([item["value"] for item in result["amount"]], ["100000.00", "120000.00"])
        self.assertEqual(result["due_date"], [])
        self.assertEqual(result["amount"][1]["line"], 2)


class InvoiceApiTests(unittest.TestCase):
    def setUp(self):
        from backend import demo
        from unittest.mock import patch
        original_profile = demo.profile
        fixture = patch("backend.demo.profile", side_effect=lambda now: original_profile(now, include_sample_loan=True))
        fixture.start()
        self.addCleanup(fixture.stop)
        self.directory = TemporaryDirectory()
        self.path = Path(self.directory.name) / "test.sqlite3"
        self.app = create_app(self.path, assistant=DemoAssistant(), clock=lambda: datetime.fromisoformat("2026-10-22T12:00:00+03:00"))
        self.client = TestClient(self.app).__enter__()
        self.record = self.client.post("/api/applications", json={}).json()
        self.id = self.record["application"]["application_id"]

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def upload(self, content=PDF, version=None):
        return self.client.post(f"/api/applications/{self.id}/documents", params={"filename": "счёт.pdf", "base_application_version": version or self.record["application"]["application_version"]},
                                content=content, headers={"Content-Type": "application/pdf"})

    def body(self, **extra):
        return {"base_application_version": self.record["application"]["application_version"], "document_revision": self.record["documents"][0]["revision"],
                "confirmed": True, "target": "loan_amount", "amount": "450000.00", **extra}

    def test_upload_keeps_original_and_source_without_changing_business_data(self):
        original = deepcopy(self.record["application"])
        response = self.upload()
        self.assertEqual(response.status_code, 200, response.text)
        self.record = response.json()
        document = self.record["documents"][0]
        source = document["extracted"]["amount"][0]
        self.assertEqual(source["value"], "450000.00")
        self.assertIn(source["quote"], document["pages"][0]["text"])
        self.assertEqual(self.record["application"], original)
        self.assertEqual(len(self.upload().json()["documents"]), 1)
        download = self.client.get(f"/api/applications/{self.id}/documents/{document['document_id']}/file")
        self.assertEqual(download.content, PDF)
        self.assertIn("attachment", download.headers["content-disposition"])
        with TestClient(create_app(self.path, assistant=DemoAssistant())) as restarted:
            self.assertEqual(restarted.get(f"/api/applications/{self.id}/documents/{document['document_id']}/file").content, PDF)
        other = self.client.post("/api/applications", json={}).json()["application"]["application_id"]
        self.assertEqual(self.client.get(f"/api/applications/{other}/documents/{document['document_id']}/file").status_code, 404)

    def test_different_credit_amount_requires_explicit_resolution(self):
        self.record = self.client.patch(f"/api/applications/{self.id}", json={"base_application_version": 1, "changes": {"need.requested_amount": "500000.00"}}).json()
        self.record = self.upload().json()
        identifier = self.record["documents"][0]["document_id"]
        path = f"/api/applications/{self.id}/documents/{identifier}/use"
        self.assertEqual(self.client.post(path, json=self.body()).status_code, 409)
        self.assertEqual(self.client.get(f"/api/applications/{self.id}").json()["application"]["need"]["requested_amount"], "500000.00")
        response = self.client.post(path, json=self.body(replace_existing=True))
        self.assertEqual(response.status_code, 200, response.text)
        updated = response.json()
        self.assertEqual(updated["application"]["need"]["requested_amount"], "450000.00")
        self.assertEqual(updated["application"]["financials"], self.record["application"]["financials"])
        self.assertEqual(updated["field_sources"]["need.requested_amount"]["original"]["page"], 1)
        self.assertEqual(self.client.post(path, json=self.body(replace_existing=True)).status_code, 409)

    def test_invoice_as_evidence_does_not_replace_credit_request(self):
        self.record = self.upload().json()
        response = self.client.post(f"/api/applications/{self.id}/documents/{self.record['documents'][0]['document_id']}/use", json=self.body(target="evidence"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["application"]["application_version"], 1)
        self.assertIsNone(response.json()["application"]["need"]["requested_amount"])

    def test_dialog_payment_conflict_remains_proposed_and_keeps_source_after_clarification(self):
        chat = self.client.post("/api/chats", json={"application_id": self.id}).json()
        chat_path = "/api/chats/" + chat["chat"]["chat_id"]
        def answer(**fields):
            nonlocal chat
            response = self.client.post(chat_path + "/clarifications/" + chat["clarification"]["question_id"] + "/answer", json={
                "base_application_version": 1, "base_chat_version": chat["chat"]["chat_version"], "request_id": str(uuid4()), **fields})
            self.assertEqual(response.status_code, 200, response.text)
            chat = response.json()
        for fields in [{"choice_id": "cash_gap"}, {"value": "450000"}, {"choice_id": "tomorrow"}, {"value": "500000"}, {"choice_id": "week"}, {"choice_id": "debt_reviewed"}]:
            answer(**fields)
        self.record = self.upload().json()
        identifier = self.record["documents"][0]["document_id"]
        pending = chat["chat"]["messages"][-1]["proposal"]
        expense_id = next(row["transaction_id"] for row in pending["changes"]["product_details.overdraft"]["transactions"] if row["direction"] == "outflow")
        body = self.body(target="planned_expense", transaction_id=expense_id, amount="460000.00", due_date="2026-10-23", base_chat_version=chat["chat"]["chat_version"])
        path = chat_path + f"/documents/{identifier}/use"
        self.assertEqual(self.client.post(path, json=body).status_code, 409)
        response = self.client.post(path, json={**body, "replace_existing": True})
        self.assertEqual(response.status_code, 200, response.text)
        chat = response.json()
        self.assertEqual(chat["record"]["application"]["application_version"], 1)
        self.assertEqual(chat["record"]["application"].get("product_details", {}), {})
        answer(choice_id="debt_reviewed")
        proposal = chat["chat"]["messages"][-1]["proposal"]
        response = self.client.post(chat_path + f"/proposals/{proposal['proposal_id']}/confirm", json={"base_chat_version": chat["chat"]["chat_version"], "confirmed": True})
        self.assertEqual(response.status_code, 200, response.text)
        record = response.json()["record"]
        source = record["field_sources"][operation_path(expense_id, "amount")]
        self.assertEqual(source["value"], "460000.00")
        self.assertTrue(source["user_corrected"])
        self.assertEqual(source["original"]["value"], "450000.00")
        self.assertEqual(record["application"]["financials"]["cash_balance"], "300000.00")

    def test_scans_encrypted_and_malformed_files_fail_without_saving(self):
        for encrypted in (False, True):
            writer = PdfWriter()
            writer.add_blank_page(width=100, height=100)
            if encrypted:
                writer.encrypt("password")
            stream = BytesIO(); writer.write(stream)
            response = self.upload(stream.getvalue())
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["detail"]["code"], "encrypted_pdf" if encrypted else "scan_not_supported")
        self.assertEqual(self.upload(b"%PDF-invalid").status_code, 422)
        self.assertEqual(self.upload(b"%PDF-" + b"x" * (2 * 1024 * 1024)).status_code, 413)
        self.assertEqual(self.client.get(f"/api/applications/{self.id}").json()["documents"], [])

    def test_invoice_payment_for_ordinary_loan_does_not_turn_it_into_overdraft(self):
        self.record = self.client.patch(f"/api/applications/{self.id}", json={"base_application_version": 1, "changes": {
            "need.purpose": "working_capital", "need.preferred_product": "working_capital_loan", "need.financing_pattern": "gradual_repayment",
            "need.requested_amount": "500000.00", "need.term_months": 12}}).json()
        self.record = self.upload().json()
        chat = self.client.post("/api/chats", json={"application_id": self.id}).json()
        chat_path = "/api/chats/" + chat["chat"]["chat_id"]
        response = self.client.post(chat_path + f"/documents/{self.record['documents'][0]['document_id']}/use", json=self.body(
            target="planned_expense", due_date="2026-10-23", base_chat_version=chat["chat"]["chat_version"]))
        self.assertEqual(response.status_code, 200, response.text)
        chat = response.json()
        self.assertTrue(chat["clarification"]["field"].endswith("existing_debt_payments"))
        chat = self.client.post(chat_path + "/clarifications/" + chat["clarification"]["question_id"] + "/answer", json={
            "base_application_version": 2, "base_chat_version": chat["chat"]["chat_version"], "request_id": str(uuid4()), "choice_id": "debt_reviewed"}).json()
        self.assertIsNone(chat["clarification"])
        proposal = chat["chat"]["messages"][-1]["proposal"]
        preview = self.client.post(chat_path + f"/proposals/{proposal['proposal_id']}/preview", json={"base_chat_version": chat["chat"]["chat_version"]})
        self.assertEqual(preview.status_code, 200, preview.text)
        self.assertEqual(preview.json()["result"]["product_id"], "working_capital_loan")
        response = self.client.post(chat_path + f"/proposals/{proposal['proposal_id']}/confirm", json={"base_chat_version": chat["chat"]["chat_version"], "confirmed": True})
        self.assertEqual(response.status_code, 200, response.text)
        record = response.json()["record"]
        self.assertEqual(record["application"]["need"]["requested_amount"], "500000.00")
        self.assertEqual(record["application"]["product_details"]["overdraft"]["transactions"][0]["amount"], "450000.00")
        self.assertEqual(record["explorations"][-1]["product_id"], "working_capital_loan")
