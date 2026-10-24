from datetime import datetime
from decimal import Decimal
import unittest

from backend.demo import profile, scenario_data


class DemoHistoryTests(unittest.TestCase):
    def test_seasonal_history_keeps_opening_cash_and_an_actual_negative_month(self):
        now = datetime.fromisoformat("2026-10-23T12:00:00+03:00")
        base, _ = scenario_data("working_capital_loan", "01_approved", now)
        result, simulator = profile(now)
        months = result["financials"]["monthly"]
        self.assertEqual([row["month"] for row in months], [row["month"] for row in base["financials"]["monthly"]])
        self.assertEqual(len(set(row["operating_inflow"] for row in months)), 6)
        self.assertEqual(sum(Decimal(row["operating_inflow"]) for row in months), Decimal("6000000"))
        self.assertEqual(min(Decimal(row["operating_inflow"]) - Decimal(row["operating_outflow"]) - Decimal(row["taxes"]) for row in months), Decimal("-38300"))
        self.assertEqual(simulator["cash_flow_policy"], "seasonal-v2")
        self.assertEqual(result["financials"]["cash_balance"], base["financials"]["cash_balance"])
        self.assertEqual(simulator["bank_financials"]["monthly"], months)
        self.assertTrue(all(row["operating_inflow"] == "1000000.00" for row in base["financials"]["monthly"]))

    def test_profile_history_moves_with_calendar_without_mutating_previous_snapshot(self):
        old, _ = profile(datetime.fromisoformat("2026-10-23T12:00:00+03:00"))
        new, _ = profile(datetime.fromisoformat("2026-11-23T12:00:00+03:00"))
        self.assertEqual(old["financials"]["monthly"][-1]["month"], "2026-09")
        self.assertEqual(new["financials"]["monthly"][-1]["month"], "2026-10")
        new["financials"]["monthly"][0]["operating_inflow"] = "0.00"
        self.assertEqual(old["financials"]["monthly"][0]["operating_inflow"], "782450.00")
