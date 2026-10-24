import time
import unittest
from fastapi.testclient import TestClient
from backend.main import create_app
from tests import test_portfolio as fixture

class DemoBankTimingTests(unittest.TestCase):
    def test_simulated_sync_and_assessment_have_configured_delay_and_no_fake_balance_updates(self):
        case=fixture.PortfolioTests();case.setUp()
        try:
            with TestClient(create_app(case.path,clock=lambda:case.now,demo_delay_seconds=.04)) as client:
                before=client.get("/api/profile").json()
                started=time.monotonic(); sync=client.post("/api/profile/sync")
                self.assertGreaterEqual(time.monotonic()-started,.035)
                self.assertEqual(sync.status_code,200,sync.text)
                self.assertEqual(sync.json()["financials"],before["financials"])
                self.assertEqual(sync.json()["data_source"]["kind"],"simulated_bank")
                created=case.create();identifier=created["application"]["application_id"]
                started=time.monotonic(); result=client.post(f"/api/applications/{identifier}/submit",json={"base_application_version":1,"confirmed":True})
                self.assertGreaterEqual(time.monotonic()-started,.035)
                self.assertEqual(result.status_code,200,result.text)
                self.assertEqual(result.json()["state"]["status"],"offers_ready")
                self.assertTrue(all(offer.get("penalty_terms") for offer in result.json()["result"]["assessment"]["offers"]))
                self.assertEqual(client.get("/api/profile").json()["financials"],before["financials"])
        finally: case.tearDown()
