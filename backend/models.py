"""Тела запросов кабинета; внутренние результаты и проверки клиент не задаёт."""

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator, model_validator


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def finite_json(self):
        json.dumps(self.model_dump(), allow_nan=False)
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
