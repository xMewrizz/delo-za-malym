from copy import deepcopy
from datetime import datetime, date
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

from fastapi.testclient import TestClient
from backend.main import create_app
from scripts.demo_bootstrap import prepare


class DecisionTraceTests(unittest.TestCase):
    def test_trace_uses_exact_assessment_values_and_survives_restart(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "test.sqlite3"
            with TestClient(create_app(path)) as client:
                view = client.post("/api/demo/scenarios/working_capital_loan/01_approved").json()
                identifier = view["application"]["application_id"]
                view = client.post(f"/api/applications/{identifier}/submit", json={"base_application_version": 1, "confirmed": True}).json()
                result = view["result"]
                trace = deepcopy(result["decision_trace"])
                self.assertEqual([step["id"] for step in trace["steps"]], ["data", "risk", "capacity", "product", "result"])
                self.assertEqual(trace["assessment_id"], result["assessment"]["assessment_id"])
                self.assertEqual(trace["application_version"], view["application"]["application_version"])
                self.assertEqual(trace["steps"][1]["values"], result["scoring"])
                self.assertEqual(trace["steps"][2]["values"]["available_monthly_payment"], result["financial_metrics"]["available_monthly_payment"])
                self.assertEqual(trace["steps"][-1]["values"]["outcome"], result["assessment"]["outcome"])
            with TestClient(create_app(path)) as client:
                self.assertEqual(client.get(f"/api/applications/{identifier}").json()["result"]["decision_trace"], trace)

    def test_missing_information_never_fabricates_score_or_capacity(self):
        with TemporaryDirectory() as directory, TestClient(create_app(Path(directory) / "test.sqlite3")) as client:
            view = client.post("/api/demo/scenarios/working_capital_loan/04_needs_information").json()
            view = client.post(f'/api/applications/{view["application"]["application_id"]}/submit', json={"base_application_version":1,"confirmed":True}).json()
            trace = view["result"]["decision_trace"]
            self.assertEqual(trace["steps"][-1]["values"]["outcome"], "needs_information")
            self.assertTrue(trace["steps"][-1]["values"]["required_information"])
            self.assertFalse(trace["steps"][1]["values"].get("score"))

    def test_populated_demo_restarts_idempotently_and_explains_all_five_products(self):
        with TemporaryDirectory() as directory:
            db, manifest = Path(directory)/"demo.sqlite3", Path(directory)/"demo.json"
            first = prepare(db, manifest, date(2026,10,24))
            second = prepare(db, manifest, date(2026,10,25))
            self.assertEqual(first, second)
            self.assertEqual(first["summary"]["applications"], 10)
            with TestClient(create_app(db, clock=lambda: datetime.fromisoformat("2026-10-24T12:00:00+03:00"))) as client:
                products = set()
                for identifier in first["applications"].values():
                    view = client.get(f"/api/applications/{identifier}").json()
                    if view.get("result") and view["result"].get("decision_trace"):
                        trace = view["result"]["decision_trace"]
                        products.add(trace["product_id"])
                        self.assertEqual(trace["assessment_id"], view["result"]["assessment"]["assessment_id"])
                        json.dumps(trace, allow_nan=False)
                self.assertEqual(products, {"working_capital_loan", "overdraft", "revolving_credit_line", "refinancing", "investment_loan"})
