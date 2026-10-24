"""Сценарий неуплаты: договорные условия сервера или явно заданные ставки."""

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from .service import ProcessError
from .penalty_terms import read_penalty_terms

PAYMENT_KINDS = {"loan_payment", "loan_final_payment", "existing_loan_payment", "line_interest", "line_final_payment", "overdraft_payment_due"}


def penalty_candidates(calendar, start, target):
    closed = {item["application_id"] for item in calendar["accounts"] if item.get("status") in {"closed", "refinanced"}}
    return [item for item in calendar["events"] if item["forecast"] and item["direction"] == "outflow"
            and item["kind"] in PAYMENT_KINDS and item["application_id"] not in closed
            and start <= item["date"] < target and Decimal(item["amount"]) > 0]


def preview_penalties(calendar, request):
    start, target = request.from_date.isoformat(), request.target_date.isoformat()
    candidates = penalty_candidates(calendar, start, target)
    groups = []
    for selection in request.products:
        rows = [item for item in candidates if ("app:" + item["application_id"] if item["application_id"] else "loan:" + item.get("loan_id", "")) == selection.product_id]
        if not rows:
            raise ProcessError("no_payments_in_period", "По выбранному продукту нет подходящих платежей. Обновите календарь или период.", 422)
        terms = None
        if selection.rate_source == "contract":
            matches = [value for value in calendar.get("penalty_terms", []) if value.get("product_id") == selection.product_id]
            if len(matches) == 1:
                terms = read_penalty_terms({key:value for key,value in matches[0].items() if key != "product_id"})
            if not terms:
                raise ProcessError("penalty_terms_missing", "Условия пеней по этому договору не переданы. Обновите данные или выберите ручной сценарий.", 422)
            if selection.terms_id != terms["terms_id"]:
                raise ProcessError("penalty_terms_changed", "Условия договора изменились. Обновите календарь перед расчётом.", 409)
        rate = terms["daily_rate_percent"] if terms else selection.daily_rate_percent
        payments = []
        for row in rows:
            days = (request.target_date - date.fromisoformat(row["date"])).days
            charge = (Decimal(row["amount"]) * Decimal(rate) / 100 * days).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            payments.append({"event_id": row["event_id"], "due_date": row["date"], "amount": row["amount"], "days": days, "penalty": f"{charge:.2f}"})
        base = sum((Decimal(item["amount"]) for item in payments), Decimal(0))
        penalty = sum((Decimal(item["penalty"]) for item in payments), Decimal(0))
        groups.append({"product_id": selection.product_id, "daily_rate_percent": rate, "rate_source": selection.rate_source,
                       "terms_id": terms["terms_id"] if terms else None, "contract_source": terms["source"] if terms else None,
                       "missed_payments": f"{base:.2f}", "penalty": f"{penalty:.2f}", "payments": payments})
    base = sum((Decimal(item["missed_payments"]) for item in groups), Decimal(0))
    penalty = sum((Decimal(item["penalty"]) for item in groups), Decimal(0))
    sources = {group["rate_source"] for group in groups}
    basis = "contract_simple_daily_rate" if sources == {"contract"} else "mixed_simple_daily_rate" if len(sources) > 1 else "user_defined_simple_daily_rate"
    return {"from_date": start, "target_date": target, "products": groups, "missed_payments": f"{base:.2f}",
            "total_penalty": f"{penalty:.2f}", "total_with_penalty": f"{base + penalty:.2f}",
            "basis": basis, "mode": "scenario"}
