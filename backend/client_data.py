"""Банковские сведения клиента и дополнения к отсутствующим данным."""

from copy import deepcopy


def bank_financials(record):
    # Старые заявки сохраняют доступные на момент обновления сведения.
    return record.get("simulator", {}).get("bank_financials",
        record.get("client_data", {}).get("bank_financials", record["application"].get("financials", {})))


def preserves_bank_values(known, proposed):
    if known is None:
        return True
    if isinstance(known, dict):
        return isinstance(proposed, dict) and all(
            key in proposed and preserves_bank_values(value, proposed[key]) for key, value in known.items()
        )
    if isinstance(known, list):
        return isinstance(proposed, list) and len(known) == len(proposed) and all(
            preserves_bank_values(left, right) for left, right in zip(known, proposed)
        )
    return type(known) is type(proposed) and known == proposed


def client_data(record):
    if "simulator" not in record:
        return deepcopy(record.get("client_data", {}))
    simulator = record["simulator"]
    checks = record.get("checks") or simulator["checks"]
    history = deepcopy(checks["credit_history"])
    if simulator.get("recovered") and history["status"] in ("error", "pending"):
        history.update(status="completed", category=history.get("category") or "good")
    if history["status"] != "completed":
        history["category"] = None
    return {
        "company_name": "ООО «Север»",
        "source": "bank_profile",
        "loaded_at": simulator.get("profile_loaded_at") or next(
            (item["created_at"] for item in record["events"] if item["type"] == "application_created"), None),
        "bank_financials": deepcopy(bank_financials(record)),
        "credit_history": {"source": "credit_bureau", **history},
    }
