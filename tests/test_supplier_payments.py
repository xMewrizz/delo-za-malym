from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from backend.main import create_app
from backend.invoice_pdf import fields_from_pages, supplier_fields
from tests import test_overdraft_operations


def valid_account(bik="044525225"):
    for digit in range(10):
        account = "40702810" + str(digit) + "00000000001"
        if sum(int(d) * [7, 1, 3][i % 3] for i, d in enumerate(bik[-3:] + account)) % 10 == 0:
            return account


class SupplierPaymentTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.path = Path(self.directory.name) / "bank.sqlite3"
        self.now = datetime.fromisoformat("2026-10-23T12:00:00+03:00")
        self.client = TestClient(create_app(self.path, clock=lambda: self.now)).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def body(self, amount="70000.00"):
        return {"base_account_version": self.client.get("/api/account/payments").json()["account_version"],
                "recipient_name": "ООО «Поставка»", "recipient_inn": "7707083893", "recipient_account": valid_account(),
                "recipient_bik": "044525225", "amount": amount, "purpose": "Оплата товара по счёту № 148. Без НДС.", "invoice_number": "148"}

    def confirmed(self, body):
        return {**body, "request_id": str(uuid4()), "calculated_on": self.now.date().isoformat(), "confirmed": True}

    def cash(self):
        return self.client.get("/api/profile").json()["financials"]["cash_balance"]

    def test_own_money_without_overdraft_preview_and_receipt_history(self):
        body = self.body()
        quote = self.client.post("/api/account/payments/preview", json=body)
        self.assertEqual(quote.status_code, 200, quote.text)
        self.assertTrue(quote.json()["can_pay"])
        self.assertEqual(quote.json()["overdraft_used"], "0.00")
        self.assertEqual(self.cash(), "300000.00")
        request = self.confirmed(body)
        response = self.client.post("/api/account/payments", json=request)
        self.assertEqual(response.status_code, 200, response.text)
        receipt = response.json()
        self.assertEqual(receipt["request"]["recipient_account"], body["recipient_account"])
        self.assertEqual(self.cash(), "230000.00")
        self.assertEqual(self.client.post("/api/account/payments", json=request).json(), receipt)
        self.assertEqual(self.cash(), "230000.00")
        calendar = self.client.get("/api/calendar").json()
        events = [event for event in calendar["events"] if event["kind"] == "supplier_payment"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["supplier_payment"]["request"], receipt["request"])
        self.assertFalse(events[0]["forecast"])
        created = self.client.post("/api/applications", json={}).json()
        self.assertEqual(created["application"]["financials"]["cash_balance"], "230000.00")
        self.assertEqual(len(self.client.get("/api/account/payments").json()["payments"]), 1)

    def test_insufficient_cash_is_a_non_mutating_financing_path(self):
        body = self.body("400000.00")
        quote = self.client.post("/api/account/payments/preview", json=body).json()
        self.assertFalse(quote["can_pay"])
        self.assertEqual(quote["shortfall"], "100000.00")
        self.assertEqual(self.client.post("/api/account/payments", json=self.confirmed(body)).status_code, 422)
        self.assertEqual(self.cash(), "300000.00")
        self.assertEqual(self.client.get("/api/account/payments").json()["payments"], [])

    def test_shortfall_uses_connected_overdraft_and_receipts_repay_it(self):
        record = test_overdraft_operations.OverdraftOperationsTests.issue_overdraft(self)
        identifier = record["application"]["application_id"]
        body = self.body("400000.00")
        quote = self.client.post("/api/account/payments/preview", json=body).json()
        self.assertTrue(quote["can_pay"])
        self.assertEqual(quote["own_money"], "300000.00")
        self.assertEqual(quote["overdraft_used"], "100000.00")
        self.assertGreater(Decimal(quote["overdraft_daily_interest"]), 0)
        self.assertEqual(quote["overdraft_repay_by"], "2026-12-22")
        request = self.confirmed(body)
        response = self.client.post("/api/account/payments", json=request)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.cash(), "0.00")
        state = self.client.get(f"/api/applications/{identifier}/overdraft").json()
        self.assertEqual(state["principal"], "100000.00")
        self.assertEqual(state["available_limit"], "50000.00")
        events = self.client.get("/api/calendar").json()["events"]
        self.assertEqual(len([item for item in events if item["kind"] == "supplier_payment"]), 1)
        self.assertEqual(len([item for item in events if item["kind"] == "overdraft_expense"]), 0)
        self.assertEqual(len([item for item in events if item["kind"] == "overdraft_draw"]), 1)
        self.now += timedelta(days=1)
        self.assertGreater(Decimal(self.client.get(f"/api/applications/{identifier}/overdraft").json()["accrued_interest"]), 0)
        receipt = {"kind": "receipt", "purpose": "revenue", "amount": "150000.00", "base_account_version": self.client.get(f"/api/applications/{identifier}/overdraft").json()["account_version"]}
        paid = self.client.post(f"/api/applications/{identifier}/overdraft/operations", json=self.confirmed(receipt))
        self.assertEqual(paid.status_code, 200, paid.text)
        self.assertEqual(paid.json()["state"]["principal"], "0.00")
        self.assertLess(Decimal(self.cash()), Decimal("50000"))
        self.assertEqual(self.client.post("/api/account/payments", json=request).json(), response.json())

    def test_oversized_payment_with_overdraft_cannot_be_confirmed(self):
        test_overdraft_operations.OverdraftOperationsTests.issue_overdraft(self)
        body = self.body("700000.00")
        quote = self.client.post("/api/account/payments/preview", json=body).json()
        self.assertEqual(quote["shortfall"], "250000.00")
        self.assertFalse(quote["can_pay"])
        self.assertEqual(self.client.post("/api/account/payments", json=self.confirmed(body)).status_code, 422)

    def test_existing_overdraft_debt_keeps_deadline_and_daily_cost_includes_all_debt(self):
        record = test_overdraft_operations.OverdraftOperationsTests.issue_overdraft(self)
        first = self.client.post("/api/account/payments", json=self.confirmed(self.body("400000.00")))
        self.assertEqual(first.status_code, 200, first.text)
        self.now += timedelta(days=40)
        body = {**self.body("20000.00"), "overdraft_application_id": record["application"]["application_id"]}
        quote = self.client.post("/api/account/payments/preview", json=body).json()
        self.assertEqual(quote["overdraft_daily_interest"], "78.90")
        self.assertEqual(quote["overdraft_repay_by"], "2026-12-22")
        self.assertEqual(quote["upcoming_total"], "124208.22")
        self.assertEqual(self.cash(), "0.00")

    def test_concurrent_confirmations_are_idempotent_and_stale_quote_fails(self):
        body = self.body()
        request = self.confirmed(body)
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: self.client.post("/api/account/payments", json=request), range(2)))
        self.assertEqual([item.status_code for item in responses], [200, 200])
        self.assertEqual(responses[0].json(), responses[1].json())
        self.assertEqual(self.cash(), "230000.00")
        stale = self.client.post("/api/account/payments", json=self.confirmed(body))
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["detail"]["code"], "account_version_conflict")
        changed = {**request, "recipient_name": "Другой получатель"}
        self.assertEqual(self.client.post("/api/account/payments", json=changed).status_code, 409)

    def test_requisites_confirmation_and_quote_date_are_required(self):
        body = self.body()
        for key, value in (("recipient_inn", "0000000000"), ("recipient_bik", "000000000"), ("recipient_account", "40702810000000000001"), ("recipient_name", "  "), ("amount", "0.00"), ("purpose", "     ")):
            response = self.client.post("/api/account/payments/preview", json={**body, key: value})
            self.assertEqual(response.status_code, 422, (key, response.text))
        self.assertEqual(self.client.post("/api/account/payments", json={**self.confirmed(body), "confirmed": False}).status_code, 422)
        request = self.confirmed(body)
        self.now += timedelta(days=1)
        self.assertEqual(self.client.post("/api/account/payments", json=request).status_code, 409)
        self.assertEqual(self.cash(), "300000.00")

    def test_pdf_only_prefills_unambiguous_fields(self):
        pages = [{"page": 1, "text": f"Счёт на оплату № 148\nПоставщик: ООО Поставка\nИНН: 7707083893\nР/с: {valid_account()}\nБИК: 044525225\nИтого к оплате: 70 000,00\nНазначение платежа: Оплата товара без НДС"}]
        result = supplier_fields({"pages": pages, "extracted": fields_from_pages(pages)})
        self.assertEqual(result["fields"]["amount"], "70000.00")
        self.assertEqual(result["fields"]["recipient_name"], "ООО Поставка")
        self.assertEqual(result["fields"]["recipient_account"], valid_account())
        pages[0]["text"] += "\nПокупатель: ООО Север\nИНН: 1234567890"
        result = supplier_fields({"pages": pages, "extracted": fields_from_pages(pages)})
        self.assertNotIn("recipient_inn", result["fields"])
        self.assertTrue(result["review_required"])

    def test_pdf_upload_prefills_without_creating_a_payment(self):
        response = self.client.post("/api/account/invoice", content=Path("contracts/documents/supplier-invoice.pdf").read_bytes(), headers={"Content-Type": "application/pdf"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["fields"]["amount"], "450000.00")
        self.assertTrue(response.json()["review_required"])
        invalid = self.client.post("/api/account/invoice", content=b"not a PDF")
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(self.cash(), "300000.00")
        self.assertEqual(self.client.get("/api/account/payments").json()["payments"], [])


if __name__ == "__main__":
    unittest.main()
