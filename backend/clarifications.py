"""Следующий вопрос по недостающим данным, а не по формулировке модели."""

from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal
from hashlib import sha256
import json
import re

from .overdraft_chat import PLAN_PATH, local_now, plan_issues
from .service import EDITABLE_STATES


def pending_proposal(chat):
    return next((message["proposal"] for message in reversed(chat["messages"])
                 if (message.get("proposal") or {}).get("status") == "pending"), None)


def next_clarification(chat, record, now):
    if record["state"]["status"] not in EDITABLE_STATES:
        return None
    pending = pending_proposal(chat)
    need = deepcopy(record["application"]["need"])
    for path, value in (pending or {}).get("changes", {}).items():
        if path.startswith("need."):
            need[path[5:]] = value
    if need.get("purpose") == "refinancing" or need.get("preferred_product") == "refinancing":
        return None  # Выбор банковских кредитов выполняется в рабочей области.
    plan = (pending or {}).get("changes", {}).get(PLAN_PATH) or record["application"].get("product_details", {}).get("overdraft")
    today = local_now(now).date()

    def card(field, title, choices=(), *, input_type=None, transaction_id=None, direction=None):
        content = {"field": field, "title": title, "input_type": input_type, "transaction_id": transaction_id,
                   "direction": direction, "choices": list(choices)}
        seed = [chat["chat_id"], chat["chat_version"], record["application"]["application_version"], today.isoformat(), content]
        content["question_id"] = sha256(json.dumps(seed, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]
        return content

    def choice(identifier, label, changes=None, plan_update=None):
        return {"choice_id": identifier, "label": label, "_changes": changes or {}, "_plan": plan_update}

    if need.get("purpose") == "investment" or need.get("preferred_product") == "investment_loan":
        if not need.get("project_cost"):
            return card("need.project_cost", "Сколько стоит весь проект или оборудование?", input_type="money")
        if need.get("own_funds") is None:
            return card("need.own_funds", "Какую сумму вложите сами? Нужно не менее 20% стоимости проекта.", input_type="money")
        if need.get("principal_grace_months") is None:
            return card("need.principal_grace_months", "Нужна отсрочка основного долга? Проценты платятся ежемесячно.", [
                choice("none", "Без отсрочки", {"need.principal_grace_months": 0}),
                choice("three", "3 месяца", {"need.principal_grace_months": 3}),
                choice("six", "6 месяцев", {"need.principal_grace_months": 6})])
        return None

    if plan:
        for operation in plan.get("transactions", []):
            identifier = operation["transaction_id"]
            if not operation.get("direction"):
                return card(PLAN_PATH + ".direction", "Эти деньги нужно заплатить или они поступят?", [
                    choice("outflow", "Нужно заплатить", plan_update={"transactions": [{"transaction_id": identifier, "direction": "outflow"}]}),
                    choice("inflow", "Деньги поступят", plan_update={"transactions": [{"transaction_id": identifier, "direction": "inflow"}]})], transaction_id=identifier)
            expense = operation["direction"] == "outflow"
            if operation.get("amount") is None:
                return card(PLAN_PATH + ".amount", "Сколько нужно заплатить?" if expense else "Сколько денег поступит?",
                            input_type="money", transaction_id=identifier)
            if not operation.get("date") or operation["date"] < today.isoformat():
                amount = f"{Decimal(operation['amount']):,.2f}".replace(",", " ").replace(".00", "")
                dates = [("today", "Сегодня", 0), ("tomorrow", "Завтра", 1), ("week", "Через неделю", 7)]
                return card(PLAN_PATH + ".date", ("Когда нужно заплатить " if expense else "Когда поступят ") + amount + " ₽?", [
                    choice(key, label, plan_update={"transactions": [{"transaction_id": identifier, "date": (today + timedelta(days=days)).isoformat()}]})
                    for key, label, days in dates], input_type="date", transaction_id=identifier)
        directions = {row.get("direction") for row in plan.get("transactions", [])}
        ordinary = need.get("preferred_product") == "working_capital_loan" or need.get("financing_pattern") == "gradual_repayment"
        for direction, title in ([] if ordinary else [("outflow", "Сколько нужно заплатить до поступления денег?"), ("inflow", "Какое поступление ожидаете для погашения?")]):
            if direction not in directions:
                return card(PLAN_PATH + ".new_operation", title, input_type="money", direction=direction)
        issues = plan_issues(record, plan, now, (pending or {}).get("changes"))
        active = [loan for loan in record["application"]["financials"].get("existing_loans") or [] if Decimal(loan.get("outstanding_principal") or "0") > 0]
        regular_missing = any(issue.get("code") == "incomplete_debt_payment_plan" for issue in issues)
        if active and (not plan.get("debt_payments_confirmed", plan.get("existing_debt_payments") is not None) or regular_missing):
            choices = []
            if not regular_missing:
                choices.append(choice("debt_reviewed", "Все платежи учтены" if plan.get("existing_debt_payments") else "В эти даты платежей нет", plan_update={"debt_payments_confirmed": True}))
            for index, loan in enumerate(active, 1):
                amount = f"{Decimal(loan['monthly_payment']):,.0f}".replace(",", " ") + " ₽" if loan.get("monthly_payment") is not None else "сумму уточним"
                choices.append(choice("loan_" + str(index), "Добавить платёж · кредит " + str(index) + " · " + amount,
                                      plan_update={"_add_loan": loan["loan_id"]}))
            title = "Добавьте регулярный платёж за полный месяц плана" if regular_missing else "Платежи по текущим кредитам за эти даты учтены?"
            return card(PLAN_PATH + ".existing_debt_payments", title, choices)
        if ordinary and need.get("requested_amount") is None:
            return card("need.requested_amount", "Сколько хотите занять?", input_type="money")
        return None

    if need.get("purpose") is None:
        return card("need.purpose", "Для какой задачи нужны деньги?", [
            choice("purchase", "Закупить товар или сырьё", {"need.purpose": "working_capital"}),
            choice("cash_gap", "Заплатить до поступления денег", {"need.purpose": "working_capital", "need.financing_pattern": "cash_gap"})])
    if need.get("purpose") != "working_capital":
        return None
    if need.get("financing_pattern") is None and need.get("preferred_product") is None:
        return card("need.financing_pattern", "Как планируете возвращать деньги?", [
            choice("gradual", "Постепенно из выручки", {"need.financing_pattern": "gradual_repayment"}),
            choice("receipt", "Из ближайшего поступления", {"need.financing_pattern": "cash_gap"})])
    if need.get("financing_pattern") == "cash_gap" or need.get("preferred_product") == "overdraft":
        return card(PLAN_PATH + ".new_operation", "Сколько нужно заплатить до поступления денег?", input_type="money", direction="outflow")
    if need.get("requested_amount") is None:
        return card("need.requested_amount", "Сколько хотите занять?", input_type="money")
    return None


def public_clarification(card):
    if card is None:
        return None
    result = deepcopy(card)
    result["choices"] = [{key: value for key, value in choice.items() if not key.startswith("_")} for choice in card["choices"]]
    return result


def resolve_answer(card, record, *, choice_id=None, value=None, now, operation_id):
    if choice_id is not None:
        choice = next((item for item in card["choices"] if item["choice_id"] == choice_id), None)
        if not choice:
            raise ValueError("Такого готового ответа нет в текущем вопросе.")
        changes, plan = deepcopy(choice["_changes"]), deepcopy(choice["_plan"])
        if plan and "_add_loan" in plan:
            loan = next(row for row in record["application"]["financials"]["existing_loans"] if row["loan_id"] == plan["_add_loan"])
            plan = {"transactions": [{"transaction_id": operation_id, "direction": "outflow", "amount": loan["monthly_payment"], "loan_id": loan["loan_id"], "date": None}]}
        return changes, plan, choice["label"]
    if not card["input_type"]:
        raise ValueError("Выберите готовый ответ или напишите свой ответ в чат.")
    if card["input_type"] == "money":
        value = value.strip().replace(" ", "").replace("\u00a0", "").replace("\u202f", "").replace(",", ".")
        if not re.fullmatch(r"[0-9]{1,12}(?:\.[0-9]{1,2})?", value) or Decimal(value) <= 0:
            raise ValueError("Укажите положительную сумму в рублях, до двух знаков после запятой.")
        value = f"{Decimal(value):.2f}"
        label = value + " ₽"
    else:
        if date.fromisoformat(value).isoformat() != value or not local_now(now).date() <= date.fromisoformat(value) <= local_now(now).date() + timedelta(days=365):
            raise ValueError("Укажите будущую дату в пределах года.")
        label = date.fromisoformat(value).strftime("%d.%m.%Y")
    if card["field"].startswith("need."):
        return {card["field"]: value}, None, label
    if card["field"].endswith(".new_operation"):
        return {}, {"transactions": [{"transaction_id": operation_id, "direction": card["direction"], "amount": value, "date": None}]}, label
    field = "amount" if card["input_type"] == "money" else "date"
    return {}, {"transactions": [{"transaction_id": card["transaction_id"], field: value}]}, label
