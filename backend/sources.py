"""Источники подтверждённых полей, включая исправления клиента."""

from copy import deepcopy
from urllib.parse import quote, unquote


def operation_path(identifier, field):
    return "plan/" + quote(identifier, safe="") + "/" + field


def source_value(application, path):
    if path.startswith("need."):
        return application.get("need", {}).get(path[5:])
    if path.startswith("plan/"):
        _, identifier, field = path.split("/")
        plan = (application.get("product_details") or {}).get("overdraft") or {}
        return next((row.get(field) for row in plan.get("transactions", [])
                     if row["transaction_id"] == unquote(identifier)), None)
    return None


def attach_sources(record, sources):
    for path, source in sources.items():
        value = source_value(record["application"], path)
        if value is not None:
            updated = deepcopy(source)
            updated.update(value=value, user_corrected=source.get("user_corrected", False) or value != source["value"])
            record.setdefault("field_sources", {})[path] = updated
