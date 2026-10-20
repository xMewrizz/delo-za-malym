"""Проверка выбранного предложения перед переходом к подписанию."""

from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Literal

from .checks import parse_timestamp
from .financials import CalculationIssue


@dataclass(frozen=True)
class OfferReadinessResult:
    status: Literal[
        "ready_to_sign", "conditions_pending", "offer_expired",
        "reassessment_required", "not_available", "invalid_data",
    ]
    next_action: dict[str, str]
    offer_id: str | None = None
    pending_conditions: tuple[dict[str, Any], ...] = ()
    issues: tuple[CalculationIssue, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["pending_conditions"] = list(result["pending_conditions"])
        result["issues"] = list(result["issues"])
        return result


def check_offer_readiness(
    application: Mapping[str, Any], assessment: Mapping[str, Any] | None,
    application_state: Mapping[str, Any], *, checked_at: datetime | str,
    fulfilled_condition_codes: Sequence[str] = (),
) -> OfferReadinessResult:
    """Проверить сохранённые backend данные без изменения заявки или предложения."""
    selected_id = None

    def result(status, field=None, code=None, message=None, *, action="none", label="", pending=()):
        return OfferReadinessResult(
            status=status, next_action={"type": action, "label": label}, offer_id=selected_id,
            pending_conditions=tuple(deepcopy(pending)),
            issues=(CalculationIssue(field, code, message),) if field else (),
        )

    def invalid(field, code, message):
        return result("invalid_data", field, code, message)

    def reassess(field, code, message):
        return result("reassessment_required", field, code, message,
                      action="request_reassessment", label="Обновить рассмотрение заявки")

    now = parse_timestamp(checked_at)
    if now is None:
        return invalid("checked_at", "invalid_timestamp", "Нужно время проверки с часовым поясом.")
    for name, value in (("application", application), ("application_state", application_state)):
        if not isinstance(value, Mapping):
            return invalid(name, "invalid_object", "Ожидается объект.")
        if not isinstance(value.get("application_id"), str) or not value["application_id"].strip():
            return invalid(f"{name}.application_id", "invalid_id", "Нужен идентификатор заявки.")
        if type(value.get("application_version")) is not int or value["application_version"] < 1:
            return invalid(f"{name}.application_version", "invalid_version", "Нужна положительная целочисленная версия.")
    if application.get("schema_version") != "0.1":
        return invalid("application.schema_version", "unsupported_schema", "Нужен формат заявки 0.1.")
    selected_id = application_state.get("selected_offer_id")
    if selected_id is not None and (not isinstance(selected_id, str) or not selected_id.strip()):
        selected_id = None
        return invalid("application_state.selected_offer_id", "invalid_id", "Нужен идентификатор предложения или null.")
    for field in ("application_id", "application_version"):
        if application_state[field] != application[field]:
            return reassess(f"application_state.{field}", "state_binding_mismatch", "Состояние относится к другой заявке или версии.")
    status = application_state.get("status")
    if status == "offer_expired":
        return result("offer_expired", "application_state.status", "offer_expired", "Предложение уже признано неактуальным.",
                      action="request_reassessment", label="Получить актуальные предложения")
    if status not in ("offers_ready", "conditions_pending", "ready_to_sign"):
        return result("not_available", "application_state.status", "signing_not_allowed",
                      "На текущем этапе переход к подписанию недоступен.")
    if assessment is None:
        return result("not_available", "assessment", "missing_assessment", "Нет результата рассмотрения.",
                      action="wait", label="Дождаться результата рассмотрения")
    if not isinstance(assessment, Mapping):
        return invalid("assessment", "invalid_object", "Ожидается результат рассмотрения.")
    if assessment.get("schema_version") != "0.1":
        return invalid("assessment.schema_version", "unsupported_schema", "Нужен формат оценки 0.1.")
    assessment_id = assessment.get("assessment_id")
    if not isinstance(assessment_id, str) or not assessment_id.strip():
        return invalid("assessment.assessment_id", "invalid_id", "Нужен идентификатор оценки.")
    if assessment_id != application_state.get("latest_assessment_id"):
        return reassess("application_state.latest_assessment_id", "assessment_not_current", "Нужна последняя оценка заявки.")
    for field in ("application_id", "application_version"):
        if (assessment.get(field) != application[field]
                or type(assessment.get(field)) is not type(application[field])):
            return reassess(f"assessment.{field}", "assessment_binding_mismatch", "Оценка относится к другой заявке или версии.")
    if assessment.get("stage") != "final":
        return result("not_available", "assessment.stage", "final_assessment_required",
                      "Предварительный расчёт нельзя подписать.",
                      action="confirm_submission", label="Отправить заявку на рассмотрение")
    calculated_at = parse_timestamp(assessment.get("calculated_at"))
    if calculated_at is None or calculated_at > now:
        return invalid("assessment.calculated_at", "invalid_timestamp", "Нужно время оценки с часовым поясом, не позднее проверки.")
    confirmation = application.get("confirmation")
    confirmed_at = parse_timestamp(confirmation.get("confirmed_at")) if isinstance(confirmation, Mapping) else None
    if (not isinstance(confirmation, Mapping)
            or type(confirmation.get("application_version")) is not int
            or confirmation["application_version"] != application["application_version"]
            or confirmed_at is None or confirmed_at > calculated_at):
        return reassess("application.confirmation", "confirmation_required", "Нужно подтверждение версии, по которой выполнено рассмотрение.")
    outcome = assessment.get("outcome")
    if outcome not in ("approved", "alternative_offers", "conditional_approval"):
        return result("not_available", "assessment.outcome", "no_eligible_decision", "В результате рассмотрения нет предложения для подписания.",
                      action="provide_information" if outcome == "needs_information" else "none",
                      label="Дополнить сведения" if outcome == "needs_information" else "")
    if selected_id is None:
        return result("not_available", "application_state.selected_offer_id", "offer_not_selected", "Сначала выберите предложение.",
                      action="select_offer", label="Выбрать предложение")
    offers = assessment.get("offers")
    if not isinstance(offers, list) or not offers:
        return invalid("assessment.offers", "invalid_offers", "Ожидается непустой список предложений.")
    ids = [offer.get("offer_id") if isinstance(offer, Mapping) else None for offer in offers]
    if any(not isinstance(value, str) or not value.strip() for value in ids) or len(set(ids)) != len(ids):
        return invalid("assessment.offers", "invalid_offer_ids", "Предложения должны иметь уникальные непустые идентификаторы.")
    if selected_id not in ids:
        return result("not_available", "application_state.selected_offer_id", "offer_not_found", "Выбранного предложения нет в последней оценке.",
                      action="select_offer", label="Выбрать актуальное предложение")
    offer = offers[ids.index(selected_id)]
    for field in ("application_id", "application_version"):
        if offer.get(field) != application[field] or type(offer.get(field)) is not type(application[field]):
            return reassess(f"offer.{field}", "offer_binding_mismatch", "Предложение относится к другой заявке или версии.")
    valid_until = parse_timestamp(offer.get("valid_until"))
    if valid_until is None or valid_until <= calculated_at:
        return invalid("offer.valid_until", "invalid_validity_period", "Предложение должно иметь срок актуальности после времени оценки.")
    if now >= valid_until:
        return result("offer_expired", "offer.valid_until", "offer_expired", "Срок актуальности предложения истёк.",
                      action="request_reassessment", label="Получить актуальные предложения")
    conditions = offer.get("conditions")
    if not isinstance(conditions, list):
        return invalid("offer.conditions", "invalid_conditions", "Ожидается список условий.")
    codes = []
    for condition in conditions:
        if (not isinstance(condition, Mapping) or not isinstance(condition.get("code"), str)
                or not condition["code"].strip() or type(condition.get("fulfilled")) is not bool
                or not isinstance(condition.get("message"), str) or not condition["message"].strip()):
            return invalid("offer.conditions", "invalid_condition", "Условие содержит код, описание и логический признак выполнения.")
        codes.append(condition["code"])
    if len(set(codes)) != len(codes):
        return invalid("offer.conditions", "duplicate_condition", "Коды условий должны быть уникальны.")
    if (not isinstance(fulfilled_condition_codes, (list, tuple))
            or any(not isinstance(code, str) or code not in codes for code in fulfilled_condition_codes)
            or len(set(fulfilled_condition_codes)) != len(fulfilled_condition_codes)):
        return invalid("fulfilled_condition_codes", "invalid_fulfilled_conditions", "Передайте уникальные коды выполненных условий выбранного предложения.")
    pending = [dict(condition) for condition in conditions
               if not condition["fulfilled"] and condition["code"] not in fulfilled_condition_codes]
    if pending:
        return result("conditions_pending", action="fulfill_conditions", label="Выполнить условия предложения", pending=pending)
    return result("ready_to_sign", action="sign", label="Перейти к подписанию")
