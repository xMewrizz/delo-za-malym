"""Settlement-account postings, with the same cash basis as portfolio balances."""
from decimal import Decimal

from .portfolio import belongs_to_client, calendar_date


def settlement_history(records, payments):
    rows = []
    receipts = {item["payment_id"]: item for item in payments}
    linked_payments = set()

    def add(identifier, application_id, day, delta, title, receipt=None):
        amount = Decimal(delta)
        if not amount:
            return
        rows.append({"event_id": "account:" + identifier, "application_id": application_id,
                     "date": calendar_date(day), "amount": f"{abs(amount):.2f}",
                     "direction": "inflow" if amount > 0 else "outflow", "kind": "account_movement",
                     "title": title, "forecast": False,
                     **({"supplier_payment": receipt} if receipt else {})})

    for record in records:
        if not belongs_to_client(record):
            continue
        identifier = record["application"]["application_id"]
        completion = record.get("completion") or {}
        if completion.get("type") == "disbursement" and completion.get("product_id") != "refinancing":
            add(completion["operation_id"], identifier, completion["completed_at"], completion["amount"], "Зачисление кредита")
        for operation in (completion.get("servicing") or {}).get("operations", []):
            add(operation["operation_id"], identifier, operation["date"], -Decimal(operation["amount"]), "Платёж по кредиту")
        for operation in (completion.get("credit_line") or {}).get("operations", []):
            delta = Decimal(operation["drawn"]) - Decimal(operation["principal_paid"]) - Decimal(operation["interest_paid"])
            add(operation["operation_id"], identifier, operation["date"], delta,
                "Получение денег по линии" if delta > 0 else "Платёж по кредитной линии")
        for operation in (completion.get("overdraft_account") or {}).get("operations", []):
            delta = Decimal(operation["cash_delta"])
            receipt = receipts.get(operation.get("supplier_payment_id"))
            if receipt:
                linked_payments.add(receipt["payment_id"])
            if operation["kind"] == "expense":
                drawn = Decimal(operation.get("drawn", "0"))
                # Show the actual full payment and its funding separately, while
                # their net effect exactly matches the account's cash_delta.
                add(operation["operation_id"] + ":funding", identifier, operation["date"], drawn, "Использование овердрафта")
                add(operation["operation_id"], identifier, operation["date"], delta - drawn,
                    "Оплата · " + receipt["request"]["recipient_name"] if receipt else "Списание со счёта", receipt)
            else:
                add(operation["operation_id"], identifier, operation["date"], delta,
                    "Поступление на счёт" if operation["kind"] == "receipt" else "Автопогашение овердрафта")
    for payment in payments:
        if payment["payment_id"] not in linked_payments:
            add(payment["payment_id"], "", payment["date"], payment["cash_delta"],
                "Оплата · " + payment["request"]["recipient_name"], payment)
    return sorted(rows, key=lambda item: (item["date"], item["event_id"]))
