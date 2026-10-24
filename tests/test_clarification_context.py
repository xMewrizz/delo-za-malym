from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from uuid import uuid4
import unittest

from backend.assistant import AssistantReply
from backend.chat import ChatService
from backend.service import CreditProcess
from backend.store import Store


class ClarificationContextTests(unittest.TestCase):
    def test_conversational_product_question_hides_unrelated_amount_editor(self):
        with TemporaryDirectory() as directory:
            store = Store(Path(directory) / "cabinet.db")
            store.initialize()
            process = CreditProcess(store, lambda: datetime.fromisoformat("2026-10-24T12:00:00+03:00"))
            assistant = SimpleNamespace(mode="model", model="test", reply=lambda messages: AssistantReply(
                text="Что вам ближе: разовая закупка или регулярные закупки?", intent="ask_clarification",
                question="Что вам ближе: разовая закупка или регулярные закупки?"))
            service = ChatService(process, assistant, lambda: [])
            application = process.create(need={"purpose":"working_capital","financing_pattern":"gradual_repayment"})
            chat = service.create(application["application"]["application_id"])
            self.assertEqual(chat["clarification"]["field"], "need.requested_amount")
            view = service.send(chat["chat"]["chat_id"], chat["chat"]["chat_version"], "Какие продукты есть?", str(uuid4()))
            self.assertIsNone(view["clarification"])
            self.assertEqual(view["record"]["application"], application["application"])
            assistant.reply = lambda messages: AssistantReply(text="Учла регулярные закупки.", intent="propose_changes", changes={"need.preferred_product":"revolving_credit_line"})
            view = service.send(chat["chat"]["chat_id"], view["chat"]["chat_version"], "Регулярные закупки", str(uuid4()))
            self.assertEqual(view["clarification"]["field"], "need.requested_amount")
            title = view["clarification"]["title"]
            assistant.reply = lambda messages: AssistantReply(text=title, intent="ask_clarification", question=title)
            view = service.send(chat["chat"]["chat_id"], view["chat"]["chat_version"], "Уточните вопрос", str(uuid4()))
            self.assertEqual(view["clarification"]["field"], "need.requested_amount")


if __name__ == "__main__":
    unittest.main()
