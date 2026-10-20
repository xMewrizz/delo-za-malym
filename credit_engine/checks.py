"""Общие проверки ответов внешних систем для кредитных продуктов."""

from collections.abc import Mapping
from datetime import datetime, timedelta
from typing import Any

from .financials import CalculationIssue
from .scoring import CREDIT_HISTORY_POINTS


def parse_timestamp(value: Any) -> datetime | None:
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(value)
        return parsed if parsed.utcoffset() is not None else None
    except (TypeError, ValueError):
        return None


def validate_external_checks(
    checks: Any, application: Mapping, now: datetime, *, max_age_hours: int = 24,
) -> tuple[str | None, tuple[CalculationIssue, ...]]:
    if checks is None:
        return "needs_checks", (CalculationIssue("checks", "missing_checks", "Нужны результаты внешних проверок."),)
    if not isinstance(checks, Mapping):
        return "invalid_data", (CalculationIssue("checks", "invalid_checks", "Проверки должны быть объектом."),)
    if checks.get("schema_version") != "0.1":
        return "invalid_data", (CalculationIssue("checks.schema_version", "unsupported_schema", "Нужен формат проверок 0.1."),)
    for field, expected in (("application_id", application["application_id"]),
                            ("application_version", application["application_version"]),
                            ("business_inn", application["business"]["inn"])):
        if checks.get(field) != expected or type(checks.get(field)) is not type(expected):
            return "needs_checks", (CalculationIssue(f"checks.{field}", "checks_binding_mismatch",
                                                       "Проверки должны относиться к этому бизнесу и версии заявки."),)
    checked_at = parse_timestamp(checks.get("checked_at"))
    if checked_at is None:
        return "invalid_data", (CalculationIssue("checks.checked_at", "invalid_timestamp", "Нужно время проверки с часовым поясом."),)
    if checked_at > now:
        return "invalid_data", (CalculationIssue("checks.checked_at", "future_checks", "Время проверки находится в будущем."),)
    if now - checked_at > timedelta(hours=max_age_hours):
        return "needs_checks", (CalculationIssue("checks.checked_at", "stale_checks", "Нужно обновить внешние проверки."),)
    issues = []
    status = None
    for section, key in (("registration", "active"), ("restrictions", "financing_prohibited"),
                         ("credit_history", "category"), ("obligations", "matches_application")):
        result = checks.get(section)
        field = f"checks.{section}"
        if result is None:
            issues.append(CalculationIssue(field, "missing_check", "Нет результата проверки."))
            status = status or "needs_checks"
        elif not isinstance(result, Mapping) or result.get("status") not in ("completed", "pending", "error"):
            return "invalid_data", (CalculationIssue(field, "invalid_check", "Некорректный результат проверки."),)
        elif result["status"] == "error":
            issues.append(CalculationIssue(field, "check_service_error", "Проверка завершилась технической ошибкой."))
            status = "check_retry_pending"
        elif result["status"] == "pending" or result.get(key) is None:
            issues.append(CalculationIssue(field, "incomplete_check", "Проверка ещё не завершена."))
            status = status or "needs_checks"
        elif section == "credit_history":
            category = result[key]
            if not isinstance(category, str) or category not in CREDIT_HISTORY_POINTS:
                return "invalid_data", (CalculationIssue(f"{field}.{key}", "invalid_credit_history", "Неизвестная категория истории."),)
        elif type(result[key]) is not bool:
            return "invalid_data", (CalculationIssue(f"{field}.{key}", "invalid_check_value", "Ожидается логическое значение."),)
    registration = checks.get("registration")
    if isinstance(registration, Mapping) and registration.get("status") == "completed" and registration.get("active") is True:
        for field in ("registered_at", "legal_form"):
            if registration.get(field) is None:
                issues.append(CalculationIssue(f"checks.registration.{field}", "incomplete_check", "Нужны регистрационные сведения из проверки."))
                status = status or "needs_checks"
            elif not isinstance(registration[field], str):
                return "invalid_data", (CalculationIssue(f"checks.registration.{field}", "invalid_check_value", "Нужна строка из регистрационных сведений."),)
    return status, tuple(issues)
