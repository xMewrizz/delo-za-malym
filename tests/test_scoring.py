from dataclasses import replace
from datetime import date
from decimal import Decimal
import json
from pathlib import Path
import unittest

from credit_engine import calculate_financial_metrics, calculate_risk_score


D = Decimal


class RiskScoringTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[1]
        application = json.loads((root / "contracts/examples.json").read_text(encoding="utf-8"))["application"]
        self.metrics = calculate_financial_metrics(application["financials"], date(2026, 10, 20)).metrics

    def test_good_history_with_stable_and_diverse_inflow(self):
        result = calculate_risk_score(self.metrics, "good")
        self.assertEqual(result.status, "calculated")
        self.assertEqual(result.score, 100)
        self.assertEqual(result.risk_grade, "low")
        self.assertEqual([component.points for component in result.components], [50, 30, 20])

    def test_absent_history_is_not_good_history(self):
        result = calculate_risk_score(self.metrics, "no_history")
        self.assertEqual(result.score, 75)
        self.assertEqual(result.risk_grade, "medium")
        missing = calculate_risk_score(self.metrics, None)
        self.assertEqual(missing.status, "needs_information")
        self.assertIsNone(missing.risk_grade)

    def test_minor_and_serious_delinquency(self):
        minor = calculate_risk_score(self.metrics, "minor_delinquency")
        self.assertEqual((minor.score, minor.risk_grade), (65, "medium"))
        serious = calculate_risk_score(self.metrics, "serious_delinquency")
        self.assertEqual(serious.score, 50)
        self.assertEqual(serious.risk_grade, "high")

    def test_stability_boundaries(self):
        for cv, points in (("0.10", 30), ("0.100001", 20), ("0.30", 20),
                           ("0.300001", 10), ("0.60", 10), ("0.600001", 0)):
            with self.subTest(cv=cv):
                result = calculate_risk_score(replace(self.metrics, inflow_cv=D(cv)), "good")
                self.assertEqual(result.components[1].points, points)

    def test_concentration_boundaries(self):
        for share, points in (("0.25", 20), ("0.250001", 10), ("0.50", 10),
                              ("0.500001", 5), ("0.75", 5), ("0.750001", 0)):
            with self.subTest(share=share):
                result = calculate_risk_score(replace(self.metrics, largest_buyer_share=D(share)), "good")
                self.assertEqual(result.components[2].points, points)

    def test_grade_thresholds(self):
        for cv, share, category, score, grade in (
            ("0.1", "0.8", "good", 80, "low"),
            ("0.2", "0.6", "good", 75, "medium"),
            ("0.7", "0.8", "good", 50, "medium"),
            ("0.7", "0.8", "no_history", 25, "high"),
        ):
            with self.subTest(score=score):
                metrics = replace(self.metrics, inflow_cv=D(cv), largest_buyer_share=D(share))
                result = calculate_risk_score(metrics, category)
                self.assertEqual((result.score, result.risk_grade), (score, grade))

    def test_unknown_fields_do_not_receive_points(self):
        metrics = replace(self.metrics, largest_buyer_share=None, inflow_cv=None)
        result = calculate_risk_score(metrics, None)
        self.assertEqual(result.status, "needs_information")
        self.assertIsNone(result.score)
        self.assertEqual(len(result.issues), 3)

    def test_invalid_history_category(self):
        for value in ("unknown", True, [], {}):
            with self.subTest(value=value):
                self.assertEqual(calculate_risk_score(self.metrics, value).status, "invalid_data")
