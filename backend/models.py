"""Тела запросов кабинета; внутренние результаты и проверки клиент не задаёт."""

import json
from uuid import UUID
from typing import Any
from typing import Literal
import re

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator, model_validator


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def finite_json(self):
        json.dumps(self.model_dump(mode="json"), allow_nan=False)
        return self


class CreateApplication(RequestModel):
    need: dict[str, Any] = Field(default_factory=dict)
    financials: dict[str, Any] | None = None
    product_details: dict[str, Any] | None = None


class VersionAction(RequestModel):
    base_application_version: StrictInt = Field(ge=1)


class UpdateApplication(VersionAction):
    changes: dict[str, Any]


class ConfirmedAction(VersionAction):
    confirmed: StrictBool

    @field_validator("confirmed")
    @classmethod
    def require_confirmation(cls, value):
        if not value:
            raise ValueError("Требуется явное подтверждение действия.")
        return value


class SelectOffer(VersionAction):
    assessment_id: str = Field(min_length=1)
    offer_id: str = Field(min_length=1)


class OfferAction(ConfirmedAction):
    offer_id: str = Field(min_length=1)


class ApplicationView(BaseModel):
    application: dict[str, Any]
    client_data: dict[str, Any] = Field(default_factory=dict)
    state: dict[str, Any]
    checks: dict[str, Any] | None
    result: dict[str, Any] | None
    readiness: dict[str, Any] | None
    recommendation: dict[str, Any] | None = None
    signature: dict[str, Any] | None
    completion: dict[str, Any] | None
    events: list[dict[str, Any]]
    submitted_versions: list[dict[str, Any]]
    explorations: list[dict[str, Any]] = Field(default_factory=list)
    imports: list[dict[str, Any]] = Field(default_factory=list)


class CreateChat(RequestModel):
    application_id: str | None = Field(default=None, min_length=1, max_length=100)


class ChatVersion(RequestModel):
    base_chat_version: StrictInt = Field(ge=1)


class ChatMessage(ChatVersion):
    request_id: UUID
    text: str = Field(min_length=1, max_length=8000)

    @field_validator("text")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Введите сообщение.")
        return value.strip()


class ConfirmChatProposal(ChatVersion):
    confirmed: StrictBool

    @field_validator("confirmed")
    @classmethod
    def explicit_confirmation(cls, value):
        if not value:
            raise ValueError("Требуется подтверждение изменений.")
        return value


class EditChatProposal(ChatVersion, VersionAction):
    changes: dict[str, Any]


class LoanPreferences(RequestModel):
    requested_amount: str | None = None
    maximum_monthly_payment: str | None = None
    minimum_term: StrictInt = Field(default=6, ge=1, le=120)
    maximum_term: StrictInt = Field(default=36, ge=1, le=120)
    preserve_amount: StrictBool = True
    priority: Literal["lowest_payment", "lowest_total_cost", "preserve_amount"] | None = None

    @field_validator("requested_amount", "maximum_monthly_payment")
    @classmethod
    def valid_money(cls, value):
        if value is not None and (not re.fullmatch(r"[0-9]{1,12}\.[0-9]{2}", value) or float(value) <= 0):
            raise ValueError("Нужна положительная сумма рублей с двумя знаками.")
        return value

    @model_validator(mode="after")
    def ordered_terms(self):
        if self.minimum_term > self.maximum_term:
            raise ValueError("Минимальный срок больше максимального.")
        return self


class InflowDelay(RequestModel):
    transaction_id: str = Field(min_length=1, max_length=100)
    days: StrictInt = Field(ge=1, le=30)


class ExploreOptions(VersionAction):
    product_id: Literal["working_capital_loan", "overdraft"]
    preferences: LoanPreferences = Field(default_factory=LoanPreferences)
    delay: InflowDelay | None = None

    @model_validator(mode="after")
    def matching_product(self):
        if self.product_id == "working_capital_loan" and self.delay is not None:
            raise ValueError("Перенос поступления доступен в плане овердрафта.")
        if self.product_id == "overdraft" and self.preferences.model_fields_set:
            raise ValueError("Настройки суммы и срока относятся к разовому кредиту.")
        return self


class ApplyOption(ConfirmedAction):
    option_id: str = Field(min_length=1)


class ImportCSV(VersionAction):
    filename: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=150000)


class ConfirmImport(ConfirmedAction):
    base_import_revision: StrictInt = Field(ge=1)


class EditImport(VersionAction):
    base_import_revision: StrictInt = Field(ge=1)
    monthly: list[dict[str, Any]] = Field(max_length=120)

    @field_validator("monthly")
    @classmethod
    def bounded_values(cls, rows):
        if any(len(row) != 4 or any(not isinstance(value, str) or len(value) > 32 for value in row.values()) for row in rows):
            raise ValueError("В строке нужны четыре коротких текстовых значения: месяц и суммы.")
        return rows
