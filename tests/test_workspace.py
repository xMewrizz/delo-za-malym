from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4
from unittest.mock import patch
import os
from threading import Event
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from backend.assistant import AssistantReply
from backend import demo
from backend.main import create_app
from backend.models import LoanPreferences


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.now = datetime.fromisoformat("2026-10-21T12:00:00+03:00")
        self.app = create_app(Path(self.directory.name)/"test.sqlite3", clock=lambda:self.now)
        self.client = TestClient(self.app).__enter__()
        self.record = self.case()

    def tearDown(self):
        self.client.__exit__(None,None,None)
        self.directory.cleanup()

    def case(self, product="working_capital_loan", scenario="01_approved"):
        response = self.client.post(f"/api/demo/scenarios/{product}/{scenario}")
        self.assertEqual(response.status_code,201,response.text)
        return response.json()

    def path(self, suffix=""):
        return "/api/applications/"+self.record["application"]["application_id"]+suffix

    def post(self, suffix, **extra):
        if suffix.startswith("/imports/") and suffix.endswith("/confirm"):
            extra.setdefault("base_import_revision", 1)
        return self.client.post(self.path(suffix),json={"base_application_version":self.record["application"]["application_version"],**extra})

    def explore(self, product="working_capital_loan", **extra):
        response = self.post("/explorations",product_id=product,**extra)
        self.assertEqual(response.status_code,200,response.text)
        self.record = response.json()
        return self.record["explorations"][-1]

    def patch(self, changes):
        response = self.client.patch(self.path(),json={"base_application_version":self.record["application"]["application_version"],"changes":changes})
        self.assertEqual(response.status_code,200,response.text)
        self.record=response.json()

    def test_all_eligible_terms_and_schedules_without_changing_application(self):
        original=deepcopy(self.record)
        result=self.explore()["result"]
        self.assertEqual(result["status"],"options_ready")
        self.assertEqual([item["term_months"] for item in result["options"]],[12,18,24,36])
        self.assertEqual(self.record["application"],original["application"])
        self.assertEqual(self.record["state"],original["state"])
        self.assertEqual(self.record["result"],original["result"])
        for option in result["options"]:
            self.assertEqual(len(option["schedule"]),option["term_months"])
            self.assertEqual(option["schedule"][-1]["closing_balance"],"0.00")
        self.assertEqual(len([row for row in result["options"] if "Исходный запрос" in row["labels"]]),1)

    def test_missing_term_can_be_selected_from_verified_options(self):
        self.patch({"need.term_months":None})
        self.assertEqual(len(self.explore()["result"]["options"]),4)
        self.assertIsNone(self.record["application"]["need"]["term_months"])

    def test_payment_filter_and_priority_do_not_relax_credit_capacity(self):
        result=self.explore(preferences={"maximum_monthly_payment":"30000.00","priority":"lowest_payment"})["result"]
        self.assertEqual([item["term_months"] for item in result["options"]],[36,24])
        self.assertEqual(result["available_before_filters"],4)
        for option in result["options"]:
            self.assertLessEqual(float(option["maximum_payment"]),float(option["available_monthly_payment"]))
        result=self.explore(preferences={"maximum_monthly_payment":"100.00"})["result"]
        self.assertEqual(result["status"],"no_matching_options")
        self.assertEqual(result["options"],[])

    def test_reduced_amount_requires_confirmed_minimum(self):
        self.patch({"need.requested_amount":"1000000.00"})
        result=self.explore(preferences={"preserve_amount":False})["result"]
        self.assertTrue(all(row["amount"]=="1000000.00" for row in result["options"]))
        self.patch({"need.minimum_acceptable_amount":"500000.00"})
        result=self.explore(preferences={"preserve_amount":False})["result"]
        self.assertTrue(any(float(row["amount"])<1000000 for row in result["options"]))
        self.assertTrue(all(float(row["amount"])>=500000 for row in result["options"]))

    def test_decline_is_not_removed_by_filters(self):
        self.record=self.case(scenario="06_declined")
        result=self.explore(preferences={"maximum_monthly_payment":"9999999.00"})["result"]
        self.assertEqual(result["options"],[])

    def test_technical_check_can_be_retried_during_exploration(self):
        self.record=self.case(scenario="07_check_unavailable")
        self.assertEqual(self.explore()["result"]["status"],"check_retry_pending")
        self.assertEqual(self.explore()["result"]["status"],"options_ready")

    def test_apply_stored_option_then_final_review_and_disbursement(self):
        exploration=self.explore()
        option=next(row for row in exploration["result"]["options"] if row["term_months"]==24)
        self.assertEqual(self.post(f"/explorations/{exploration['exploration_id']}/apply",option_id=option["option_id"],confirmed=False).status_code,422)
        response=self.post(f"/explorations/{exploration['exploration_id']}/apply",option_id=option["option_id"],confirmed=True)
        self.record=response.json()
        self.assertEqual(self.record["application"]["need"]["term_months"],24)
        self.assertEqual(self.record["application"]["application_version"],2)
        self.record=self.post("/submit",confirmed=True).json()
        assessment=self.record["result"]["assessment"]
        final=assessment["offers"][0]
        self.record=self.post("/select-offer",assessment_id=assessment["assessment_id"],offer_id=final["offer_id"]).json()
        self.record=self.post("/sign",offer_id=final["offer_id"],confirmed=True).json()
        self.assertEqual(self.record["state"]["status"],"disbursed")
        self.assertEqual(len(self.record["completion"]["schedule"]),24)
        self.assertEqual(self.record["submitted_versions"][0]["application"]["need"]["term_months"],24)

    def test_stale_expired_and_foreign_options_cannot_be_applied(self):
        exploration=self.explore();option=exploration["result"]["options"][0]
        self.assertEqual(self.post(f"/explorations/{exploration['exploration_id']}/apply",option_id="foreign",confirmed=True).status_code,404)
        self.patch({"need.term_months":18})
        self.assertEqual(self.post(f"/explorations/{exploration['exploration_id']}/apply",option_id=option["option_id"],confirmed=True).json()["detail"]["code"],"exploration_stale")
        exploration=self.explore();option=exploration["result"]["options"][0];self.now+=timedelta(days=8)
        self.assertEqual(self.post(f"/explorations/{exploration['exploration_id']}/apply",option_id=option["option_id"],confirmed=True).json()["detail"]["code"],"exploration_expired")

    def test_overdraft_unknown_limit_is_calculated_without_modifying_request(self):
        self.record=self.case("overdraft","01_overdraft_approved")
        self.patch({"need.requested_amount":None})
        exploration=self.explore("overdraft")
        self.assertEqual(exploration["result"]["status"],"options_ready")
        self.assertEqual(exploration["result"]["suggested_amount"],"150000.00")
        self.assertIsNone(self.record["application"]["need"]["requested_amount"])
        self.assertTrue(exploration["result"]["options"][0]["suggested_limit"])

    def test_overdraft_below_required_limit_proposes_sufficient_limit(self):
        self.record=self.case("overdraft","01_overdraft_approved")
        self.patch({"need.requested_amount":"100000.00"})
        result=self.explore("overdraft")["result"]
        self.assertEqual(result["status"],"options_ready")
        self.assertEqual(result["options"][0]["amount"],"150000.00")

    def test_delay_outside_plan_requires_explicit_extension(self):
        self.record=self.case("overdraft","01_overdraft_approved")
        original=deepcopy(self.record["application"])
        result=self.explore("overdraft",delay={"transaction_id":"customer-001","days":7})["result"]
        self.assertEqual(result["status"],"needs_information")
        self.assertEqual(result["options"],[])
        self.assertTrue(result["horizon_extension_required"])
        self.assertEqual(self.record["application"],original)

    def test_delay_in_plan_increases_interest_and_is_separately_applied(self):
        self.record=self.case("overdraft","01_overdraft_approved")
        plan=deepcopy(self.record["application"]["product_details"]["overdraft"])
        plan["end_date"]=(datetime.fromisoformat(plan["end_date"])+timedelta(days=7)).date().isoformat()
        self.patch({"product_details":{"overdraft":plan}})
        exploration=self.explore("overdraft",delay={"transaction_id":"customer-001","days":7});result=exploration["result"]
        self.assertEqual(result["status"],"options_ready")
        self.assertGreater(float(result["calculation"]["total_interest"]),float(result["baseline"]["total_interest"]))
        self.assertEqual(self.record["application"]["product_details"]["overdraft"],plan)
        option=result["options"][0]
        self.record=self.post(f"/explorations/{exploration['exploration_id']}/apply",confirmed=True,option_id=option["option_id"]).json()
        updated=self.record["application"]["product_details"]["overdraft"]
        self.assertNotEqual(updated["transactions"][1]["date"],plan["transactions"][1]["date"])
        self.assertEqual(self.record["application"]["need"]["term_months"],None)

    def test_delay_cannot_move_expense_or_unknown_operation(self):
        self.record=self.case("overdraft","01_overdraft_approved")
        for identifier in ["purchase-001","missing"]:
            self.assertEqual(self.post("/explorations",product_id="overdraft",delay={"transaction_id":identifier,"days":7}).status_code,422)

    def test_validation_and_invalid_model_configuration_do_not_disable_base_api(self):
        self.assertEqual(self.post("/explorations",product_id="working_capital_loan",preferences={"maximum_monthly_payment":"NaN"}).status_code,422)
        self.assertEqual(self.post("/explorations",product_id="working_capital_loan",preferences={"minimum_term":36,"maximum_term":6}).status_code,422)
        self.assertEqual(self.post("/explorations",product_id="working_capital_loan",delay={"transaction_id":"x","days":7}).status_code,422)
        with patch.dict(os.environ,{"CHAT_MODE":"model","LLM_MODEL":""}):
            app=create_app(Path(self.directory.name)/"fallback.db")
        with TestClient(app) as client:
            self.assertEqual(client.get("/health").status_code,200)
            self.assertEqual(client.get("/cabinet").status_code,200)
            self.assertEqual(client.get("/api/chat/config").json()["model"],"Модель не настроена")

    def csv(self):
        response=self.client.get(self.path("/financials.csv"));self.assertEqual(response.status_code,200);return response.text

    def missing_bank_history(self):
        profile, simulator = demo.profile(self.now)
        profile["financials"]["monthly"] = None
        simulator["bank_financials"]["monthly"] = None
        with patch("backend.service.demo.profile", return_value=(profile, simulator)):
            self.record = self.client.post("/api/applications", json={"need": self.record["application"]["need"]}).json()

    def test_import_preview_changes_nothing_then_confirms_with_source(self):
        content=self.csv().replace("1000000.00","1100000.00",1)
        self.missing_bank_history()
        original=deepcopy(self.record["application"])
        self.record=self.post("/imports",filename="отчёт.csv",content=content).json()
        imported=self.record["imports"][-1]
        self.assertEqual(imported["status"],"ready")
        self.assertEqual(self.record["application"],original)
        self.assertTrue(imported["rows"][0]["changed"])
        self.assertIsNone(imported["rows"][0]["previous"])
        self.record=self.post(f"/imports/{imported['import_id']}/confirm",confirmed=True).json()
        self.assertEqual(self.record["imports"][-1]["status"],"applied")
        self.assertEqual(self.record["application"]["financials"]["monthly"][0]["operating_inflow"],"1100000.00")
        self.assertTrue(self.record["imports"][-1]["sha256"])
        self.assertEqual(self.post(f"/imports/{imported['import_id']}/confirm",confirmed=True).status_code,409)

    def test_csv_cannot_overwrite_known_bank_history(self):
        original = deepcopy(self.record["application"])
        self.record = self.post("/imports", filename="report.csv",
            content=self.csv().replace("1000000.00", "9000000.00", 1)).json()
        imported = self.record["imports"][-1]
        response = self.post(f"/imports/{imported['import_id']}/confirm", confirmed=True)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"]["code"], "bank_data_read_only")
        saved = self.client.get(self.path()).json()
        self.assertEqual(saved["application"], original)
        self.assertEqual(saved["imports"][-1]["status"], "ready")

    def test_invalid_csv_formats_periods_duplicates_and_values_are_not_applied(self):
        source=self.csv();lines=source.splitlines()
        for content in [source.replace("1000000.00","-1.00",1),"\n".join(lines[:-1]),source+lines[1]+"\n",source.replace(lines[1][:7],"2099-01",1)]:
            self.record=self.post("/imports",filename="test.csv",content=content).json();imported=self.record["imports"][-1]
            self.assertEqual(imported["status"],"invalid")
            self.assertEqual(self.post(f"/imports/{imported['import_id']}/confirm",confirmed=True).status_code,409)
        for filename,content in [("x.pdf",source),("x.csv","wrong,header\n"),("x.csv","\ufeff"),("x.csv",'month,operating_inflow,operating_outflow,taxes\n"unclosed')]:
            self.assertEqual(self.post("/imports",filename=filename,content=content).status_code,422)

    def test_stale_import_cannot_overwrite_newer_financials(self):
        self.record=self.post("/imports",filename="test.csv",content=self.csv()).json();imported=self.record["imports"][-1]
        self.patch({"need.term_months":18})
        self.assertEqual(self.post(f"/imports/{imported['import_id']}/confirm",confirmed=True).json()["detail"]["code"],"import_stale")

    def test_utf8_bom_and_semicolon_are_supported(self):
        content="\ufeff"+self.csv().replace(",",";")
        result=self.post("/imports",filename="test.csv",content=content).json()["imports"][-1]
        self.assertEqual(result["status"],"ready")

    def test_import_corrections_preserve_source_and_require_current_revision(self):
        content = self.csv()
        self.missing_bank_history()
        self.record=self.post("/imports",filename="test.csv",content=content).json()
        imported=deepcopy(self.record["imports"][-1]);monthly=[row["values"] for row in imported["rows"]]
        monthly[0]["operating_inflow"]="1200000.00"
        self.record=self.post(f"/imports/{imported['import_id']}/edit",base_import_revision=1,monthly=monthly).json()
        corrected=self.record["imports"][-1]
        self.assertEqual(corrected["revision"],2)
        self.assertEqual(corrected["sha256"],imported["sha256"])
        self.assertEqual(corrected["source_rows"][0]["values"]["operating_inflow"],"1000000.00")
        self.assertEqual(corrected["rows"][0]["values"]["operating_inflow"],"1200000.00")
        self.assertEqual(self.post(f"/imports/{imported['import_id']}/confirm",base_import_revision=1,confirmed=True).json()["detail"]["code"],"import_stale")
        self.record=self.post(f"/imports/{imported['import_id']}/confirm",base_import_revision=2,confirmed=True).json()
        self.assertEqual(self.record["application"]["financials"]["monthly"][0]["operating_inflow"],"1200000.00")


class AccumulatedChatTests(unittest.TestCase):
    def test_slow_assistant_does_not_block_form_and_detects_field_conflict(self):
        entered,release=Event(),Event()
        class Assistant:
            mode="model";model="test"
            def reply(self,messages):
                entered.set()
                if not release.wait(5):raise TimeoutError()
                return AssistantReply(text="Предлагаю сумму.",intent="propose_changes",changes={"need.requested_amount":"500000.00"})
        with TemporaryDirectory() as directory,TestClient(create_app(Path(directory)/"test.db",assistant=Assistant())) as client:
            view=client.post("/api/chats",json={}).json();path="/api/chats/"+view["chat"]["chat_id"]
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(client.post,path+"/messages",json={"base_chat_version":1,"request_id":str(uuid4()),"text":"500 тысяч"})
                self.assertTrue(entered.wait(2))
                try:
                    response=client.patch("/api/applications/"+view["chat"]["application_id"],json={"base_application_version":1,"changes":{"need.requested_amount":"600000.00"}})
                    self.assertEqual(response.status_code,200)
                finally:
                    release.set()
                response=future.result(timeout=5)
            self.assertEqual(response.status_code,200)
            view=response.json()
            self.assertEqual(view["record"]["application"]["need"]["requested_amount"],"600000.00")
            self.assertEqual(view["chat"]["messages"][-1]["proposal"]["conflicts"],["need.requested_amount"])

    def test_questions_accumulate_edit_reject_and_rebase_fields(self):
        class Assistant:
            mode="model";model="test"
            answer=AssistantReply(text="Сумма?",intent="propose_changes",changes={"need.requested_amount":"500000.00"})
            def reply(self,messages):return self.answer
        assistant=Assistant()
        with TemporaryDirectory() as directory,TestClient(create_app(Path(directory)/"test.db",assistant=assistant)) as client:
            view=client.post("/api/chats",json={}).json();path="/api/chats/"+view["chat"]["chat_id"]
            def send(text):return client.post(path+"/messages",json={"base_chat_version":view["chat"]["chat_version"],"request_id":str(uuid4()),"text":text}).json()
            view=send("500 тысяч")
            assistant.answer=AssistantReply(text="Это сумма финансирования.",intent="answer_question")
            view=send("Сумма чего?")
            self.assertEqual(view["chat"]["messages"][1]["proposal"]["status"],"pending")
            assistant.answer=AssistantReply(text="Срок?",intent="propose_changes",changes={"need.term_months":18})
            view=send("На полтора года")
            proposal=view["chat"]["messages"][-1]["proposal"]
            self.assertEqual(proposal["changes"],{"need.requested_amount":"500000.00","need.term_months":18})
            app_id=view["chat"]["application_id"]
            client.patch("/api/applications/"+app_id,json={"base_application_version":1,"changes":{"need.purpose":"working_capital"}})
            view=client.post(path+f"/proposals/{proposal['proposal_id']}/confirm",json={"base_chat_version":view["chat"]["chat_version"],"confirmed":True}).json()
            self.assertEqual(view["record"]["application"]["application_version"],3)
            self.assertEqual(view["record"]["application"]["need"]["purpose"],"working_capital")
            assistant.answer=AssistantReply(text="Изменим?",intent="propose_changes",changes={"need.term_months":24,"need.own_funds":"0.00"})
            view=send("Ещё вариант")
            proposal=view["chat"]["messages"][-1]["proposal"]
            view=client.post(path+f"/proposals/{proposal['proposal_id']}/edit",json={"base_chat_version":view["chat"]["chat_version"],"base_application_version":3,"changes":{"need.term_months":36}}).json()
            self.assertEqual(view["chat"]["messages"][-1]["proposal"]["changes"],{"need.term_months":36})
            self.assertIsNone(view["record"]["application"]["need"]["own_funds"])

    def test_chat_comparison_calls_real_engine_without_changing_application(self):
        class Assistant:
            mode="model";model="test"
            def reply(self,messages):return AssistantReply(text="Показываю варианты.",intent="compare_options",preferences=LoanPreferences(maximum_monthly_payment="30000.00"))
        with TemporaryDirectory() as directory,TestClient(create_app(Path(directory)/"test.db",assistant=Assistant())) as client:
            record=client.post("/api/demo/scenarios/working_capital_loan/01_approved").json()
            view=client.post("/api/chats",json={"application_id":record["application"]["application_id"]}).json()
            response=client.post("/api/chats/"+view["chat"]["chat_id"]+"/messages",json={"base_chat_version":1,"request_id":str(uuid4()),"text":"Платёж до 30 тысяч"})
            self.assertEqual(response.status_code,200,response.text);view=response.json()
            self.assertEqual(view["record"]["application"],record["application"])
            self.assertEqual([row["term_months"] for row in view["record"]["explorations"][-1]["result"]["options"]],[24,36])


if __name__ == "__main__":
    unittest.main()
