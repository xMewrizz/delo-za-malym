from datetime import timedelta
from unittest.mock import patch
import time
import unittest
from uuid import uuid4
from fastapi.testclient import TestClient
from backend.main import create_app
from tests import test_loan_payments as fixture

class PaymentWorkerTests(unittest.TestCase):
    def test_worker_executes_without_any_api_request_and_only_once(self):
        case = fixture.LoanPaymentTests(); case.setUp()
        try:
            case.opened()
            with patch.dict("os.environ", {"PAYMENT_WORKER_INTERVAL_SECONDS": "0.05"}):
                with TestClient(create_app(case.path, clock=lambda: case.now)) as client:
                    day = (case.now + timedelta(days=1)).date().isoformat()
                    response = client.post(case.url + "/payments", json={"amount": "70000.00", "base_loan_version": 1, "execution_date": day, "calculated_on": case.now.date().isoformat(), "request_id": str(uuid4()), "confirmed": True})
                    self.assertEqual(response.status_code, 200, response.text)
                    case.now += timedelta(days=1)
                    deadline = time.monotonic() + 3
                    while time.monotonic() < deadline:
                        # Read the store directly: middleware must not trigger execution.
                        with client.app.state.process.store.connect() as connection:
                            ledger = client.app.state.process.store.get(connection, case.id)["completion"]["servicing"]
                        if ledger["orders"][0]["status"] == "executed": break
                        time.sleep(.02)
                    self.assertEqual(ledger["orders"][0]["status"], "executed")
                    self.assertEqual(len(ledger["operations"]), 1)
                    self.assertEqual(client.app.state.process.profile()["financials"]["cash_balance"], "730000.00")
                    time.sleep(.15)
                    with client.app.state.process.store.connect() as connection:
                        ledger = client.app.state.process.store.get(connection, case.id)["completion"]["servicing"]
                    self.assertEqual(len(ledger["operations"]), 1)
        finally:
            case.tearDown()
