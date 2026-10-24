from copy import deepcopy
from datetime import datetime
from decimal import Decimal
from dataclasses import replace
import unittest

from backend import demo
from credit_engine.assessment import assess_application
from credit_engine.assessment import WorkingCapitalPolicy
from credit_engine.financials import FinancialPolicy, calculate_financial_metrics
from credit_engine.investment import assess_investment
from credit_engine.overdraft_assessment import assess_overdraft
from credit_engine.refinancing import assess_refinancing
from credit_engine.revolving import assess_revolving


class SeasonalProductTests(unittest.TestCase):
    now = datetime.fromisoformat("2026-10-23T12:00:00+03:00")

    def application(self, product="working_capital_loan"):
        profile, simulator = demo.profile(self.now, include_sample_loan=True)
        app, _ = demo.scenario_data("working_capital_loan", "01_approved", self.now)
        app.update(financials=profile["financials"], business=profile["business"], confirmation={"application_version": app["application_version"], "confirmed_at": self.now.isoformat()})
        app["need"].update(preferred_product=product, requested_amount="500000.00", term_months=12, financing_pattern="gradual_repayment")
        return app, simulator

    def test_negative_month_is_preserved_while_quarter_windows_drive_capacity(self):
        app, _ = self.application()
        result = calculate_financial_metrics(app["financials"], self.now.date(), policy=FinancialPolicy(version="demo-seasonal-v2", allow_seasonal_cash_flow=True))
        self.assertEqual(result.status, "calculated")
        self.assertEqual(result.metrics.minimum_monthly_cash_flow, Decimal("-38300.00"))
        self.assertEqual(result.metrics.underwriting_cash_flow, Decimal("149150.00"))
        self.assertEqual(result.metrics.available_monthly_payment, Decimal("69405.00"))
        self.assertEqual(result.metrics.nonpositive_cash_flow_months, 1)
        legacy = calculate_financial_metrics(app["financials"], self.now.date())
        self.assertEqual(legacy.status, "out_of_policy")

    def test_each_product_uses_seasonality_but_retains_its_own_mechanics(self):
        for product, calculator in [("working_capital_loan", assess_application), ("revolving_credit_line", assess_revolving), ("investment_loan", assess_investment), ("refinancing", assess_refinancing), ("overdraft", assess_overdraft)]:
            with self.subTest(product=product):
                app, simulator = self.application(product)
                if product == "investment_loan":
                    app["need"].update(purpose="investment", project_cost="1000000.00", own_funds="200000.00", requested_amount="800000.00", principal_grace_months=3, term_months=36)
                if product == "refinancing":
                    app["need"].update(purpose="refinancing", requested_amount="700000.00", term_months=36)
                    app["product_details"] = {"refinancing": {"loan_ids": [app["financials"]["existing_loans"][0]["loan_id"]]}}
                if product == "overdraft":
                    app["need"].update(financing_pattern="cash_gap", requested_amount="150000.00", term_months=None)
                    app["product_details"] = {"overdraft": {"start_date": "2026-10-23", "end_date": "2026-10-31", "opening_cash_balance": "0.00", "cash_reserve": "0.00", "transactions": [{"transaction_id": "expense", "date": "2026-10-24", "amount": "120000.00", "direction": "outflow"}, {"transaction_id": "receipt", "date": "2026-10-29", "amount": "140000.00", "direction": "inflow"}], "existing_debt_payments": []}}
                checks = demo.simulate_checks(app, simulator, self.now)
                before = deepcopy(app)
                result = calculator(app, checks, calculated_at=self.now, seasonal=True).to_dict()
                assessment = result["assessment"]
                self.assertTrue(assessment["offers"], result)
                self.assertIn("seasonal-v2", assessment["policy_version"])
                self.assertEqual(app, before)
                self.assertEqual(result["financial_metrics"]["nonpositive_cash_flow_months"], 1)
                if product == "refinancing":
                    self.assertEqual(result["financial_metrics"]["existing_monthly_debt_service"], "0.00")
                    self.assertEqual(assessment["offers"][0]["refinancing"]["cash_to_client"], "0.00")
                if product == "revolving_credit_line":
                    self.assertIsNone(assessment["offers"][0]["monthly_payment"])
                    self.assertGreater(Decimal(assessment["offers"][0]["revolving"]["capacity_reserve"]), 0)

    def test_persistent_deficits_or_excess_debt_do_not_get_automatic_approval(self):
        app, simulator = self.application()
        for row in app["financials"]["monthly"][:3]:
            row["operating_outflow"] = row["operating_inflow"]
        financial = calculate_financial_metrics(app["financials"], self.now.date(), policy=FinancialPolicy(allow_seasonal_cash_flow=True))
        self.assertEqual(financial.status, "out_of_policy")
        app, simulator = self.application()
        app["financials"]["existing_loans"][0]["monthly_payment"] = "200000.00"
        simulator["known_loans"] = deepcopy(app["financials"]["existing_loans"])
        result = assess_application(app, demo.simulate_checks(app, simulator, self.now), calculated_at=self.now, seasonal=True).to_dict()
        self.assertEqual(result["assessment"]["outcome"], "declined")
        self.assertEqual(result["financial_metrics"]["available_monthly_payment"], "0.00")

    def test_seasonality_does_not_bypass_policy_binding_or_approve_a_sustained_loss(self):
        app, simulator = self.application()
        with self.assertRaises(ValueError):
            assess_application(app, demo.simulate_checks(app, simulator, self.now), calculated_at=self.now,
                               policy=replace(WorkingCapitalPolicy(), version="other"), seasonal=True)
        for row in app["financials"]["monthly"]:
            row["operating_outflow"] = row["operating_inflow"]
        result = assess_application(app, demo.simulate_checks(app, simulator, self.now), calculated_at=self.now, seasonal=True).to_dict()
        self.assertFalse(result["assessment"]["offers"])
        self.assertEqual(result["financial_metrics"]["available_monthly_payment"], "0.00")
