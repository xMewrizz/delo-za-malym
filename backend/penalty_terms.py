"""Versioned penalty conditions: shown in new offers and frozen at signing."""
from copy import deepcopy
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

DEMO_DAILY_RATE = "0.05"
DEMO_POLICY_VERSION = "demo-penalties-2026-10-v1"

class PenaltyTerms(BaseModel):
    model_config = ConfigDict(extra="forbid")
    terms_id: str = Field(min_length=1, max_length=200)
    version: Literal["simple-daily-v1"]
    daily_rate_percent: str = Field(pattern=r"^\d{1,3}(?:\.\d{1,6})?$")
    source: Literal["demo_contract", "bank_contract", "demo_policy"]
    basis: Literal["overdue_installment"]
    start_rule: Literal["day_after_due"]
    day_count: Literal["calendar"]
    capitalization: Literal[False]

    @field_validator("daily_rate_percent")
    @classmethod
    def bounded_rate(cls, value):
        if not 0 <= Decimal(value) <= 100:
            raise ValueError("Invalid daily penalty rate")
        return value


def read_penalty_terms(value):
    try:
        return PenaltyTerms.model_validate(value).model_dump()
    except ValidationError:
        # Missing or unsupported contract rules must never become a guessed rate.
        return None


def attach_demo_penalties(offers):
    for offer in offers:
        identifier = offer.get("offer_id") or offer.get("option_id")
        if identifier:
            offer["penalty_terms"] = {"terms_id": f"{DEMO_POLICY_VERSION}:{identifier}", "version": "simple-daily-v1",
                "daily_rate_percent": DEMO_DAILY_RATE, "source": "demo_contract", "basis": "overdue_installment",
                "start_rule": "day_after_due", "day_count": "calendar", "capitalization": False}


def signed_penalty_terms(offer):
    return deepcopy(read_penalty_terms(offer.get("penalty_terms")))


def simulated_legacy_terms(identifier):
    # A disclosed scenario policy for old demo data, never a retroactive contract amendment.
    return {"terms_id": f"{DEMO_POLICY_VERSION}:legacy:{identifier}", "version": "simple-daily-v1",
        "daily_rate_percent": DEMO_DAILY_RATE, "source": "demo_policy", "basis": "overdue_installment",
        "start_rule": "day_after_due", "day_count": "calendar", "capitalization": False}
