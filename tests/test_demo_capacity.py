from copy import deepcopy
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from backend.service import CreditProcess
from backend.store import Store
from scripts.prepare_demo_cabinet import Showcase
from scripts.refresh_demo_profile import refresh


class DemoCapacityTests(unittest.TestCase):
    def test_populated_showcase_can_explore_every_product_with_real_policies(self):
        with TemporaryDirectory() as directory, patch.dict("os.environ", {"DEMO_BUSINESS_SCALE":"6"}):
            showcase = Showcase(Path(directory)/"showcase.db", date(2026,10,24))
            showcase.build()
            process = showcase.process
            profile = process.profile()["financials"]
            flows = [Decimal(row["operating_inflow"])-Decimal(row["operating_outflow"])-Decimal(row["taxes"]) for row in profile["monthly"]]
            self.assertLess(min(flows), 0)
            cash = Decimal(profile["cash_balance"])
            debt = next(loan["loan_id"] for loan in profile["existing_loans"] if loan["product_id"]=="working_capital_loan")
            plan = {"start_date":"2026-10-24","end_date":"2026-11-13","opening_cash_balance":str(cash),"transactions":[
                {"transaction_id":"supplier","date":"2026-10-29","direction":"outflow","amount":f"{cash+1000000:.2f}"},
                {"transaction_id":"revenue","date":"2026-11-05","direction":"inflow","amount":"1500000.00"}],
                "existing_debt_payments":[],"debt_payments_confirmed":True,"cash_reserve":"0.00"}
            cases = [
                ("working_capital_loan","5000000.00",12,{}),
                ("revolving_credit_line","1000000.00",12,{}),
                ("revolving_credit_line","3000000.00",12,{}),
                ("revolving_credit_line","5000000.00",12,{}),
                ("investment_loan",None,36,{"need":{"purpose":"investment","project_cost":"6250000.00","own_funds":"1250000.00","principal_grace_months":0}}),
                ("refinancing",None,24,{"need":{"purpose":"refinancing"},"product_details":{"refinancing":{"loan_ids":[debt]}}}),
                ("overdraft","1000000.00",None,{"need":{"financing_pattern":"cash_gap"},"product_details":{"overdraft":plan}}),
            ]
            for index,(product,amount,term,extra) in enumerate(cases):
                with self.subTest(product=product,amount=amount):
                    view=showcase.create(f"capacity-{index}",product,amount,term,**extra)
                    result=showcase.workspace.explore(view["application"]["application_id"],view["application"]["application_version"],product)["explorations"][-1]["result"]
                    self.assertTrue(result["options"], result)
            invalid=showcase.create("outside-policy","working_capital_loan","100000000.00",12)
            result=showcase.workspace.explore(invalid["application"]["application_id"],invalid["application"]["application_version"],"working_capital_loan")["explorations"][-1]["result"]
            self.assertFalse(any(option["amount"]=="100000000.00" for option in result["options"]))

    def test_profile_refresh_changes_only_unsubmitted_drafts_and_is_idempotent(self):
        with TemporaryDirectory() as directory:
            store=Store(Path(directory)/"cabinet.db");store.initialize()
            process=CreditProcess(store,lambda:datetime.fromisoformat("2026-10-24T12:00:00+03:00"))
            with patch.dict("os.environ",{"DEMO_BUSINESS_SCALE":"1"}):
                draft=process.create(need={"purpose":"working_capital","preferred_product":"revolving_credit_line","requested_amount":"1000000.00","term_months":12})
                filed=process.create(need={"purpose":"working_capital","preferred_product":"working_capital_loan","requested_amount":"100000.00","term_months":12})
                filed=process.submit(filed["application"]["application_id"],filed["application"]["application_version"])
            before=deepcopy(filed)
            with patch.dict("os.environ",{"DEMO_BUSINESS_SCALE":"6"}):
                self.assertEqual(refresh(process)["updated_drafts"],1)
                self.assertEqual(refresh(process)["updated_drafts"],0)
            self.assertEqual(process.get(filed["application"]["application_id"]),before)
            after=process.get(draft["application"]["application_id"])
            self.assertEqual(after["application"]["need"],draft["application"]["need"])
            self.assertEqual(after["application"]["financials"]["cash_balance"],draft["application"]["financials"]["cash_balance"])
            self.assertEqual(after["application"]["financials"]["monthly"][0]["operating_inflow"],"4694700.00")


if __name__=="__main__":
    unittest.main()
