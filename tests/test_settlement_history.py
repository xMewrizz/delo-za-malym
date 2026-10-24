from datetime import date
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from backend.portfolio import cash_disbursed
from scripts.prepare_demo_cabinet import Showcase


class SettlementHistoryTests(unittest.TestCase):
    def test_populated_demo_movements_reconcile_without_double_counting_supplier_or_refinancing(self):
        with TemporaryDirectory() as directory:
            showcase=Showcase(Path(directory)/"showcase.db",date(2026,10,24))
            showcase.build()
            process=showcase.process
            result=process.calendar()
            account=result["settlement_account"]
            events=account["events"]
            self.assertEqual(account["balance"],process.profile()["financials"]["cash_balance"])
            self.assertTrue(any(event["direction"]=="inflow" for event in events))
            self.assertTrue(any(event["direction"]=="outflow" for event in events))
            net=sum((Decimal(e["amount"])*(1 if e["direction"]=="inflow" else -1) for e in events),Decimal(0))
            self.assertEqual(net,cash_disbursed(process.store.list(),process.store.payments()))
            self.assertEqual(len(events),len({event["event_id"] for event in events}))
            for receipt in process.store.payments():
                matching=[event for event in events if (event.get("supplier_payment") or {}).get("payment_id")==receipt["payment_id"]]
                self.assertEqual(len(matching),1)
                self.assertEqual(matching[0]["amount"],receipt["request"]["amount"])
                self.assertEqual(matching[0]["direction"],"outflow")
            self.assertFalse(any("рефинанс" in e["title"].lower() for e in events))
