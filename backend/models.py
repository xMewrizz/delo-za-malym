"""Тела запросов кабинета; внутренние результаты и проверки клиент не задаёт."""

import json
from datetime import date
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
    documents: list[dict[str, Any]] = Field(default_factory=list)
    field_sources: dict[str, Any] = Field(default_factory=dict)


class UseInvoice(ConfirmedAction):
    document_revision: StrictInt = Field(ge=1)
    target: Literal["loan_amount", "planned_expense", "project_cost", "evidence"]
    amount: str
    due_date: str | None = None
    transaction_id: str | None = Field(default=None, min_length=1, max_length=100)
    replace_existing: StrictBool = False
    base_chat_version: StrictInt | None = Field(default=None, ge=1)

    @field_validator("amount")
    @classmethod
    def invoice_money(cls, value):
        if not re.fullmatch(r"[0-9]{1,12}\.[0-9]{2}", value) or float(value) <= 0:
            raise ValueError("Нужна положительная сумма с двумя знаками после точки.")
        return value

    @field_validator("due_date")
    @classmethod
    def invoice_date(cls, value):
        if value is not None and date.fromisoformat(value).isoformat() != value:
            raise ValueError("Нужна дата YYYY-MM-DD.")
        return value


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


class AnswerClarification(ChatVersion, VersionAction):
    request_id: UUID
    choice_id: str | None = Field(default=None, min_length=1, max_length=100)
    value: str | None = Field(default=None, min_length=1, max_length=100)

    @model_validator(mode="after")
    def one_answer(self):
        if (self.choice_id is None) == (self.value is None):
            raise ValueError("Выберите готовый ответ или введите значение.")
        return self


class ConfirmChatProposal(ChatVersion):
    confirmed: StrictBool

    @field_validator("confirmed")
    @classmethod
    def explicit_confirmation(cls, value):
        if not value:
            raise ValueError("Требуется подтверждение изменений.")
        return value


class PlannedOperation(RequestModel):
    transaction_id: str = Field(min_length=1, max_length=100)
    direction: Literal["inflow", "outflow"] | None = None
    date: str | None = None
    amount: str | None = None
    loan_id: str | None = Field(default=None, max_length=100)

    @field_validator("date")
    @classmethod
    def calendar_date(cls, value):
        if value is not None and date.fromisoformat(value).isoformat() != value:
            raise ValueError("Нужна дата YYYY-MM-DD.")
        return value

    @field_validator("amount")
    @classmethod
    def positive_money(cls, value):
        if value is not None and (not re.fullmatch(r"[0-9]{1,12}\.[0-9]{2}", value) or float(value) <= 0):
            raise ValueError("Нужна положительная сумма рублей с двумя знаками.")
        return value


class OverdraftPlanUpdate(RequestModel):
    mode: Literal["merge", "replace"] = "merge"
    transactions: list[PlannedOperation] = Field(default_factory=list, max_length=100)
    removed_transaction_ids: list[str] = Field(default_factory=list, max_length=100)
    debt_payments_confirmed: StrictBool | None = None
    cash_reserve: str | None = None

    @field_validator("cash_reserve")
    @classmethod
    def reserve_money(cls, value):
        if value is not None and not re.fullmatch(r"[0-9]{1,12}\.[0-9]{2}", value):
            raise ValueError("Нужна неотрицательная сумма рублей с двумя знаками.")
        return value

    @model_validator(mode="after")
    def unique_operations(self):
        ids = [item.transaction_id for item in self.transactions]
        if len(ids) != len(set(ids)) or set(ids) & set(self.removed_transaction_ids):
            raise ValueError("Операция не может повторяться или одновременно изменяться и удаляться.")
        if not self.transactions and not self.removed_transaction_ids and self.debt_payments_confirmed is None and self.cash_reserve is None:
            raise ValueError("Нет изменений плана.")
        return self


class EditChatProposal(ChatVersion, VersionAction):
    changes: dict[str, Any]
    overdraft_plan: OverdraftPlanUpdate | None = None
    remove_overdraft_plan: StrictBool = False

    @model_validator(mode="after")
    def plan_action(self):
        if self.overdraft_plan is not None and self.remove_overdraft_plan:
            raise ValueError("Выберите изменение либо удаление плана.")
        return self


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
    product_id: Literal["working_capital_loan", "overdraft", "refinancing", "revolving_credit_line", "investment_loan"]
    preferences: LoanPreferences = Field(default_factory=LoanPreferences)
    delay: InflowDelay | None = None

    @model_validator(mode="after")
    def matching_product(self):
        if self.product_id == "investment_loan":
            if self.preferences.requested_amount is not None:
                raise ValueError("Сумма кредита рассчитывается из стоимости проекта и собственного взноса.")
            if "maximum_term" not in self.preferences.model_fields_set:
                self.preferences.maximum_term = 60
        if self.product_id != "overdraft" and self.delay is not None:
            raise ValueError("Перенос поступления доступен в плане овердрафта.")
        if self.product_id == "overdraft" and self.preferences.model_fields_set:
            raise ValueError("Настройки суммы и срока относятся к разовому кредиту.")
        if self.product_id == "refinancing" and self.preferences.requested_amount is not None:
            raise ValueError("Сумму рефинансирования определяем по выбранным долгам.")
        if self.product_id == "refinancing" and "maximum_term" not in self.preferences.model_fields_set:
            self.preferences.maximum_term = 48
        if self.product_id == "revolving_credit_line" and "maximum_term" not in self.preferences.model_fields_set:
            self.preferences.maximum_term = 12
        return self


class LineOperation(RequestModel):
    base_line_version: StrictInt = Field(ge=1)
    request_id: UUID
    kind: Literal["draw", "repay", "close"]
    amount: str | None = None
    confirmed: StrictBool

    @model_validator(mode="after")
    def valid_operation(self):
        if not self.confirmed:
            raise ValueError("Подтвердите операцию.")
        if self.kind == "close":
            if self.amount is not None:
                raise ValueError("Для закрытия не передавайте сумму.")
        elif self.amount is None or not re.fullmatch(r"[0-9]{1,12}\.[0-9]{2}", self.amount) or float(self.amount) <= 0:
            raise ValueError("Нужна положительная сумма с двумя знаками.")
        return self


class ApplyOption(ConfirmedAction):
    option_id: str = Field(min_length=1)


class LoanPaymentPreview(RequestModel):
    base_loan_version: StrictInt = Field(ge=1)
    amount: str = Field(pattern=r"^[0-9]{1,12}\.[0-9]{2}$")
    execution_date: date | None = None
    payment_kind: Literal["early", "regular"] = "early"
    strategy: Literal["reduce_payment", "reduce_term"] = "reduce_payment"
    full_repayment: StrictBool = False

    @field_validator("amount")
    @classmethod
    def positive_amount(cls, value):
        if float(value) <= 0:
            raise ValueError("Укажите положительную сумму.")
        return value


class LoanPaymentRequest(LoanPaymentPreview):
    request_id: UUID
    calculated_on: date
    confirmed: StrictBool

    @model_validator(mode="after")
    def payment_confirmed(self):
        if not self.confirmed:
            raise ValueError("Подтвердите платёж.")
        return self


class CancelLoanOrder(RequestModel):
    base_loan_version: StrictInt = Field(ge=1)


class OverdraftPreview(RequestModel):
    base_account_version: str = Field(pattern=r"^[0-9a-f]{64}$")
    kind: Literal["expense", "receipt"]
    amount: str = Field(pattern=r"^[0-9]{1,12}\.[0-9]{2}$")
    purpose: Literal["supplier", "payroll", "tax", "operating", "revenue"]

    @model_validator(mode="after")
    def valid_operation(self):
        from decimal import Decimal
        if Decimal(self.amount) <= 0:
            raise ValueError("Укажите положительную сумму.")
        if (self.kind == "receipt") != (self.purpose == "revenue"):
            raise ValueError("Выберите назначение операции.")
        return self


class OverdraftOperation(OverdraftPreview):
    request_id: UUID
    calculated_on: date
    confirmed: StrictBool

    @model_validator(mode="after")
    def operation_confirmed(self):
        if not self.confirmed:
            raise ValueError("Подтвердите операцию.")
        return self


class SupplierPaymentPreview(RequestModel):
    base_account_version: str = Field(pattern=r"^[0-9a-f]{64}$")
    overdraft_application_id: str | None = Field(default=None, max_length=100)
    recipient_name: str = Field(min_length=2, max_length=160)
    recipient_inn: str = Field(pattern=r"^(?:[0-9]{10}|[0-9]{12})$")
    recipient_account: str = Field(pattern=r"^[0-9]{20}$")
    recipient_bik: str = Field(pattern=r"^[0-9]{9}$")
    amount: str = Field(pattern=r"^[0-9]{1,12}\.[0-9]{2}$")
    purpose: str = Field(min_length=5, max_length=210)
    invoice_number: str = Field(default="", max_length=80)

    @model_validator(mode="after")
    def valid_payment(self):
        from decimal import Decimal
        from .supplier_payments import validate_requisites
        if Decimal(self.amount) <= 0:
            raise ValueError("Укажите положительную сумму.")
        validate_requisites(self)
        return self


class SupplierPaymentOperation(SupplierPaymentPreview):
    request_id: UUID
    calculated_on: date
    confirmed: StrictBool

    @model_validator(mode="after")
    def payment_confirmed(self):
        if not self.confirmed:
            raise ValueError("Подтвердите платёж.")
        return self


class PenaltyProduct(RequestModel):
    product_id: str = Field(min_length=6, max_length=150)
    daily_rate_percent: str | None = Field(default=None, pattern=r"^(?:\d{1,3})(?:\.\d{1,6})?$")
    rate_source: Literal["manual", "contract"] = "manual"
    terms_id: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("daily_rate_percent")
    @classmethod
    def bounded_rate(cls, value):
        from decimal import Decimal
        if value is not None and not 0 <= Decimal(value) <= 100:
            raise ValueError("Ставка должна быть от 0 до 100% в день.")
        return value

    @model_validator(mode="after")
    def explicit_rate_source(self):
        if self.rate_source == "contract" and (self.daily_rate_percent is not None or self.terms_id is None):
            raise ValueError("Для договорной ставки передайте идентификатор условий без ручной ставки.")
        if self.rate_source == "manual" and (self.daily_rate_percent is None or self.terms_id is not None):
            raise ValueError("Для сценария укажите ставку вручную без идентификатора договора.")
        return self


class PenaltyPreviewRequest(RequestModel):
    from_date: date
    target_date: date
    products: list[PenaltyProduct] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def valid_period(self):
        if not 0 < (self.target_date - self.from_date).days <= 3660:
            raise ValueError("Выберите период от 1 дня до 10 лет.")
        if len({item.product_id for item in self.products}) != len(self.products):
            raise ValueError("Продукты не должны повторяться.")
        return self


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
