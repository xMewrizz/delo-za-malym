from copy import deepcopy
import unittest
from pydantic import ValidationError
from backend.models import PenaltyPreviewRequest
from backend.penalty_preview import preview_penalties
from backend.service import ProcessError


def payment(identifier, due, amount, **extra):
    return {"event_id": identifier, "application_id": identifier.split(":")[0], "date": due,
            "amount": amount, "forecast": True, "direction": "outflow", "kind": "loan_payment", **extra}


class PenaltyPreviewTests(unittest.TestCase):
    def setUp(self):
        self.calendar = {"accounts": [], "events": [payment("first:1", "2026-10-31", "40000.00"), payment("second:1", "2026-11-15", "10000.00")]}

    def request(self, **extra):
        return PenaltyPreviewRequest.model_validate({"from_date": "2026-10-23", "target_date": "2026-11-20",
            "products": [{"product_id": "app:first", "daily_rate_percent": "0.05"}, {"product_id": "app:second", "daily_rate_percent": "0.1"}], **extra})

    def test_two_products_different_rates_cross_month_and_no_mutation(self):
        before = deepcopy(self.calendar)
        result = preview_penalties(self.calendar, self.request())
        self.assertEqual((result["missed_payments"], result["total_penalty"], result["total_with_penalty"]), ("50000.00", "450.00", "50450.00"))
        self.assertEqual(result["products"][0]["payments"][0]["days"], 20)
        self.assertEqual(result["products"][1]["payments"][0]["days"], 5)
        self.assertEqual(self.calendar, before)

    def test_only_selected_products_and_each_payment_has_its_own_days(self):
        self.calendar["events"].append(payment("first:2", "2026-11-10", "20000.00"))
        result = preview_penalties(self.calendar, self.request(products=[{"product_id": "app:first", "daily_rate_percent": "0.05"}]))
        self.assertEqual(result["total_penalty"], "500.00")
        self.assertEqual([item["days"] for item in result["products"][0]["payments"]], [20, 10])

    def test_zero_rate_and_sub_cent_rounding(self):
        self.calendar["events"][0]["amount"] = "0.10"
        result = preview_penalties(self.calendar, self.request(products=[{"product_id": "app:first", "daily_rate_percent": "0.25"}]))
        self.assertEqual(result["total_penalty"], "0.01")
        result = preview_penalties(self.calendar, self.request(products=[{"product_id": "app:first", "daily_rate_percent": "0"}]))
        self.assertEqual(result["total_penalty"], "0.00")

    def test_paid_planned_expenses_overdraft_forecasts_and_closed_products_are_excluded(self):
        for extra in ({"forecast": False}, {"kind": "planned_expense"}, {"kind": "overdraft_repayment"}, {"direction": "inflow"}):
            self.calendar["events"].append(payment("first:excluded", "2026-10-31", "999999.00", **extra))
        result = preview_penalties(self.calendar, self.request())
        self.assertEqual(result["total_penalty"], "450.00")
        self.calendar["accounts"] = [{"application_id": "first", "status": "closed"}]
        with self.assertRaises(ProcessError):
            preview_penalties(self.calendar, self.request())

    def test_due_day_is_not_overdue_but_following_day_is(self):
        selection = [{"product_id": "app:first", "daily_rate_percent": "0.05"}]
        with self.assertRaises(ProcessError):
            preview_penalties(self.calendar, self.request(target_date="2026-10-31", products=selection))
        result = preview_penalties(self.calendar, self.request(target_date="2026-11-01", products=selection))
        self.assertEqual(result["total_penalty"], "20.00")

    def test_invalid_rates_dates_duplicates_and_unknown_product(self):
        for rate in ("NaN", "-1", "100.1", "1e3", "", "0,05"):
            with self.assertRaises(ValidationError):
                self.request(products=[{"product_id": "app:first", "daily_rate_percent": rate}])
        for target in ("2026-10-23", "2026-10-01", "2040-01-01"):
            with self.assertRaises(ValidationError):
                self.request(target_date=target)
        with self.assertRaises(ValidationError):
            self.request(products=[{"product_id": "app:first", "daily_rate_percent": "0"}] * 2)
        with self.assertRaises(ProcessError):
            preview_penalties(self.calendar, self.request(products=[{"product_id": "app:unknown", "daily_rate_percent": "0.05"}]))
