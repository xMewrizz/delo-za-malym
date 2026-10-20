from datetime import date
from decimal import Decimal, localcontext
import json
from pathlib import Path
import unittest

from credit_engine import calculate_financial_metrics, calculate_loan


D = Decimal
ROOT = Path(__file__).resolve().parents[1]


class LoanCalculatorTests(unittest.TestCase):
    def test_existing_offer_examples_are_reproduced(self):
        examples = json.loads((ROOT / "contracts/examples.json").read_text(encoding="utf-8"))
        for key in ("assessment_alternatives", "assessment_approved", "assessment_conditional"):
            for offer in examples[key]["offers"]:
                with self.subTest(assessment=key):
                    result = calculate_loan(offer["amount"], offer["term_months"], offer["annual_rate_percent"])
                    self.assertEqual(result.status, "calculated")
                    self.assertEqual(result.issues, ())
                    calculation = result.calculation
                    self.assertEqual(calculation.monthly_payment, D(offer["monthly_payment"]))
                    self.assertEqual(calculation.total_repayment, D(offer["total_repayment"]))
                    self.assertEqual(calculation.fees_total, D(offer["fees_total"]))

    def test_million_for_twelve_months(self):
        calculation = calculate_loan("1000000.00", 12, "24.00").calculation
        self.assertEqual(calculation.monthly_payment, D("94559.60"))
        self.assertEqual(calculation.total_interest, D("134715.17"))
        self.assertEqual(calculation.total_repayment, D("1134715.17"))
        self.assertEqual(calculation.schedule[-1].total_payment, D("94559.57"))

    def test_schedule_breaks_payment_into_principal_and_interest(self):
        calculation = calculate_loan("1000000.00", 18, "24.00").calculation
        first, second = calculation.schedule[:2]
        self.assertEqual(first.month_number, 1)
        self.assertEqual(first.opening_balance, D("1000000.00"))
        self.assertEqual(first.interest_payment, D("20000.00"))
        self.assertEqual(first.principal_payment, D("46702.10"))
        self.assertEqual(first.closing_balance, D("953297.90"))
        self.assertEqual(second.opening_balance, first.closing_balance)
        self.assertEqual(second.interest_payment, D("19065.96"))

    def test_last_payment_can_exceed_regular_payment(self):
        calculation = calculate_loan("1000000.00", 18, "24.00").calculation
        self.assertEqual(calculation.monthly_payment, D("66702.10"))
        self.assertEqual(calculation.schedule[-1].total_payment, D("66702.18"))
        self.assertEqual(calculation.maximum_payment, D("66702.18"))
        self.assertEqual(calculation.total_interest, D("200637.88"))

    def test_schedule_conserves_money_and_never_has_negative_balance(self):
        for amount in ("0.01", "0.02", "1.01", "740000.00", "5000000.00"):
            for term in (1, 3, 6, 12, 18, 24, 36, 600):
                for rate in ("0.00", "0.01", "24.00"):
                    with self.subTest(amount=amount, term=term, rate=rate):
                        calculation = calculate_loan(amount, term, rate).calculation
                        self.assertEqual(len(calculation.schedule), term)
                        self.assertEqual(sum(row.principal_payment for row in calculation.schedule), D(amount))
                        self.assertEqual(calculation.total_repayment, D(amount) + calculation.total_interest)
                        self.assertEqual(calculation.schedule[-1].closing_balance, D("0.00"))
                        previous_balance = D(amount)
                        for row in calculation.schedule:
                            self.assertEqual(row.opening_balance, previous_balance)
                            self.assertEqual(row.total_payment, row.principal_payment + row.interest_payment)
                            self.assertEqual(row.closing_balance, row.opening_balance - row.principal_payment)
                            self.assertGreaterEqual(row.closing_balance, 0)
                            self.assertGreaterEqual(row.principal_payment, 0)
                            previous_balance = row.closing_balance

    def test_zero_interest_and_rounding_adjustment(self):
        calculation = calculate_loan("1000.00", 3, "0.00").calculation
        self.assertEqual(calculation.monthly_payment, D("333.33"))
        self.assertEqual([row.total_payment for row in calculation.schedule], [D("333.33"), D("333.33"), D("333.34")])
        self.assertEqual(calculation.total_interest, D("0.00"))
        self.assertEqual(calculation.total_repayment, D("1000.00"))

    def test_half_up_rounding(self):
        calculation = calculate_loan("1.01", 2, "0.00").calculation
        self.assertEqual(calculation.monthly_payment, D("0.51"))
        self.assertEqual(calculation.schedule[-1].total_payment, D("0.50"))

    def test_one_month_loan(self):
        calculation = calculate_loan("1000000.00", 1, "24.00").calculation
        self.assertEqual(calculation.monthly_payment, D("1020000.00"))
        self.assertEqual(calculation.total_interest, D("20000.00"))
        self.assertEqual(calculation.schedule[0].closing_balance, D("0.00"))

    def test_invalid_amount_and_rate_formats(self):
        invalid_values = (True, 24, 24.0, D("24.00"), "24", "24.001", "-1.00", "NaN", "Infinity", " 24.00", "2e1")
        for field in ("amount", "annual_rate_percent"):
            for value in invalid_values:
                with self.subTest(field=field, value=value):
                    arguments = dict(amount="1000000.00", term_months=12, annual_rate_percent="24.00")
                    arguments[field] = value
                    result = calculate_loan(**arguments)
                    self.assertEqual(result.status, "invalid_data")
                    self.assertIsNone(result.calculation)
                    self.assertEqual(result.issues[0].field, field)

    def test_zero_principal_is_invalid(self):
        result = calculate_loan("0.00", 12, "24.00")
        self.assertEqual(result.status, "invalid_data")
        self.assertEqual(result.issues[0].code, "nonpositive_amount")

    def test_invalid_terms(self):
        for term in (True, 12.0, "12", 0, -1, 601):
            with self.subTest(term=term):
                result = calculate_loan("1000000.00", term, "24.00")
                self.assertEqual(result.status, "invalid_data")
                self.assertEqual(result.issues[0].code, "invalid_term")

    def test_missing_inputs_are_not_treated_as_zero(self):
        result = calculate_loan(None, None, None)
        self.assertEqual(result.status, "needs_information")
        self.assertIsNone(result.calculation)
        self.assertEqual({issue.field for issue in result.issues}, {"amount", "term_months", "annual_rate_percent"})
        mixed = calculate_loan("-1.00", None, "24.00")
        self.assertEqual(mixed.status, "invalid_data")
        self.assertEqual(len(mixed.issues), 2)

    def test_calculator_is_separate_from_product_eligibility(self):
        result = calculate_loan("1000.00", 7, "12.00")
        self.assertEqual(result.status, "calculated")

    def test_serialization_preserves_kopecks(self):
        payload = json.loads(json.dumps(calculate_loan("1000000.00", 18, "24.00").to_dict()))
        self.assertEqual(payload["status"], "calculated")
        self.assertEqual(payload["calculation"]["amount"], "1000000.00")
        self.assertEqual(payload["calculation"]["fees_total"], "0.00")
        self.assertEqual(payload["calculation"]["schedule"][-1]["closing_balance"], "0.00")

    def test_decimal_precision_does_not_depend_on_caller(self):
        baseline = calculate_loan("1000000.00", 18, "24.00")
        with localcontext() as context:
            context.prec = 6
            self.assertEqual(calculate_loan("1000000.00", 18, "24.00"), baseline)
            self.assertEqual(context.prec, 6)

    def test_new_payments_can_be_compared_with_financial_capacity(self):
        examples = json.loads((ROOT / "contracts/examples.json").read_text(encoding="utf-8"))
        metrics = calculate_financial_metrics(examples["application"]["financials"], date(2026, 10, 20)).metrics
        original = calculate_loan("1000000.00", 12, "24.00").calculation
        alternative = calculate_loan("1000000.00", 18, "24.00").calculation
        self.assertGreater(original.maximum_payment, metrics.available_monthly_payment)
        self.assertLessEqual(alternative.maximum_payment, metrics.available_monthly_payment)


if __name__ == "__main__":
    unittest.main()
