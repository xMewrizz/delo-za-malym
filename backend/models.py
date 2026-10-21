"""Тела запросов кабинета; внутренние результаты и проверки клиент не задаёт."""

import json
from uuid import UUID
from typing import Any

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
    state: dict[str, Any]
    checks: dict[str, Any] | None
    result: dict[str, Any] | None
    readiness: dict[str, Any] | None
    recommendation: dict[str, Any] | None = None
    signature: dict[str, Any] | None
    completion: dict[str, Any] | None
    events: list[dict[str, Any]]
    submitted_versions: list[dict[str, Any]]


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
