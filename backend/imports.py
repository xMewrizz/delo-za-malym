"""Проверка CSV с фактическими помесячными показателями и источник каждой строки."""

import csv
from copy import deepcopy
from hashlib import sha256
from io import StringIO
import re
from uuid import uuid4

from credit_engine.financials import FinancialPolicy, _required_months


HEADERS = ("month", "operating_inflow", "operating_outflow", "taxes")


def preview_csv(application, filename, content, now):
    if not filename.lower().endswith(".csv"):
        raise ValueError("Поддерживается CSV с помесячными показателями.")
    content = content.lstrip("\ufeff")
    if not content.strip():
        raise ValueError("Файл пустой.")
    delimiter = ";" if ";" in content.splitlines()[0] else ","
    reader = csv.DictReader(StringIO(content), delimiter=delimiter, strict=True)
    if reader.fieldnames != list(HEADERS):
        raise ValueError("Заголовок CSV: month,operating_inflow,operating_outflow,taxes. Допустим разделитель , или ;.")
    rows, issues, seen = [], [], set()
    for number, row in enumerate(reader, 2):
        if number > 121:
            raise ValueError("В файле допускается не более 120 месяцев.")
        if None in row or any(value is None for value in row.values()):
            issues.append({"row": number, "field": "row", "message": "Нужно четыре значения в строке."})
            continue
        clean = {field: value.strip() for field, value in row.items()}
        month = clean["month"]
        if not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", month) or month[:4] == "0000":
            issues.append({"row": number, "field": "month", "message": "Нужен месяц YYYY-MM."})
        elif month >= now.strftime("%Y-%m"):
            issues.append({"row": number, "field": "month", "message": "Импортируйте фактические данные за завершённые месяцы, отдельно от прогноза."})
        if month in seen:
            issues.append({"row": number, "field": "month", "message": "Месяц повторяется."})
        seen.add(month)
        for field in HEADERS[1:]:
            if not re.fullmatch(r"[0-9]{1,12}\.[0-9]{2}", clean[field]):
                issues.append({"row": number, "field": field, "message": "Нужна неотрицательная сумма с двумя знаками, например 100000.00."})
        rows.append({"line": number, "values": clean})
    missing = sorted(set(_required_months(now.date(), FinancialPolicy().history_months)) - seen)
    if missing:
        issues.append({"row": 1, "field": "month", "message": "Не хватает месяцев: " + ", ".join(missing)})
    old = {row["month"]: row for row in application.get("financials", {}).get("monthly") or [] if isinstance(row, dict) and "month" in row}
    for row in rows:
        row["previous"] = old.get(row["values"]["month"])
        row["changed"] = row["previous"] != row["values"]
    return {"import_id": str(uuid4()), "filename": filename.replace("\\", "/").split("/")[-1],
            "sha256": sha256(content.encode("utf-8")).hexdigest(), "created_at": now.isoformat(),
            "application_version": application["application_version"], "revision": 1,
            "source_rows": deepcopy(rows), "status": "invalid" if issues else "ready",
            "rows": rows, "issues": issues, "period": {"start": min(seen) if seen else None, "end": max(seen) if seen else None},
            "meaning": "Поступления — от деятельности бизнеса; расходы — без налогов и платежей по кредитам. Налоги указаны отдельно."}
