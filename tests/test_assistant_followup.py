import json
import unittest
from backend.assistant import AssistantReply,AssistantResponseError,ModelAssistant
from backend.assistant_guidance import workflow_help
from scr.delo_za_malyn.Models.Llm.client import Reply


class AssistantFollowupTests(unittest.TestCase):
    def setUp(self):
        self.need={"requested_amount":"3000000.00","term_months":12,"purpose":"working_capital","preferred_product":"revolving_credit_line"}

    def parse(self,**values):
        return ModelAssistant.parse_reply(Reply(json.dumps({"text":"Можно уточнить лимит и срок.","intent":"ask_clarification","question":"Что хотите уточнить?",**values}),"stop"),known_need=self.need)

    def test_question_can_repeat_current_fields_without_becoming_an_edit(self):
        reply=self.parse(changes={f"need.{key}":value for key,value in self.need.items()})
        self.assertEqual(reply.changes,{})
        self.assertEqual(reply.intent,"ask_clarification")

    def test_empty_edit_with_only_repeats_is_an_ordinary_answer(self):
        reply=self.parse(intent="propose_changes",question=None,changes={"need.term_months":12})
        self.assertEqual(reply.intent,"answer_question")
        self.assertFalse(reply.changes)

    def test_missing_intent_or_null_empty_changes_are_safe_read_only_answers(self):
        for intent,changes in ((None,None),(None,{}),("propose_changes",{}),("answer_question",None)):
            with self.subTest(intent=intent,changes=changes):
                reply=self.parse(intent=intent,changes=changes,question=None)
                self.assertEqual(reply.intent,"answer_question")
                self.assertEqual(reply.changes,{})

    def test_new_values_unknown_fields_and_authority_are_not_silently_removed(self):
        for changes in ({"need.requested_amount":"4000000.00"},{"financials.cash_balance":"9000000.00"},{"need.guaranteed":True},{"need.term_months":"12"}):
            with self.subTest(changes=changes),self.assertRaises(AssistantResponseError):
                self.parse(changes=changes)

    def test_legitimate_explicit_edit_is_preserved(self):
        reply=self.parse(intent="propose_changes",changes={"need.term_months":18,"need.requested_amount":"3000000.00"})
        self.assertEqual(reply.changes,{"need.term_months":18})

    def test_guidance_uses_pending_values_and_actual_ui_action(self):
        context={"application":{"need":{}},"state":{"status":"draft"},"previous_proposals":[{"status":"pending","changes":{f"need.{key}":value for key,value in self.need.items()}}]}
        text=workflow_help("а что можно уточнить?",context)
        self.assertIn("3 000 000",text)
        self.assertIn("12 мес.",text)
        self.assertIn("Подтвердить данные и подобрать",text)
        self.assertNotIn("поручител",text)
        for request in ("Измени срок на 18 месяцев, что дальше?","Что можно уточнить? Увеличь лимит до 4 млн","Рассчитай заявку"):
            self.assertIsNone(workflow_help(request,context))

    def test_guidance_does_not_ask_to_submit_an_incomplete_or_finished_application(self):
        context={"application":{"need":self.need},"state":{"status":"draft"},"clarification":{"title":"Какая дата поступления?"}}
        self.assertIn("Какая дата поступления?",workflow_help("Чего не хватает?",context))
        context.update(state={"status":"completed"},clarification=None)
        self.assertNotIn("Подтвердить данные",workflow_help("Что дальше?",context))
