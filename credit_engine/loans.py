"""Аннуитетный график разового кредита с ежемесячным начислением процентов."""

from dataclasses import asdict, dataclass
from decimal import Decimal, ROUND_HALF_UP, localcontext
import re
from typing import Any, Literal

from .financials import CalculationIssue


CENT = Decimal("0.01")
ZERO = Decimal("0.00")
DECIMAL_PATTERN = re.compile(r"[0-9]+\.[0-9]{2}")
MAX_TERM_MONTHS = 600


@dataclass(frozen=True)
class LoanPayment:
    month_number: int
    opening_balance: Decimal
    principal_payment: Decimal
    interest_payment: Decimal
    total_payment: Decimal
    closing_balance: Decimal


@dataclass(frozen=True)
class LoanCalculation:
    amount: Decimal
    term_months: int
    annual_rate_percent: Decimal
    monthly_payment: Decimal
    maximum_payment: Decimal
    total_interest: Decimal
    fees_total: Decimal
    total_repayment: Decimal
    schedule: tuple[LoanPayment, ...]


@dataclass(frozen=True)
class LoanCalculationResult:
    status: Literal["calculated", "needs_information", "invalid_data"]
    calculation: LoanCalculation | None = None
    issues: tuple[CalculationIssue, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        """JSON-совместимое представление с денежными суммами в строках."""
        def serialize(value: Any) -> Any:
            if isinstance(value, Decimal):
                return str(value)
            if isinstance(value, dict):
                return {key: serialize(item) for key, item in value.items()}
            if isinstance(value, (tuple, list)):
                return [serialize(item) for item in value]
            return value

        return serialize(asdict(self))


def calculate_loan(
    amount: str | None,
    term_months: int | None,
    annual_rate_percent: str | None,
) -> LoanCalculationResult:
    """Рассчитать график без комиссий; ставка — проценты годовых, например '24.00'."""
    missing: list[CalculationIssue] = []
    invalid: list[CalculationIssue] = []
    parsed: dict[str, Decimal] = {}
    for field, value in (("amount", amount), ("annual_rate_percent", annual_rate_percent)):
        if value is None:
            missing.append(CalculationIssue(field, "missing_value", "Укажите значение."))
        elif not isinstance(value, str) or DECIMAL_PATTERN.fullmatch(value) is None:
            invalid.append(CalculationIssue(
                field, "invalid_decimal", "Нужна неотрицательная строка с двумя знаками после точки."
            ))
        else:
            parsed[field] = Decimal(value)
    if "amount" in parsed and parsed["amount"] <= ZERO:
        invalid.append(CalculationIssue("amount", "nonpositive_amount", "Сумма кредита должна быть больше нуля."))
    if term_months is None:
        missing.append(CalculationIssue("term_months", "missing_value", "Укажите срок в месяцах."))
    elif type(term_months) is not int or not 1 <= term_months <= MAX_TERM_MONTHS:
        invalid.append(CalculationIssue(
            "term_months", "invalid_term", f"Нужен целый срок от 1 до {MAX_TERM_MONTHS} месяцев."
        ))
    if invalid or missing:
        return LoanCalculationResult(
            "invalid_data" if invalid else "needs_information", issues=tuple(invalid + missing)
        )

    principal = parsed["amount"]
    annual_rate = parsed["annual_rate_percent"]
    with localcontext() as context:
        context.prec = max(38, len(principal.as_tuple().digits) + len(annual_rate.as_tuple().digits) + 28)
        context.rounding = ROUND_HALF_UP
        monthly_rate = annual_rate / 100 / 12
        raw_payment = (
            principal * monthly_rate / (1 - (1 + monthly_rate) ** (-term_months))
            if monthly_rate else principal / term_months
        )
        payment = raw_payment.quantize(CENT)
        balance = principal
        schedule: list[LoanPayment] = []
        for month_number in range(1, term_months + 1):
            interest = (balance * monthly_rate).quantize(CENT)
            # Ограничение остатком исключает переплату при округлении маленьких сумм.
            due = balance + interest if month_number == term_months else min(payment, balance + interest)
            principal_payment = due - interest
            closing_balance = balance - principal_payment
            schedule.append(LoanPayment(
                month_number, balance, principal_payment, interest, due, closing_balance
            ))
            balance = closing_balance
        calculation = LoanCalculation(
            amount=principal,
            term_months=term_months,
            annual_rate_percent=annual_rate,
            monthly_payment=payment,
            maximum_payment=max(row.total_payment for row in schedule),
            total_interest=sum((row.interest_payment for row in schedule), ZERO),
            fees_total=ZERO,
            total_repayment=sum((row.total_payment for row in schedule), ZERO),
            schedule=tuple(schedule),
        )
        return LoanCalculationResult("calculated", calculation)
