"""Черновик будущих операций из диалога; банковские факты не меняются."""

from copy import deepcopy
from datetime import date, timedelta, timezone
from decimal import InvalidOperation

from credit_engine import calculate_overdraft
from credit_engine.overdraft_assessment import validate_debt_payments

PLAN_PATH = "product_details.overdraft"
MOSCOW = timezone(timedelta(hours=3))


def local_now(now):
    return now.astimezone(MOSCOW)


def merge_plan(record, previous, update, now):
    today = local_now(now).date().isoformat()
    plan = deepcopy(previous) if previous is not None and update.mode != "replace" else {
        "start_date": today, "end_date": today,
        "opening_cash_balance": record["application"]["financials"].get("cash_balance"),
        "cash_reserve": "0.00", "transactions": [], "existing_debt_payments": None,
    }
    if plan.get("opening_cash_balance") is None:
        plan["opening_cash_balance"] = record["application"]["financials"].get("cash_balance")
    rows = {item["transaction_id"]: deepcopy(item) for item in plan.get("transactions", [])}
    references = {item["transaction_id"]: item["loan_id"] for item in plan.get("existing_debt_payments") or []}
    for identifier in update.removed_transaction_ids:
        if identifier not in rows:
            raise ValueError("Для удаления укажите существующую операцию плана.")
        rows.pop(identifier)
        references.pop(identifier, None)
    for operation in update.transactions:
        values = operation.model_dump(exclude_unset=True)
        identifier = values.pop("transaction_id")
        if "loan_id" in values:
            loan_id = values.pop("loan_id")
            if loan_id:
                references[identifier] = loan_id
            else:
                references.pop(identifier, None)
        row = rows.setdefault(identifier, {"transaction_id": identifier, "direction": None, "date": None, "amount": None})
        row.update(values)
        if row["direction"] == "inflow":
            if identifier in references:
                raise ValueError("Кредитный платёж должен быть расходом, а не поступлением.")
    if len(rows) > 100:
        raise ValueError("В плане поддерживается до 100 операций.")
    plan["transactions"] = list(rows.values())
    dates = [item["date"] for item in rows.values() if item.get("date")]
    if dates and min(dates) >= today:
        # Новый ближайший расход не должен оказаться за пределами старого будущего периода.
        if plan.get("start_date", today) != today:
            plan["start_date"] = today
            plan["opening_cash_balance"] = record["application"]["financials"].get("cash_balance")
    plan["end_date"] = max([plan.get("end_date") or today, plan.get("start_date") or today, *dates])
    active = [loan for loan in record["application"]["financials"].get("existing_loans") or []
              if float(loan.get("outstanding_principal") or 0) > 0]
    # Изменение операций требует повторно проверить полноту кредитных платежей.
    confirmed = not active or update.debt_payments_confirmed is True or (
        update.debt_payments_confirmed is None and not update.transactions and not update.removed_transaction_ids
        and plan.get("debt_payments_confirmed", plan.get("existing_debt_payments") is not None))
    # Ссылки храним и в неполном черновике, подтверждение — отдельно.
    plan["existing_debt_payments"] = [{"loan_id": loan, "transaction_id": identifier} for identifier, loan in references.items()]
    plan["debt_payments_confirmed"] = confirmed
    if update.cash_reserve is not None:
        plan["cash_reserve"] = update.cash_reserve
    return plan


def plan_issues(record, plan, now):
    result = calculate_overdraft(engine_plan(plan), "3000000.00")
    issues = [{"field": issue.field.replace("scenario", PLAN_PATH, 1), "message": issue.message}
              for issue in result.issues]
    if result.calculation is not None:
        try:
            debt_issues = validate_debt_payments(plan, record["application"]["financials"].get("existing_loans") or [],
                                               date.fromisoformat(plan["start_date"]), date.fromisoformat(plan["end_date"]))
        except (ValueError, TypeError, KeyError, InvalidOperation):
            # Неполные сведения о кредите проверит финансовый модуль; график остаётся доступен.
            debt_issues = ()
        issues.extend({"field": issue.field, "code": issue.code, "message": issue.message} for issue in debt_issues)
    today = local_now(now).date().isoformat()
    if plan.get("start_date") and plan["start_date"] < today:
        issues.append({"field": PLAN_PATH + ".start_date", "message": "План начинается в прошлом. Уточните даты будущих операций."})
    directions = {item.get("direction") for item in plan["transactions"]}
    for direction, label in (("outflow", "расход"), ("inflow", "поступление для погашения")):
        if direction not in directions:
            issues.append({"field": PLAN_PATH + ".transactions", "message": "Добавьте ожидаемое " + label + "."})
    loans = {loan["loan_id"] for loan in record["application"]["financials"].get("existing_loans") or []
             if float(loan.get("outstanding_principal") or 0) > 0}
    if loans and not plan.get("debt_payments_confirmed"):
        issues.append({"field": PLAN_PATH + ".existing_debt_payments", "message": "Уточните даты платежей по действующим кредитам либо подтвердите, что в период плана их нет."})
    rows = {item["transaction_id"]: item for item in plan["transactions"]}
    for reference in plan.get("existing_debt_payments") or []:
        if reference["loan_id"] not in loans or rows.get(reference["transaction_id"], {}).get("direction") != "outflow":
            issues.append({"field": PLAN_PATH + ".existing_debt_payments", "message": "Свяжите кредитный платёж с действующим кредитом и отдельным расходом."})
    return issues


def engine_plan(plan):
    return {key: deepcopy(value) for key, value in plan.items() if key != "debt_payments_confirmed"}
