from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal, localcontext
import json
from pathlib import Path
import unittest

from credit_engine import FinancialPolicy, calculate_financial_metrics


D = Decimal
ROOT = Path(__file__).resolve().parents[1]
AS_OF = date(2026, 10, 20)


class FinancialMetricsTests(unittest.TestCase):
    def setUp(self):
        example = json.loads((ROOT / "contracts/examples.json").read_text(encoding="utf-8"))
        self.financials = example["application"]["financials"]

    def calculate(self, financials=None, assessment_date=AS_OF, **kwargs):
        return calculate_financial_metrics(
            self.financials if financials is None else financials, assessment_date, **kwargs
        )

    def test_demo_application(self):
        result = self.calculate()
        self.assertEqual(result.status, "calculated")
        self.assertEqual(result.issues, ())
        self.assertEqual(result.policy_version, "demo-v1")
        self.assertEqual(result.assessment_date, "2026-10-20")
        metrics = result.metrics
        expected = {
            "average_monthly_inflow": "1000000.00",
            "average_monthly_outflow": "800000.00",
            "average_monthly_taxes": "50000.00",
            "average_monthly_cash_flow": "150000.00",
            "minimum_monthly_cash_flow": "150000.00",
            "underwriting_cash_flow": "150000.00",
            "existing_monthly_debt_service": "35000.00",
            "cash_flow_after_existing_debt": "115000.00",
            "operating_reserve": "45000.00",
            "total_debt_service_limit": "105000.00",
            "available_monthly_payment": "70000.00",
            "cash_flow_margin": "0.15",
            "inflow_cv": "0",
            "largest_buyer_share": "0.25",
        }
        for name, value in expected.items():
            with self.subTest(metric=name):
                self.assertEqual(getattr(metrics, name), D(value))
        self.assertEqual(metrics.nonpositive_cash_flow_months, 0)
        self.assertEqual([row.month for row in metrics.monthly_cash_flow], [
            "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"
        ])

    def test_other_application_uses_its_own_cash_flows(self):
        for row in self.financials["monthly"]:
            row["operating_inflow"] = "1050000.00"
        self.financials["existing_loans"][0]["monthly_payment"] = "40000.00"
        self.assertEqual(self.calculate().metrics.available_monthly_payment, D("100000.00"))

    def test_weakest_month_is_used_instead_of_average(self):
        self.financials["monthly"][0]["operating_inflow"] = "930000.00"
        metrics = self.calculate().metrics
        self.assertEqual(metrics.minimum_monthly_cash_flow, D("80000.00"))
        self.assertEqual(metrics.available_monthly_payment, D("21000.00"))

    def test_cash_balance_does_not_increase_capacity(self):
        self.financials["cash_balance"] = "1000000000.00"
        self.assertEqual(self.calculate().metrics.available_monthly_payment, D("70000.00"))

    def test_confirmed_absence_of_loans(self):
        self.financials["existing_loans"] = []
        result = self.calculate()
        self.assertEqual(result.metrics.available_monthly_payment, D("105000.00"))
        self.assertEqual(result.to_dict()["metrics"]["existing_monthly_debt_service"], "0.00")

    def test_unknown_loans_are_not_zero(self):
        for value in (None, "missing"):
            with self.subTest(value=value):
                financials = deepcopy(self.financials)
                if value == "missing":
                    financials.pop("existing_loans")
                else:
                    financials["existing_loans"] = None
                result = self.calculate(financials)
                self.assertEqual(result.status, "needs_information")
                self.assertIsNone(result.metrics)
                self.assertIn("missing_existing_loans", [issue.code for issue in result.issues])

    def test_missing_month(self):
        self.financials["monthly"].pop(0)
        result = self.calculate()
        self.assertEqual(result.status, "needs_information")
        self.assertIsNone(result.metrics)
        self.assertTrue(any("2026-04" in issue.message for issue in result.issues))

    def test_duplicate_month_cannot_be_summed(self):
        self.financials["monthly"].append(deepcopy(self.financials["monthly"][0]))
        result = self.calculate()
        self.assertEqual(result.status, "needs_information")
        self.assertIsNone(result.metrics)
        self.assertIn("duplicate_month", [issue.code for issue in result.issues])

    def test_missing_financial_fields_are_reported_together(self):
        self.financials["monthly"][0]["taxes"] = None
        self.financials["existing_loans"][0].pop("monthly_payment")
        result = self.calculate()
        self.assertEqual(result.status, "needs_information")
        fields = {issue.field for issue in result.issues}
        self.assertIn("financials.monthly[0].taxes", fields)
        self.assertIn("financials.existing_loans[0].monthly_payment", fields)

    def test_invalid_amounts_are_not_coerced_or_rounded(self):
        for value in (1000000, 1000000.0, True, "-1.00", "1.001", "1", "1,00", "NaN", "Infinity", "1e6", " 1.00"):
            with self.subTest(value=value):
                financials = deepcopy(self.financials)
                financials["monthly"][0]["operating_inflow"] = value
                result = self.calculate(financials)
                self.assertEqual(result.status, "invalid_data")
                self.assertIsNone(result.metrics)
                self.assertIn("invalid_money", [issue.code for issue in result.issues])

    def test_malformed_containers(self):
        for field in ("monthly", "existing_loans"):
            for value in ({}, "text", [None]):
                with self.subTest(field=field, value=value):
                    financials = deepcopy(self.financials)
                    financials[field] = value
                    result = self.calculate(financials)
                    self.assertEqual(result.status, "invalid_data")
                    self.assertIsNone(result.metrics)

    def test_optional_values_can_remain_unknown(self):
        self.financials.pop("cash_balance")
        self.financials["largest_buyer_share"] = None
        result = self.calculate()
        self.assertEqual(result.status, "calculated")
        self.assertIsNone(result.metrics.largest_buyer_share)

    def test_buyer_share_must_be_a_finite_number_in_range(self):
        for share in (-0.1, 1.1, True, "0.25", float("nan"), float("inf")):
            with self.subTest(share=share):
                self.financials["largest_buyer_share"] = share
                self.assertEqual(self.calculate().status, "invalid_data")

    def test_old_and_current_months_do_not_replace_required_history(self):
        baseline = self.calculate()
        for month in ("2026-03", "2026-10", "2026-11"):
            self.financials["monthly"].append({"month": month, "operating_inflow": "999999999.00"})
        self.financials["monthly"].reverse()
        self.assertEqual(self.calculate(), baseline)

    def test_history_crosses_year_boundary(self):
        for row, month in zip(self.financials["monthly"], (
            "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"
        )):
            row["month"] = month
        result = self.calculate(assessment_date=date(2026, 2, 1))
        self.assertEqual(result.status, "calculated")
        self.assertEqual(result.metrics.monthly_cash_flow[0].month, "2025-08")

    def test_invalid_dates_and_periods(self):
        for value in ("2026-02-30", "2026-1-01", "20261020", datetime(2026, 10, 20), 20261020, date(1, 1, 1)):
            with self.subTest(value=value):
                self.assertEqual(self.calculate(assessment_date=value).status, "invalid_data")
        self.assertEqual(self.calculate(assessment_date="2026-10-20"), self.calculate())

    def test_invalid_month_labels(self):
        for month in ("2026-Q2", "2026-13", "0000-01", "2026-4", 202604):
            with self.subTest(month=month):
                self.financials["monthly"][0]["month"] = month
                self.assertEqual(self.calculate().status, "invalid_data")

    def test_seasonal_business_preserves_metrics_but_is_outside_policy(self):
        self.financials["monthly"][0]["operating_inflow"] = "800000.00"
        result = self.calculate()
        self.assertEqual(result.status, "out_of_policy")
        self.assertEqual(result.metrics.minimum_monthly_cash_flow, D("-50000.00"))
        self.assertEqual(result.metrics.nonpositive_cash_flow_months, 1)
        self.assertEqual(result.metrics.available_monthly_payment, D("0.00"))
        self.assertEqual(result.issues[0].code, "nonpositive_monthly_cash_flow")

    def test_unprofitable_business_does_not_receive_a_credit_decision(self):
        for row in self.financials["monthly"]:
            row["operating_inflow"] = "800000.00"
        result = self.calculate()
        self.assertEqual(result.status, "calculated")
        self.assertEqual(result.metrics.average_monthly_cash_flow, D("-50000.00"))
        self.assertEqual(result.metrics.available_monthly_payment, D("0.00"))

    def test_existing_debts_can_exhaust_capacity(self):
        self.financials["existing_loans"][0]["monthly_payment"] = "110000.00"
        self.assertEqual(self.calculate().metrics.available_monthly_payment, D("0.00"))

    def test_expired_loan_with_balance_requires_clarification(self):
        self.financials["existing_loans"][0]["maturity_date"] = "2026-10-19"
        result = self.calculate()
        self.assertEqual(result.status, "needs_information")
        self.assertIn("expired_loan_with_balance", [issue.code for issue in result.issues])

    def test_loan_ending_during_new_loan_is_kept_in_full(self):
        self.financials["existing_loans"][0]["maturity_date"] = "2026-11-01"
        self.assertEqual(self.calculate().metrics.available_monthly_payment, D("70000.00"))

    def test_zero_payment_with_outstanding_principal_requires_clarification(self):
        self.financials["existing_loans"][0]["monthly_payment"] = "0.00"
        result = self.calculate()
        self.assertEqual(result.status, "needs_information")
        self.assertIn("zero_payment_with_balance", [issue.code for issue in result.issues])

    def test_duplicate_loans_are_not_counted_twice(self):
        self.financials["existing_loans"].append(deepcopy(self.financials["existing_loans"][0]))
        result = self.calculate()
        self.assertEqual(result.status, "needs_information")
        self.assertIsNone(result.metrics)
        self.assertIn("duplicate_loan", [issue.code for issue in result.issues])

    def test_population_coefficient_of_variation(self):
        for index, row in enumerate(self.financials["monthly"]):
            row["operating_inflow"] = "1000000.00" if index % 2 else "2000000.00"
        self.assertAlmostEqual(self.calculate().metrics.inflow_cv, D(1) / 3, places=12)

    def test_zero_inflow_does_not_divide_by_zero(self):
        for row in self.financials["monthly"]:
            row.update(operating_inflow="0.00", operating_outflow="0.00", taxes="0.00")
        metrics = self.calculate().metrics
        self.assertIsNone(metrics.cash_flow_margin)
        self.assertIsNone(metrics.inflow_cv)
        self.assertEqual(metrics.available_monthly_payment, D("0.00"))

    def test_subcent_limit_is_rounded_down(self):
        for row in self.financials["monthly"]:
            row.update(operating_inflow="0.01", operating_outflow="0.00", taxes="0.00")
        self.financials["existing_loans"] = []
        metrics = self.calculate().metrics
        self.assertEqual(metrics.total_debt_service_limit, D("0.00"))
        self.assertEqual(metrics.operating_reserve, D("0.01"))

    def test_policy_can_change_without_changing_application(self):
        policy = FinancialPolicy(history_months=3, debt_service_fraction=D("0.50"), version="test-v2")
        result = self.calculate(policy=policy)
        self.assertEqual(result.policy_version, "test-v2")
        self.assertEqual(len(result.metrics.monthly_cash_flow), 3)
        self.assertEqual(result.metrics.available_monthly_payment, D("40000.00"))

    def test_invalid_policy_is_a_programming_error(self):
        for kwargs in ({"history_months": 0}, {"history_months": True}, {"debt_service_fraction": 0.7},
                       {"debt_service_fraction": D("NaN")}, {"debt_service_fraction": D("1.1")}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                FinancialPolicy(**kwargs)

    def test_result_is_serializable_and_input_is_unchanged(self):
        original = deepcopy(self.financials)
        result = self.calculate()
        serialized = json.loads(json.dumps(result.to_dict(), allow_nan=False))
        self.assertEqual(serialized["metrics"]["available_monthly_payment"], "70000.00")
        self.assertEqual(serialized["metrics"]["monthly_cash_flow"][0]["cash_flow"], "150000.00")
        self.assertEqual(self.financials, original)

    def test_calculation_is_independent_of_global_decimal_context(self):
        baseline = self.calculate()
        with localcontext() as context:
            context.prec = 6
            result = self.calculate()
            self.assertEqual(context.prec, 6)
        self.assertEqual(result, baseline)

    def test_missing_or_invalid_financials(self):
        self.assertEqual(calculate_financial_metrics(None, AS_OF).status, "needs_information")
        self.assertEqual(calculate_financial_metrics([], AS_OF).status, "invalid_data")


if __name__ == "__main__":
    unittest.main()
