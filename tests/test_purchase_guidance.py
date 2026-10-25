import json
from types import SimpleNamespace
import unittest

from backend.assistant import AssistantReply, AssistantResponseError, ModelAssistant
from scr.delo_za_malyn.Models.Llm.client import Reply


class PurchaseGuidanceTests(unittest.TestCase):
    def extract(self, text, changes, need=None):
        model=object.__new__(ModelAssistant)
        model.output_format="json_object"
        model.client=SimpleNamespace(chat=lambda *args, **kwargs: Reply(json.dumps({"text":"Уточните назначение покупки.","changes":changes}),"stop"))
        context={"application":{"need":need or {},"financials":{}},"current_datetime":"2026-10-26T10:00:00+03:00"}
        messages=[{"role":"system","content":""},{"role":"user","content":"context"},{"role":"user","content":text}]
        return model.extract_facts(messages,context)

    def test_ambiguous_asset_preserves_amount_without_inventing_product(self):
        for text, amount in (("Хочу купить ноутбуков на 2 ляма","2000000.00"),("Нужно купить мониторы на 1,2 миллиона рублей","1200000.00"),("Купить компьютеры за 150 000 рублей","150000.00")):
            with self.subTest(text=text):
                reply=self.extract(text,{"need.purpose":"investment","need.preferred_product":"investment_loan"})
                self.assertEqual(reply.changes,{"need.requested_amount":amount})
                self.assertIn("перепродажи",reply.text)

    def test_named_investment_credit_can_cover_full_price(self):
        reply=self.extract("Нужен инвестиционный кредит на оборудование за 500 тысяч рублей",{"need.purpose":"investment","need.requested_amount":"500000.00"})
        self.assertEqual(reply.changes["need.project_cost"],"500000.00")
        self.assertNotIn("need.own_funds",reply.changes)

    def test_multiple_amounts_are_not_collapsed_into_one_purchase(self):
        reply=self.extract("Ноутбуки стоят 2 миллиона, мониторы 300 тысяч рублей",{})
        self.assertNotIn("need.requested_amount",reply.changes)

    def test_explicit_resale_is_not_reclassified_as_equipment(self):
        reply=self.extract("Ноутбуки для перепродажи за 2 миллиона рублей",{"need.purpose":"working_capital","need.requested_amount":"2000000.00"})
        self.assertEqual(reply.changes["need.purpose"],"working_capital")
        self.assertNotIn("need.project_cost",reply.changes)

    def test_only_canonical_preference_strings_are_normalized(self):
        reply=AssistantReply.model_validate({"text":"Сравню варианты","intent":"compare_options","preferences":{"minimum_term":"12","maximum_term":"36","preserve_amount":"true"}})
        self.assertEqual(reply.preferences.minimum_term,12)
        self.assertIs(reply.preferences.preserve_amount,True)
        unspecified=AssistantReply.model_validate({"text":"Сравню варианты","intent":"compare_options","preferences":{"minimum_term":None,"maximum_term":None,"preserve_amount":None}})
        self.assertEqual((unspecified.preferences.minimum_term,unspecified.preferences.maximum_term),(6,36))
        self.assertIs(unspecified.preferences.preserve_amount,True)
        for value in ("twelve","12.5","-12",True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                AssistantReply.model_validate({"text":"Сравню","intent":"compare_options","preferences":{"minimum_term":value}})
