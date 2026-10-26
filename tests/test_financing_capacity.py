from copy import deepcopy
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from fastapi.testclient import TestClient
from backend import demo
from backend.main import create_app
from backend.financing_capacity import financing_capacity

class FinancingCapacityTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime.fromisoformat('2026-10-26T10:00:00+03:00')
        self.profile,self.simulator=demo.profile(self.now)

    def test_terms_share_bank_capacity_and_do_not_mutate_inputs(self):
        before=deepcopy((self.profile,self.simulator))
        result=financing_capacity(self.profile,self.simulator,self.now)
        self.assertEqual((self.profile,self.simulator),before)
        self.assertTrue(result['preliminary'])
        products={item['product_id']:item for item in result['products']}
        loan=products['working_capital_loan']
        self.assertEqual(loan['status'],'available')
        self.assertGreater(float(loan['terms'][-1]['maximum_amount']),float(loan['terms'][0]['maximum_amount']))
        self.assertLessEqual(float(loan['maximum_amount']),100000000)
        self.assertEqual(products['overdraft']['status'],'plan_required')
        self.assertEqual(products['refinancing']['status'],'selection_required')
        self.assertIsNone(products['refinancing']['maximum_amount'])

    def test_cash_balance_does_not_inflate_credit_capacity(self):
        original=financing_capacity(self.profile,self.simulator,self.now)
        self.profile['financials']['cash_balance']='900000000.00'
        larger=financing_capacity(self.profile,self.simulator,self.now)
        self.assertEqual(original['products'][0]['maximum_amount'],larger['products'][0]['maximum_amount'])

    def test_existing_loans_reduce_capacity_without_triggering_false_obligation_mismatch(self):
        original=financing_capacity(self.profile,self.simulator,self.now)['products'][0]
        extra=demo.profile(self.now,include_sample_loan=True)[0]['financials']['existing_loans']
        self.assertTrue(extra)
        self.profile['financials']['existing_loans']=extra
        current=financing_capacity(self.profile,self.simulator,self.now)['products'][0]
        self.assertEqual(current['status'],'available')
        self.assertLess(float(current['maximum_amount']),float(original['maximum_amount']))

    def test_high_risk_is_not_presented_as_an_available_limit(self):
        self.simulator['checks']['credit_history']['category']='serious_delinquency'
        for product in financing_capacity(self.profile,self.simulator,self.now)['products']:
            if product['product_id']!='refinancing':
                self.assertEqual(product['status'],'unavailable')
                self.assertTrue(product['reasons'])

    def test_endpoint_creates_no_draft_and_validates_grace(self):
        with TemporaryDirectory() as directory, TestClient(create_app(Path(directory)/'test.sqlite3',clock=lambda:self.now)) as client:
            before=client.get('/api/applications').json()
            response=client.get('/api/profile/financing-capacity')
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(len(response.json()['products']),5)
            self.assertEqual(client.get('/api/profile/financing-capacity?principal_grace_months=3').status_code,200)
            self.assertEqual(client.get('/api/profile/financing-capacity?principal_grace_months=2').status_code,422)
            self.assertEqual(client.get('/api/applications').json(),before)
