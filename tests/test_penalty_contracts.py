from copy import deepcopy
from unittest.mock import patch
from pydantic import ValidationError
import unittest
from backend.models import PenaltyPreviewRequest
from backend.penalty_preview import preview_penalties
from backend.penalty_terms import attach_demo_penalties, read_penalty_terms
from backend.service import ProcessError
from tests import test_portfolio as fixture


def terms(identifier, rate="0.05", source="demo_contract"):
    offer = {"offer_id":identifier}
    attach_demo_penalties([offer])
    return {**offer["penalty_terms"], "daily_rate_percent":rate, "source":source}

class ContractPenaltyTests(unittest.TestCase):
    def setUp(self):
        self.calendar={"accounts":[],"events":[{"event_id":"first", "application_id":"one", "date":"2026-10-31", "amount":"40000.00", "forecast":True,"direction":"outflow","kind":"loan_payment"}, {"event_id":"second", "application_id":"two", "date":"2026-11-15", "amount":"10000.00", "forecast":True,"direction":"outflow","kind":"loan_payment"}], "penalty_terms":[{"product_id":"app:one", **terms("one")},{"product_id":"app:two", **terms("two","0.1","bank_contract")}]}

    def request(self, products):
        return PenaltyPreviewRequest.model_validate({"from_date":"2026-10-23","target_date":"2026-11-20","products":products})

    def contract(self, product="one"):
        value=next(item for item in self.calendar["penalty_terms"] if item["product_id"]=="app:"+product)
        return {"product_id":"app:"+product,"rate_source":"contract","terms_id":value["terms_id"]}

    def test_server_rates_can_differ_by_contract_and_do_not_mutate_money(self):
        before=deepcopy(self.calendar)
        result=preview_penalties(self.calendar,self.request([self.contract(),self.contract("two")]))
        self.assertEqual(result["total_penalty"],"450.00")
        self.assertEqual(result["basis"],"contract_simple_daily_rate")
        self.assertEqual([group["daily_rate_percent"] for group in result["products"]],["0.05","0.1"])
        self.assertEqual(result["products"][1]["contract_source"],"bank_contract")
        self.assertEqual(self.calendar,before)

    def test_manual_override_is_explicit_and_does_not_change_contract(self):
        before=deepcopy(self.calendar)
        result=preview_penalties(self.calendar,self.request([self.contract(),{"product_id":"app:two","daily_rate_percent":"0.2"}]))
        self.assertEqual(result["total_penalty"],"500.00")
        self.assertEqual(result["basis"],"mixed_simple_daily_rate")
        self.assertEqual(result["products"][1]["rate_source"],"manual")
        self.assertIsNone(result["products"][1]["terms_id"])
        self.assertEqual(self.calendar,before)

    def test_missing_changed_or_unsupported_terms_are_not_guessed(self):
        selection=self.contract()
        selection["terms_id"]="other-version"
        with self.assertRaises(ProcessError) as caught: preview_penalties(self.calendar,self.request([selection]))
        self.assertEqual(caught.exception.code,"penalty_terms_changed")
        self.calendar["penalty_terms"][0]["cap_amount"]="100.00"
        with self.assertRaises(ProcessError) as caught: preview_penalties(self.calendar,self.request([self.contract()]))
        self.assertEqual(caught.exception.code,"penalty_terms_missing")
        self.calendar["penalty_terms"]=[]
        with self.assertRaises(ProcessError): preview_penalties(self.calendar,self.request([selection]))

    def test_contract_rate_cannot_be_forged_and_zero_contract_rate_is_supported(self):
        with self.assertRaises(ValidationError): self.request([{**self.contract(),"daily_rate_percent":"99"}])
        with self.assertRaises(ValidationError): self.request([{"product_id":"app:one","rate_source":"contract"}])
        self.calendar["penalty_terms"][0]["daily_rate_percent"]="0"
        result=preview_penalties(self.calendar,self.request([self.contract()]))
        self.assertEqual(result["total_penalty"],"0.00")
        self.assertIsNone(read_penalty_terms({**terms("x"),"capitalization":True}))

class PenaltySnapshotTests(unittest.TestCase):
    setUp=fixture.PortfolioTests.setUp
    tearDown=fixture.PortfolioTests.tearDown
    create=fixture.PortfolioTests.create
    action=fixture.PortfolioTests.action
    ready=fixture.PortfolioTests.ready
    issue=fixture.PortfolioTests.issue

    def test_signed_terms_remain_fixed_and_legacy_policy_is_disclosed_without_rewriting_contract(self):
        issued=self.issue(self.create())
        identifier=issued["application"]["application_id"]
        snapshot=issued["completion"]["penalty_terms"]
        selected=next(offer for offer in issued["result"]["assessment"]["offers"] if offer["offer_id"]==issued["completion"]["offer_id"])
        self.assertEqual(snapshot,selected["penalty_terms"])
        before=self.client.get("/api/profile").json()["financials"]
        with patch("backend.penalty_terms.DEMO_DAILY_RATE","0.25"):
            calendar=self.client.get("/api/calendar").json()
        self.assertEqual(calendar["penalty_terms"][0]["daily_rate_percent"],snapshot["daily_rate_percent"])
        with self.client.app.state.process.store.connect(write=True) as connection:
            record=self.client.app.state.process.store.get(connection,identifier)
            record["completion"].pop("penalty_terms")
            self.client.app.state.process.store.save(connection,record)
        calendar=self.client.get("/api/calendar").json()
        self.assertEqual(calendar["penalty_terms"][0]["source"],"demo_policy")
        self.assertNotIn("penalty_terms",self.client.get("/api/applications/"+identifier).json()["completion"])
        self.assertEqual(self.client.get("/api/profile").json()["financials"],before)
        due=calendar["events"][-1]["date"]
        from datetime import date,timedelta
        result=self.client.post("/api/calendar/penalty-preview",json={"from_date":self.now.date().isoformat(),"target_date":(date.fromisoformat(due)+timedelta(days=1)).isoformat(),"products":[{"product_id":"app:"+identifier,"rate_source":"contract","terms_id":calendar["penalty_terms"][0]["terms_id"]}]})
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()["products"][0]["contract_source"],"demo_policy")
        self.assertEqual(self.client.get("/api/profile").json()["financials"],before)
