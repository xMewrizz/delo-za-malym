"""Выданные кредиты клиента, их обязательства и события платёжного календаря."""

from copy import deepcopy
from decimal import Decimal
from datetime import date, datetime, timezone, timedelta
import re

PREFIX = "cabinet-loan:"
LINE_PREFIX = "cabinet-line:"


def refinanced_loans(records):
    return {item["loan_id"]: {"application_id": record["application"]["application_id"],
                              "closed_at": record["completion"]["completed_at"], **item}
            for record in records if belongs_to_client(record)
            for item in (record.get("completion") or {}).get("repaid_loans", [])}


def cash_disbursed(records):
    # Выдачи и фактические движения линии; открытие лимита не создаёт денег.
    issued = sum((Decimal(record["completion"]["amount"]) for record in records if belongs_to_client(record)
                and (record.get("completion") or {}).get("type") == "disbursement"
                and record["completion"].get("product_id") != "refinancing"), Decimal("0.00"))
    return issued + sum((Decimal(op["drawn"]) - Decimal(op["principal_paid"]) - Decimal(op["interest_paid"])
        for record in records if belongs_to_client(record)
        for op in ((record.get("completion") or {}).get("credit_line") or {}).get("operations", [])), Decimal("0.00"))


def belongs_to_client(record):
    # Изолированные сценарии проверяют разные финансовые профили, не общий счёт.
    created = next((item for item in record.get("events", []) if item["type"] == "application_created"), {})
    return not created.get("details", {}).get("scenario")


def issued_loans(records, now=None):
    loans = []
    closed = refinanced_loans(records)
    for record in records:
        completion = record.get("completion") or {}
        line = completion.get("credit_line")
        if belongs_to_client(record) and line and not line.get("closed_at"):
            from credit_engine.revolving import line_state, line_schedule, local_date
            today = local_date(now or datetime.now(timezone.utc))
            state = line_state(line, today)
            loans.append({"loan_id": LINE_PREFIX + completion["operation_id"],
                "application_id": record["application"]["application_id"], "product_id": "revolving_credit_line", "is_commitment": True,
                "outstanding_principal": state["principal"], "monthly_payment": state["capacity_reserve"],
                "maturity_date": line["maturity_date"], "schedule": line_schedule(line, today),
                "credit_limit": line["limit"], "accrued_interest": state["accrued_interest"]})
            continue
        if not belongs_to_client(record) or completion.get("type") != "disbursement":
            continue
        schedule = completion.get("schedule") or []
        if not schedule:
            continue
        identifier = PREFIX + completion["operation_id"]
        if identifier in closed:
            continue
        loans.append({
            "loan_id": identifier,
            "application_id": record["application"]["application_id"],
            "outstanding_principal": completion["amount"],
            "monthly_payment": str(max(Decimal(row["total_payment"]) for row in schedule)),
            "maturity_date": schedule[-1]["date"],
            "schedule": deepcopy(schedule),
        })
    return sorted(loans, key=lambda loan: loan["loan_id"])


def with_loans(financials, loans, *, closed=(), cash_total=None):
    result = deepcopy(financials)
    previous = [loan for loan in result.get("existing_loans") or [] if loan["loan_id"].startswith(PREFIX)]
    if result.get("cash_balance") is not None:
        previous_cash = Decimal(result.get("portfolio_cash_total", str(sum((Decimal(loan["outstanding_principal"]) for loan in previous), Decimal("0.00")))))
        current_cash = cash_total if cash_total is not None else sum((Decimal(loan["outstanding_principal"]) for loan in loans), Decimal("0.00"))
        result["cash_balance"] = f'{Decimal(result["cash_balance"]) - previous_cash + current_cash:.2f}'
        result["portfolio_cash_total"] = f"{current_cash:.2f}"
    result["existing_loans"] = [loan for loan in result.get("existing_loans") or []
                                if not loan["loan_id"].startswith((PREFIX, LINE_PREFIX)) and loan["loan_id"] not in closed] + deepcopy(loans)
    return result


def include_scheduled_payments(plan, loans, *, closed=()):
    """Банковский график включается в план один раз; ручные платежи остаются."""
    if not isinstance(plan, dict) or not isinstance(plan.get("start_date"), str) or not isinstance(plan.get("end_date"), str):
        return plan
    result = deepcopy(plan)
    transactions = result.get("transactions", [])
    links = result.get("existing_debt_payments") or []
    if not isinstance(transactions, list) or not all(isinstance(row, dict) and isinstance(row.get("transaction_id"), str) for row in transactions):
        return plan
    if not isinstance(links, list) or not all(isinstance(link, dict) and isinstance(link.get("loan_id"), str) and isinstance(link.get("transaction_id"), str) for link in links):
        return plan
    managed_ids = {loan["loan_id"] for loan in loans if loan.get("schedule")}
    removed = {link["transaction_id"] for link in links if link["loan_id"] in managed_ids or link["loan_id"] in closed or link["loan_id"].startswith((PREFIX, LINE_PREFIX))}
    result["transactions"] = [row for row in result.get("transactions", [])
                               if row["transaction_id"] not in removed and not row["transaction_id"].startswith("bank-payment:")]
    result["existing_debt_payments"] = [link for link in links if link["loan_id"] not in managed_ids and link["loan_id"] not in closed and not link["loan_id"].startswith((PREFIX, LINE_PREFIX)) and not link["transaction_id"].startswith("bank-payment:")]
    for loan in loans:
        if loan["loan_id"] not in managed_ids:
            continue
        for row in loan.get("schedule", []):
            if result["start_date"] <= row["date"] <= result["end_date"]:
                identifier = f"bank-payment:{loan['loan_id']}:{row['date']}"
                result["transactions"].append({"transaction_id": identifier, "date": row["date"],
                    "direction": "outflow", "amount": row["total_payment"]})
                result["existing_debt_payments"].append({"loan_id": loan["loan_id"], "transaction_id": identifier})
    return result


def calendar_operation(row):
    if not isinstance(row, dict) or not isinstance(row.get("transaction_id"), str) or row.get("direction") not in ("inflow", "outflow"):
        return False
    if not isinstance(row.get("amount"), str) or not re.fullmatch(r"[0-9]{1,12}\.[0-9]{2}", row["amount"]):
        return False
    try:
        return date.fromisoformat(row["date"]).isoformat() == row["date"] and Decimal(row["amount"]) > 0
    except (KeyError, ValueError, TypeError):
        return False


def calendar_data(records, now):
    events, plans, accounts = [], [], []
    closed = refinanced_loans(records)
    for record in records:
        if not belongs_to_client(record):
            continue
        identifier = record["application"]["application_id"]
        completion = record.get("completion") or {}
        plan = (record["application"].get("product_details") or {}).get("overdraft")
        if isinstance(plan, dict) and isinstance(plan.get("transactions"), list) and plan["transactions"]:
            links = plan.get("existing_debt_payments") or []
            linked = {link.get("transaction_id") for link in links if isinstance(link, dict) and isinstance(link.get("transaction_id"), str)} if isinstance(links, list) else set()
            plans.append({"application_id": identifier, "state": record["state"]["status"],
                "amount": record["application"]["need"].get("requested_amount"),
                "events": [{"event_id": f"plan:{identifier}:{row['transaction_id']}", "application_id": identifier,
                    "date": row["date"], "amount": row["amount"], "direction": row["direction"],
                    "kind": "planned_inflow" if row["direction"] == "inflow" else "planned_expense",
                    "title": "Ожидаемое поступление" if row["direction"] == "inflow" else "Предстоящий расход",
                    "forecast": True}
                    for row in plan["transactions"] if calendar_operation(row) and row["transaction_id"] not in linked]})
        if not completion:
            continue
        if completion.get("credit_line"):
            from credit_engine.revolving import line_state, line_schedule, local_date
            line = completion["credit_line"]
            state = line_state(line, local_date(now))
            accounts.append({"application_id": identifier, "product_id": completion["product_id"], "amount": line["limit"],
                "opened_at": completion["completed_at"], "status": state["status"], "refinanced_by": None,
                "outstanding_principal": state["principal"], "available_limit": state["available_limit"]})
            events.append({"event_id": completion["operation_id"], "application_id": identifier,
                "date": line["opened_at"][:10], "amount": line["limit"], "direction": "none", "kind": "line_opened", "title": "Открыта возобновляемая линия", "forecast": False})
            for operation in line["operations"]:
                events.append({"event_id": operation["operation_id"], "application_id": identifier,
                    "date": operation["date"], "amount": operation["amount"], "direction": "inflow" if operation["kind"] == "draw" else "outflow" if operation["kind"] == "repay" else "none",
                    "kind": "line_" + operation["kind"], "title": {"draw": "Получены деньги по линии", "repay": "Платёж по линии", "close": "Кредитная линия закрыта"}[operation["kind"]], "forecast": False})
            for index, row in enumerate(line_schedule(line, local_date(now))):
                final = Decimal(row["principal"]) > 0
                events.append({"event_id": f"{completion['operation_id']}:line-payment:{index}", "application_id": identifier,
                    "date": row["date"], "amount": row["total_payment"], "direction": "outflow", "kind": "line_final_payment" if final else "line_interest",
                    "title": "Возврат долга и процентов по линии" if final else "Проценты по кредитной линии", "forecast": True})
            continue
        overdraft = completion["type"] == "limit_opening"
        refinanced = closed.get(PREFIX + completion["operation_id"])
        refinancing = completion["product_id"] == "refinancing"
        accounts.append({"application_id": identifier, "product_id": completion["product_id"],
            "amount": completion["amount"], "opened_at": completion["completed_at"],
            "status": "refinanced" if refinanced else "active",
            "refinanced_by": refinanced["application_id"] if refinanced else None,
            "outstanding_principal": "0.00" if overdraft or refinanced else completion["amount"]})
        events.append({"event_id": completion["operation_id"], "application_id": identifier,
            "date": completion["completed_at"][:10], "amount": completion["amount"],
            "direction": "none" if overdraft or refinancing else "inflow",
            "kind": "refinancing_completed" if refinancing else "limit_opened" if overdraft else "loan_received",
            "title": "Выполнено рефинансирование" if refinancing else "Открыт лимит овердрафта" if overdraft else "Кредит получен", "forecast": False})
        for loan in completion.get("repaid_loans", []):
            events.append({"event_id": f"{completion['operation_id']}:repaid:{loan['loan_id']}", "application_id": identifier,
                "loan_id": loan["loan_id"], "date": completion["completed_at"][:10], "amount": loan["outstanding_principal"],
                "direction": "none", "kind": "loan_refinanced", "title": "Прежний кредит погашен рефинансированием", "forecast": False})
        for index, row in enumerate(completion.get("schedule") or []):
            if refinanced and row["date"] >= refinanced["closed_at"][:10]:
                continue
            events.append({"event_id": f"{completion['operation_id']}:payment:{index}", "application_id": identifier,
                "date": row["date"], "amount": row["total_payment"], "direction": "outflow",
                "kind": "loan_final_payment" if index == len(completion["schedule"]) - 1 else "loan_payment",
                "title": "Последний платёж по кредиту" if index == len(completion["schedule"]) - 1 else "Платёж по кредиту",
                "forecast": True})
        if overdraft:
            calculation = (record.get("result") or {}).get("overdraft_calculation") or {}
            calculation = calculation.get("calculation", calculation)
            for row in calculation.get("daily", []):
                for field, title, kind, direction in (("drawn", "Использование овердрафта", "overdraft_draw", "inflow"),
                    ("principal_repaid", "Погашение овердрафта", "overdraft_repayment", "outflow"),
                    ("interest_paid", "Проценты по овердрафту", "overdraft_interest", "outflow")):
                    if Decimal(row.get(field) or "0") > 0:
                        events.append({"event_id": f"{completion['operation_id']}:{kind}:{row['date']}", "application_id": identifier,
                            "date": row["date"], "amount": row[field], "direction": direction, "kind": kind,
                            "title": title, "forecast": True})
    return {"today": now.astimezone(timezone(timedelta(hours=3))).date().isoformat(),
            "events": sorted(events, key=lambda item: (item["date"], item["event_id"])), "plans": plans, "accounts": accounts}
