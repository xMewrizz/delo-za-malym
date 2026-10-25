"""Build a coherent showcase in a NEW SQLite database; never reset a live one.

Run with the same backend version as the server. Credit decisions, signing,
repayments and receipts go through the normal services rather than fabricated
completion payloads. The caller can inspect the result before replacing demo data.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import argparse
import json

from backend.assistant import AssistantReply
from backend.chat import ChatService
from backend.credit_lines import CreditLines
from backend.documents import InvoiceDocuments
from backend.loan_payments import LoanPayments
from backend.models import LineOperation, LoanPaymentRequest, OverdraftOperation, SupplierPaymentOperation, UseInvoice
from backend.overdrafts import Overdrafts
from backend.service import CreditProcess
from backend.store import Store
from backend.supplier_payments import SupplierPayments
from backend.workspace import ProductWorkspace

MSK = timezone(timedelta(hours=3))


class ShowcaseAssistant:
    """Deterministic example history; the running server keeps its real provider."""
    mode, model = "demo", None

    def reply(self, messages):
        text = messages[-1]["content"]
        if text == "Нужны деньги на сезонную закупку товара.":
            return AssistantReply(text="Добавила закупку. Сколько нужно и как планируете возвращать?", intent="propose_changes",
                changes={"need.purpose": "working_capital", "need.financing_pattern": "gradual_repayment"})
        if text == "180 тысяч на 18 месяцев. Нужна вся сумма.":
            return AssistantReply(text="Запрос собран: 180 000 ₽ на 18 месяцев. Меньшую сумму не рассматриваем. Сравним условия?", intent="propose_changes",
                changes={"need.requested_amount": "180000.00", "need.minimum_acceptable_amount": "180000.00", "need.term_months": 18,
                         "need.preferred_product": "working_capital_loan"})
        return AssistantReply(text="Сравнила доступные сроки. Справа видны платёж и общая стоимость. Выберите подходящий вариант — заявку отправите отдельно.", intent="compare_options")


class Showcase:
    def __init__(self, path: Path, today: date, *, rich: bool = False):
        if path.exists():
            raise ValueError(f"Output database already exists: {path}")
        self.today = today
        self.rich = rich
        self.now = datetime.combine(today - timedelta(days=150 if rich else 110), datetime.min.time(), MSK).replace(hour=12)
        self.store = Store(path)
        self.store.initialize()
        self.process = CreditProcess(self.store, lambda: self.now)
        self.loans, self.lines = LoanPayments(self.process), CreditLines(self.process)
        self.suppliers, self.overdrafts = SupplierPayments(self.process), Overdrafts(self.process)
        self.workspace = ProductWorkspace(self.process)
        self.chats = ChatService(self.process, ShowcaseAssistant(), lambda: [], workspace=self.workspace)
        self.documents = InvoiceDocuments(self.process, self.chats)
        self.ids = {}

    def stamp(self, day):
        actual = datetime.now(MSK)
        self.now = actual if day == self.today == actual.date() else datetime.combine(day, datetime.min.time(), MSK).replace(hour=12)

    def advance(self, target):
        """Pay every accrued scheduled instalment as the example clock moves."""
        assert target >= self.now.date(), "Showcase events must be chronological"
        for _ in range(100):
            due = []
            for loan in self.process.profile()["financials"]["existing_loans"]:
                if loan.get("product_id") == "overdraft" or not loan.get("schedule"):
                    continue
                row = loan["schedule"][0]
                day = date.fromisoformat(row["date"])
                if day <= target:
                    due.append((day, loan["application_id"], loan["product_id"]))
            if not due:
                break
            day, identifier, product = min(due)
            self.stamp(max(day, self.now.date()))
            if product == "revolving_credit_line":
                state = self.lines.get(identifier)
                self.lines.operate(identifier, LineOperation(base_line_version=state["version"], request_id=uuid4(),
                    kind="repay", amount=state["accrued_interest"], confirmed=True))
            else:
                state = self.loans.get(identifier)
                amount = Decimal(state["schedule"][0]["principal_payment"]) + Decimal(state["accrued_interest"])
                self.loans.pay(identifier, LoanPaymentRequest(base_loan_version=state["version"], request_id=uuid4(),
                    calculated_on=self.now.date(), amount=f"{amount:.2f}", payment_kind="regular", confirmed=True))
        else:
            raise AssertionError("Scheduled-payment loop did not converge")
        self.stamp(target)

    def create(self, role, product, amount=None, months=12, **kwargs):
        need = {"purpose": "working_capital", "preferred_product": product, "requested_amount": amount,
                "term_months": months, "financing_pattern": "gradual_repayment", "recurring": product == "revolving_credit_line"}
        if product == "working_capital_loan":
            need["minimum_acceptable_amount"] = amount
        need.update(kwargs.pop("need", {}))
        view = self.process.create(need=need, **kwargs)
        self.ids[role] = view["application"]["application_id"]
        return view

    def refresh(self, view):
        return self.process.get(view["application"]["application_id"])

    def ready(self, view):
        view = self.refresh(view)
        identifier = view["application"]["application_id"]
        view = self.process.submit(identifier, view["application"]["application_version"])
        assessment = (view.get("result") or {}).get("assessment") or {}
        if not assessment.get("offers"):
            raise AssertionError(f"No offer for {view['application']['need']}: {view.get('result')}")
        offer = assessment["offers"][0]
        view = self.process.select(identifier, view["application"]["application_version"], assessment["assessment_id"], offer["offer_id"])
        for condition in offer.get("conditions", []):
            if condition["code"] == "guarantee_required":
                view = self.process.fulfill(identifier, view["application"]["application_version"], offer["offer_id"], condition["code"])
        assert view["state"]["status"] == "ready_to_sign", view["state"]
        return view

    def issue(self, view):
        view = self.ready(view)
        return self.process.sign(view["application"]["application_id"], view["application"]["application_version"], view["state"]["selected_offer_id"])

    def supplier(self, name, amount, number, purpose):
        state = self.suppliers.get()
        account = next("40702810" + str(d) + "00000000001" for d in range(10)
            if sum(int(n) * [7, 1, 3][i % 3] for i, n in enumerate("225" + "40702810" + str(d) + "00000000001")) % 10 == 0)
        return self.suppliers.operate(SupplierPaymentOperation(base_account_version=state["account_version"],
            recipient_name=name, recipient_inn="7707083893", recipient_account=account, recipient_bik="044525225",
            amount=amount, purpose=purpose, invoice_number=number, request_id=uuid4(), calculated_on=self.now.date(), confirmed=True))

    def build(self):
        if self.rich:
            self.issue(self.create("repaid_loan", "working_capital_loan", "120000.00", 6))
            self.advance(self.today - timedelta(days=120))
            state = self.loans.get(self.ids["repaid_loan"])
            self.loans.pay(self.ids["repaid_loan"], LoanPaymentRequest(
                base_loan_version=state["version"], request_id=uuid4(), calculated_on=self.now.date(),
                amount=state["amount_to_close"], full_repayment=True, confirmed=True))
            self.advance(self.today - timedelta(days=110))
        self.issue(self.create("refinanced_original", "working_capital_loan", "180000.00", 12))
        self.advance(self.today - timedelta(days=75))
        self.issue(self.create("working_capital", "working_capital_loan", "280000.00", 18))
        self.advance(self.today - timedelta(days=45))
        self.issue(self.create("credit_line", "revolving_credit_line", "180000.00", 12))
        self.advance(self.today - timedelta(days=43))
        line = self.lines.get(self.ids["credit_line"])
        self.lines.operate(self.ids["credit_line"], LineOperation(base_line_version=line["version"], request_id=uuid4(), kind="draw", amount="100000.00", confirmed=True))
        self.advance(self.today - timedelta(days=40))
        self.issue(self.create("investment", "investment_loan", None, 36,
            need={"purpose": "investment", "project_cost": "500000.00", "own_funds": "100000.00", "principal_grace_months": 3}))
        self.advance(self.today - timedelta(days=20))
        old = next(loan for loan in self.process.profile()["financials"]["existing_loans"] if loan["application_id"] == self.ids["refinanced_original"])
        self.issue(self.create("refinancing", "refinancing", None, 24, need={"purpose": "refinancing"}, product_details={"refinancing": {"loan_ids": [old["loan_id"]]}}))
        self.advance(self.today - timedelta(days=15))
        cash = Decimal(self.process.profile()["financials"]["cash_balance"])
        plan = {"start_date": self.now.date().isoformat(), "end_date": (self.now.date() + timedelta(days=25)).isoformat(),
            "opening_cash_balance": f"{cash:.2f}", "transactions": [
                {"transaction_id": "supplier-plan", "date": (self.now.date() + timedelta(days=5)).isoformat(), "direction": "outflow", "amount": f"{cash + 90000:.2f}"},
                {"transaction_id": "customer-plan", "date": (self.now.date() + timedelta(days=12)).isoformat(), "direction": "inflow", "amount": "250000.00"}],
            "existing_debt_payments": [], "debt_payments_confirmed": True, "cash_reserve": "0.00"}
        self.issue(self.create("overdraft", "overdraft", "120000.00", None, need={"financing_pattern": "cash_gap"}, product_details={"overdraft": plan}))
        self.advance(self.today - timedelta(days=10))
        line = self.lines.get(self.ids["credit_line"])
        self.lines.operate(self.ids["credit_line"], LineOperation(base_line_version=line["version"], request_id=uuid4(), kind="repay", amount="25000.00", confirmed=True))
        self.advance(self.today - timedelta(days=5))
        self.supplier("ООО «Оборудование Плюс»", "500000.00", "ОБ-214", "Оборудование для новой торговой точки по счёту ОБ-214. Включая НДС.")
        self.advance(self.today - timedelta(days=4))
        cash = Decimal(self.process.profile()["financials"]["cash_balance"])
        receipt = self.supplier("ООО «Торговый партнёр»", f"{cash + 35000:.2f}", "ТП-308", "Сезонная партия товара по счёту ТП-308. Включая НДС.")
        assert Decimal(receipt["quote"]["overdraft_used"]) == Decimal("35000"), receipt
        self.advance(self.today - timedelta(days=3))
        od = self.overdrafts.get(self.ids["overdraft"])
        self.overdrafts.operate(self.ids["overdraft"], OverdraftOperation(base_account_version=od["account_version"],
            request_id=uuid4(), kind="receipt", purpose="revenue", amount="165000.00", calculated_on=self.now.date(), confirmed=True))
        if self.rich:
            # A completed customer order funds further experiments. This is an actual
            # recorded receipt, not a balance override or an exemption from scoring.
            self.advance(self.today - timedelta(days=2))
            od = self.overdrafts.get(self.ids["overdraft"])
            self.overdrafts.operate(self.ids["overdraft"], OverdraftOperation(
                base_account_version=od["account_version"], request_id=uuid4(), kind="receipt", purpose="revenue",
                amount="1500000.00", calculated_on=self.now.date(), confirmed=True))
            self.supplier("ООО «Логистика Сервис»", "90000.00", "ЛС-417", "Доставка сезонной партии товара по счёту ЛС-417. Включая НДС.")
            self.advance(self.today - timedelta(days=1))
            self.supplier("ООО «Север Снабжение»", "180000.00", "СС-128", "Пополнение складских запасов по счёту СС-128. Включая НДС.")
        self.advance(self.today)
        # Pending examples are calculated only after the final portfolio is known.
        self.ready(self.create("ready_to_sign", "working_capital_loan", "100000.00", 12))
        waiting = self.create("needs_contribution", "investment_loan", None, 36,
            need={"purpose": "investment", "project_cost": "30000000.00", "own_funds": "50000.00", "principal_grace_months": 0})
        waiting = self.process.submit(waiting["application"]["application_id"], waiting["application"]["application_version"])
        assert waiting["state"]["status"] == "waiting_for_data", waiting["state"]
        manual = self.create("manual", "working_capital_loan", "330000.00", 24)
        pdf = Path("contracts/documents/supplier-invoice.pdf")
        manual = self.documents.upload(manual["application"]["application_id"], manual["application"]["application_version"], "Счёт поставщика.pdf", pdf.read_bytes())
        doc = manual["documents"][-1]
        manual = self.documents.use(manual["application"]["application_id"], doc["document_id"], UseInvoice(
            base_application_version=manual["application"]["application_version"], document_revision=doc["revision"], target="planned_expense",
            amount="450000.00", due_date=doc["extracted"]["due_date"][0]["value"], confirmed=True))
        self.workspace.explore(manual["application"]["application_id"], manual["application"]["application_version"], "working_capital_loan")
        assistant = self.process.create()
        self.ids["assistant"] = assistant["application"]["application_id"]
        chat = self.chats.create(self.ids["assistant"])
        for text in ("Нужны деньги на сезонную закупку товара.", "180 тысяч на 18 месяцев. Нужна вся сумма.", "Да, покажи варианты."):
            chat = self.chats.send(chat["chat"]["chat_id"], chat["chat"]["chat_version"], text, str(uuid4()))
            proposal = chat["chat"]["messages"][-1].get("proposal")
            if proposal:
                chat = self.chats.resolve(chat["chat"]["chat_id"], proposal["proposal_id"], chat["chat"]["chat_version"], apply=True)
        if self.rich:
            offers = self.create("offers_ready", "working_capital_loan", "400000.00", 24)
            offers = self.process.submit(offers["application"]["application_id"], offers["application"]["application_version"])
            assert (offers.get("result") or {}).get("assessment", {}).get("offers"), offers["state"]
            cancelled = self.create("cancelled_project", "investment_loan", None, 36,
                need={"purpose": "investment", "project_cost": "1000000.00", "own_funds": "200000.00"})
            self.process.cancel(cancelled["application"]["application_id"], cancelled["application"]["application_version"])
        self.validate()
        return {"schema_version": 1, "prepared_at": self.now.isoformat(), "company": "ООО «Север»",
                "contexts": {key: self.ids[key] for key in ("manual", "assistant")}, "applications": self.ids,
                "chat_id": chat["chat"]["chat_id"], "summary": self.summary()}

    def summary(self):
        calendar = self.process.calendar()
        return {"applications": len(self.store.list()), "cash_balance": self.process.profile()["financials"]["cash_balance"],
                "active_products": len(self.process.profile()["financials"]["existing_loans"]),
                "calendar_events": len(calendar["events"]), "supplier_payments": len(self.store.payments())}

    def validate(self):
        loans = self.process.profile()["financials"]["existing_loans"]
        assert {loan["product_id"] for loan in loans} == {"working_capital_loan", "investment_loan", "refinancing", "overdraft", "revolving_credit_line"}
        assert len(loans) == 5
        assert Decimal(self.process.profile()["financials"]["cash_balance"]) > 0
        assert all(row["date"] >= self.today.isoformat() for loan in loans for row in loan.get("schedule", [])), "Unexpected overdue payments"
        od = self.overdrafts.get(self.ids["overdraft"])
        assert Decimal(od["principal"]) == 0 and len(od["operations"]) >= 2
        assert Decimal(self.lines.get(self.ids["credit_line"])["principal"]) > 0
        assert self.refresh({"application": {"application_id": self.ids["refinanced_original"]}})["completion"].get("refinanced_by")
        if self.rich:
            assert Decimal(self.process.profile()["financials"]["cash_balance"]) >= Decimal("1000000.00")
            assert Decimal(self.loans.get(self.ids["repaid_loan"])["principal"]) == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--date", type=date.fromisoformat, default=datetime.now(MSK).date())
    args = parser.parse_args()
    result = Showcase(args.output, args.date).build()
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
