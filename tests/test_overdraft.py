from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, localcontext
import json
from pathlib import Path
import unittest

from credit_engine import OverdraftPolicy, calculate_overdraft


def transaction(identifier, day, direction, amount):
    return {"transaction_id": identifier, "date": day, "direction": direction, "amount": amount}


def scenario(end="2026-11-11", opening="100000.00", operations=None):
    return {
        "start_date": "2026-11-01", "end_date": end,
        "opening_cash_balance": opening, "cash_reserve": "0.00",
        "transactions": operations if operations is not None else [
            transaction("purchase", "2026-11-01", "outflow", "250000.00"),
            transaction("customer", "2026-11-11", "inflow", "200000.00"),
        ],
    }


class OverdraftTests(unittest.TestCase):
    def test_credit_payments_cannot_be_funded_by_overdraft_even_with_later_revenue(self):
        data = scenario(opening="0.00", operations=[
            transaction("loan", "2026-11-01", "outflow", "100000.00"),
            transaction("receipt", "2026-11-11", "inflow", "200000.00")])
        data["existing_debt_payments"] = [{"loan_id":"existing", "transaction_id":"loan"}]
        calculation = calculate_overdraft(data, "200000.00").calculation
        self.assertEqual(calculation.required_limit, Decimal("0.00"))
        self.assertEqual(calculation.total_drawn, Decimal("0.00"))
        self.assertEqual(calculation.total_interest, Decimal("0.00"))
        self.assertEqual(calculation.daily[0].closing_cash, Decimal("-100000.00"))
        self.assertFalse(calculation.feasible)
        self.assertIn("credit_payment_shortfall", [issue.code for issue in calculation.violations])

    def test_own_funds_pay_existing_loan_and_overdraft_covers_business_expense(self):
        data = scenario(opening="100000.00", operations=[
            transaction("purchase", "2026-11-01", "outflow", "170000.00"),
            transaction("loan", "2026-11-01", "outflow", "30000.00"),
            transaction("receipt", "2026-11-11", "inflow", "200000.00")])
        data["existing_debt_payments"] = [{"loan_id":"existing", "transaction_id":"loan"}]
        before=deepcopy(data)
        policy=OverdraftPolicy(annual_rate_percent="0.00")
        calculation = calculate_overdraft(data, "200000.00",policy=policy).calculation
        self.assertEqual(calculation.required_limit, Decimal("100000.00"))
        self.assertTrue(calculation.feasible)
        self.assertEqual(data,before)
        data["transactions"].reverse()
        self.assertEqual(calculate_overdraft(data,"200000.00",policy=policy).calculation,calculation)

    def test_later_credit_shortfall_does_not_increase_the_overdraft_drawing(self):
        data = scenario(opening="0.00", operations=[
            transaction("purchase", "2026-11-01", "outflow", "100000.00"),
            transaction("loan", "2026-11-02", "outflow", "50000.00"),
            transaction("receipt", "2026-11-11", "inflow", "200000.00")])
        data["existing_debt_payments"] = [{"loan_id":"existing", "transaction_id":"loan"}]
        calculation = calculate_overdraft(data,"200000.00",policy=OverdraftPolicy(annual_rate_percent="0.00")).calculation
        self.assertEqual(calculation.total_drawn,Decimal("100000.00"))
        self.assertEqual(calculation.daily[1].drawn,Decimal("0.00"))
        self.assertEqual(calculation.closing_cash,Decimal("50000.00"))
        self.assertFalse(calculation.feasible)

    def test_ten_day_gap_has_daily_interest_and_full_repayment(self):
        result = calculate_overdraft(scenario(), "200000.00")
        self.assertEqual(result.status, "calculated")
        calculation = result.calculation
        self.assertEqual(calculation.required_limit, Decimal("150000.00"))
        self.assertEqual(calculation.total_interest, Decimal("986.30"))
        self.assertEqual(calculation.interest_paid, Decimal("986.30"))
        self.assertEqual(calculation.total_repayment, Decimal("150986.30"))
        self.assertEqual(calculation.closing_cash, Decimal("49013.70"))
        self.assertTrue(calculation.feasible)
        self.assertEqual(calculation.violations, ())
        self.assertEqual(calculation.daily[-1].interest_accrued, Decimal("0.00"))

    def test_no_borrowing_means_no_interest(self):
        calculation = calculate_overdraft(scenario(opening="300000.00"), "200000.00").calculation
        self.assertEqual(calculation.required_limit, Decimal("0.00"))
        self.assertEqual(calculation.total_interest, Decimal("0.00"))
        self.assertEqual(calculation.total_repayment, Decimal("0.00"))
        self.assertEqual(calculation.closing_cash, Decimal("250000.00"))
        self.assertTrue(calculation.feasible)

    def test_receipts_first_even_if_input_is_unsorted(self):
        data = scenario(end="2026-11-01", opening="0.00", operations=[
            transaction("expense", "2026-11-01", "outflow", "100.00"),
            transaction("receipt", "2026-11-01", "inflow", "100.00"),
        ])
        calculation = calculate_overdraft(data, "100.00").calculation
        self.assertEqual(calculation.total_drawn, Decimal("0.00"))
        self.assertTrue(calculation.feasible)
        data["transactions"].reverse()
        self.assertEqual(calculate_overdraft(data, "100.00").calculation, calculation)

    def test_partial_receipt_pays_interest_before_principal(self):
        data = scenario(end="2026-11-03", opening="0.00", operations=[
            transaction("expense", "2026-11-01", "outflow", "100000.00"),
            transaction("partial", "2026-11-02", "inflow", "50000.00"),
            transaction("final", "2026-11-03", "inflow", "60000.00"),
        ])
        calculation = calculate_overdraft(data, "100000.00").calculation
        second = calculation.daily[1]
        self.assertEqual(second.interest_paid, Decimal("65.75"))
        self.assertEqual(second.principal_repaid, Decimal("49934.25"))
        self.assertEqual(second.closing_principal, Decimal("50065.75"))
        self.assertEqual(second.interest_accrued, Decimal("32.92"))
        self.assertEqual(calculation.total_interest, Decimal("98.67"))
        self.assertTrue(calculation.feasible)

    def test_repaid_principal_restores_limit_and_can_be_used_again(self):
        data = scenario(end="2026-11-04", opening="0.00", operations=[
            transaction("purchase-1", "2026-11-01", "outflow", "100.00"),
            transaction("receipt-1", "2026-11-02", "inflow", "100.00"),
            transaction("purchase-2", "2026-11-03", "outflow", "100.00"),
            transaction("receipt-2", "2026-11-04", "inflow", "100.00"),
        ])
        calculation = calculate_overdraft(data, "100.00", policy=OverdraftPolicy(annual_rate_percent="0.00")).calculation
        self.assertEqual(calculation.total_drawn, Decimal("200.00"))
        self.assertEqual(calculation.required_limit, Decimal("100.00"))
        self.assertEqual(calculation.daily[1].available_limit, Decimal("100.00"))
        self.assertTrue(calculation.feasible)

    def test_limit_excess_is_unfunded_demand_not_an_approval(self):
        calculation = calculate_overdraft(scenario(), "100000.00").calculation
        self.assertFalse(calculation.within_limit)
        self.assertTrue(calculation.fully_repaid)
        self.assertFalse(calculation.feasible)
        self.assertEqual(calculation.required_limit, Decimal("150000.00"))
        self.assertEqual(calculation.daily[0].limit_excess, Decimal("50000.00"))
        self.assertEqual(calculation.violations[0].code, "limit_exceeded")
        self.assertEqual(calculation.daily[0].available_limit, Decimal("0.00"))

    def test_reserve_is_not_spent_on_operations_or_repayment(self):
        data = scenario()
        data["cash_reserve"] = "50000.00"
        calculation = calculate_overdraft(data, "250000.00").calculation
        self.assertEqual(calculation.required_limit, Decimal("200000.00"))
        self.assertTrue(all(day.closing_cash >= Decimal("50000.00") for day in calculation.daily))
        self.assertFalse(calculation.fully_repaid)

    def test_unpaid_interest_is_not_capitalized(self):
        data = scenario(end="2026-11-03", opening="0.00", operations=[
            transaction("expense", "2026-11-01", "outflow", "100000.00"),
        ])
        calculation = calculate_overdraft(data, "100000.00").calculation
        self.assertEqual(calculation.total_interest, Decimal("197.25"))
        self.assertTrue(all(day.closing_principal == Decimal("100000.00") for day in calculation.daily))
        self.assertEqual(calculation.interest_paid, Decimal("0.00"))
        self.assertFalse(calculation.fully_repaid)
        self.assertEqual(calculation.violations[-1].code, "repayment_not_demonstrated")
        self.assertTrue(calculation.within_repayment_period)

    def test_repayment_on_deadline_is_allowed_but_remaining_debt_is_overdue(self):
        start = date(2026, 11, 1)
        deadline = (start + timedelta(days=60)).isoformat()
        data = scenario(end=deadline, opening="0.00", operations=[
            transaction("expense", start.isoformat(), "outflow", "100000.00"),
            transaction("receipt", deadline, "inflow", "200000.00"),
        ])
        calculation = calculate_overdraft(data, "100000.00").calculation
        self.assertEqual(calculation.total_interest, Decimal("3945.00"))
        self.assertTrue(calculation.feasible)
        data["transactions"].pop()
        calculation = calculate_overdraft(data, "100000.00").calculation
        self.assertFalse(calculation.within_repayment_period)
        self.assertIn("repayment_deadline_exceeded", [issue.code for issue in calculation.violations])

    def test_partial_repayment_does_not_reset_old_draw_deadline(self):
        data = scenario(end="2026-11-04", opening="0.00", operations=[
            transaction("expense", "2026-11-01", "outflow", "100.00"),
            transaction("partial", "2026-11-03", "inflow", "50.00"),
            transaction("receipt", "2026-11-04", "inflow", "100.00"),
        ])
        policy = OverdraftPolicy(annual_rate_percent="0.00", max_debt_days=2)
        calculation = calculate_overdraft(data, "100.00", policy=policy).calculation
        self.assertTrue(calculation.fully_repaid)
        self.assertFalse(calculation.within_repayment_period)

    def test_fifo_repayment_closes_oldest_draw_before_next_one(self):
        data = scenario(end="2026-11-05", opening="0.00", operations=[
            transaction("expense-1", "2026-11-01", "outflow", "100.00"),
            transaction("expense-2", "2026-11-02", "outflow", "100.00"),
            transaction("receipt-1", "2026-11-03", "inflow", "100.00"),
            transaction("receipt-2", "2026-11-04", "inflow", "100.00"),
        ])
        calculation = calculate_overdraft(data, "200.00", policy=OverdraftPolicy(annual_rate_percent="0.00", max_debt_days=2)).calculation
        self.assertTrue(calculation.feasible)

    def test_incomplete_horizon_does_not_claim_full_repayment(self):
        data = scenario(end="2026-11-02", opening="0.00", operations=[
            transaction("expense", "2026-11-01", "outflow", "100000.00"),
        ])
        calculation = calculate_overdraft(data, "100000.00").calculation
        self.assertEqual(calculation.outstanding_principal, Decimal("100000.00"))
        self.assertEqual(calculation.unpaid_interest, Decimal("131.50"))
        self.assertFalse(calculation.feasible)

    def test_schedule_conserves_money_and_separates_principal_and_interest(self):
        data = scenario()
        calculation = calculate_overdraft(data, "200000.00").calculation
        cash = Decimal(data["opening_cash_balance"])
        for day in calculation.daily:
            self.assertEqual(day.opening_principal + day.drawn - day.principal_repaid, day.closing_principal)
            self.assertEqual(cash + day.inflow + day.drawn - day.outflow - day.interest_paid - day.principal_repaid, day.closing_cash)
            cash = day.closing_cash
        self.assertEqual(calculation.total_drawn - calculation.total_principal_repaid, calculation.outstanding_principal)
        self.assertEqual(calculation.total_interest - calculation.interest_paid, calculation.unpaid_interest)

    def test_rounding_uses_actual_365_even_in_leap_year(self):
        data = scenario(end="2026-11-01", opening="0.00", operations=[
            transaction("expense", "2026-11-01", "outflow", "100.00"),
        ])
        calculation = calculate_overdraft(data, "100.00", policy=OverdraftPolicy(annual_rate_percent="1.83")).calculation
        self.assertEqual(calculation.total_interest, Decimal("0.01"))
        data.update(start_date="2024-02-28", end_date="2024-03-01")
        data["transactions"][0]["date"] = "2024-02-28"
        calculation = calculate_overdraft(data, "100.00", policy=OverdraftPolicy(annual_rate_percent="1.83")).calculation
        self.assertEqual(len(calculation.daily), 3)
        self.assertEqual(calculation.total_interest, Decimal("0.03"))

    def test_missing_values_and_empty_operations_are_distinct(self):
        self.assertEqual(calculate_overdraft(None, None).status, "needs_information")
        data = scenario(operations=[])
        self.assertTrue(calculate_overdraft(data, "100.00").calculation.feasible)
        data["transactions"] = None
        self.assertEqual(calculate_overdraft(data, "100.00").status, "needs_information")
        data["transactions"] = []
        data["cash_reserve"] = None
        self.assertEqual(calculate_overdraft(data, "100.00").status, "needs_information")

    def test_malformed_data_is_rejected(self):
        cases = [
            ("opening_cash_balance", 100000), ("cash_reserve", "100001.00"),
            ("start_date", "20261101"), ("end_date", "2026-10-31"),
            ("end_date", "2028-01-01"), ("transactions", {}),
        ]
        for field, value in cases:
            with self.subTest(field=field, value=value):
                data = scenario()
                data[field] = value
                self.assertEqual(calculate_overdraft(data, "200000.00").status, "invalid_data")
        for limit in (True, 100, "0.00", "-1.00", "1.001", "NaN"):
            with self.subTest(limit=limit):
                self.assertEqual(calculate_overdraft(scenario(), limit).status, "invalid_data")
        self.assertEqual(calculate_overdraft([], "100.00").status, "invalid_data")

    def test_invalid_operations_and_duplicates_are_rejected(self):
        for field, value in (("date", "2026-12-01"), ("direction", "credit"),
                             ("amount", "0.00"), ("amount", "-1.00"), ("amount", "1.001"),
                             ("transaction_id", ""), ("transaction_id", [])):
            with self.subTest(field=field, value=value):
                data = scenario()
                data["transactions"][0][field] = value
                self.assertEqual(calculate_overdraft(data, "200000.00").status, "invalid_data")
        data = scenario()
        data["transactions"].append(deepcopy(data["transactions"][0]))
        self.assertEqual(calculate_overdraft(data, "200000.00").status, "invalid_data")

    def test_serialization_and_decimal_context_are_stable(self):
        data = scenario()
        original = deepcopy(data)
        baseline = calculate_overdraft(data, "200000.00")
        payload = json.loads(json.dumps(baseline.to_dict(), allow_nan=False))
        self.assertEqual(payload["calculation"]["required_limit"], "150000.00")
        with localcontext() as context:
            context.prec = 6
            self.assertEqual(calculate_overdraft(data, "200000.00"), baseline)
            self.assertEqual(context.prec, 6)
        self.assertEqual(data, original)

    def test_policy_validation(self):
        for kwargs in ({"annual_rate_percent": "-1.00"}, {"annual_rate_percent": 24},
                       {"max_debt_days": True}, {"max_scenario_days": 0}, {"version": ""}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                OverdraftPolicy(**kwargs)

    def test_example_matches_saved_calculation(self):
        path = Path(__file__).resolve().parents[1] / "contracts/overdraft/example.json"
        example = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(calculate_overdraft(**example["input"]).to_dict(), example["expected"])


if __name__ == "__main__":
    unittest.main()
