"""Дневной расчёт овердрафта по плану поступлений и расходов."""

from collections.abc import Mapping
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP, localcontext
from typing import Any, Literal

from .financials import CalculationIssue, MONEY_PATTERN


CENT = Decimal("0.01")
ZERO = Decimal("0.00")


@dataclass(frozen=True)
class OverdraftPolicy:
    annual_rate_percent: str = "24.00"
    max_debt_days: int = 60
    max_scenario_days: int = 366
    version: str = "demo-overdraft-v1"

    def __post_init__(self) -> None:
        if not isinstance(self.annual_rate_percent, str) or not MONEY_PATTERN.fullmatch(self.annual_rate_percent):
            raise ValueError("Ставка должна быть неотрицательной денежной строкой")
        for value in (self.max_debt_days, self.max_scenario_days):
            if type(value) is not int or not 1 <= value <= 3660:
                raise ValueError("Сроки должны быть целыми от 1 до 3660 дней")
        if not isinstance(self.version, str) or not self.version.strip():
            raise ValueError("Нужна версия политики")


@dataclass(frozen=True)
class OverdraftDay:
    date: str
    opening_cash: Decimal
    opening_principal: Decimal
    inflow: Decimal
    outflow: Decimal
    interest_paid: Decimal
    principal_repaid: Decimal
    drawn: Decimal
    interest_accrued: Decimal
    closing_cash: Decimal
    closing_principal: Decimal
    unpaid_interest: Decimal
    available_limit: Decimal
    limit_excess: Decimal


@dataclass(frozen=True)
class OverdraftCalculation:
    policy_version: str
    limit: Decimal
    annual_rate_percent: Decimal
    start_date: str
    end_date: str
    cash_reserve: Decimal
    required_limit: Decimal
    total_drawn: Decimal
    total_principal_repaid: Decimal
    total_interest: Decimal
    interest_paid: Decimal
    unpaid_interest: Decimal
    fees_total: Decimal
    total_repayment: Decimal
    outstanding_principal: Decimal
    closing_cash: Decimal
    within_limit: bool
    within_repayment_period: bool
    fully_repaid: bool
    feasible: bool
    violations: tuple[CalculationIssue, ...]
    daily: tuple[OverdraftDay, ...]


@dataclass(frozen=True)
class OverdraftCalculationResult:
    status: Literal["calculated", "needs_information", "invalid_data"]
    calculation: OverdraftCalculation | None = None
    issues: tuple[CalculationIssue, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        def serialize(value: Any) -> Any:
            if isinstance(value, Decimal):
                return f"{value:.2f}"
            if isinstance(value, dict):
                return {key: serialize(item) for key, item in value.items()}
            if isinstance(value, (tuple, list)):
                return [serialize(item) for item in value]
            return value

        return serialize(asdict(self))


def calculate_overdraft(
    scenario: Mapping[str, Any] | None,
    limit: str | None,
    *,
    policy: OverdraftPolicy = OverdraftPolicy(),
) -> OverdraftCalculationResult:
    """Рассчитать новый овердрафт с нулевым начальным долгом, без решения о выдаче."""
    missing: list[CalculationIssue] = []
    invalid: list[CalculationIssue] = []

    def money(value: Any, field: str, *, positive: bool = False) -> Decimal | None:
        if value is None:
            missing.append(CalculationIssue(field, "missing_value", "Укажите сумму в рублях."))
        elif not isinstance(value, str) or not MONEY_PATTERN.fullmatch(value):
            invalid.append(CalculationIssue(field, "invalid_money", "Нужна неотрицательная строка с двумя знаками после точки."))
        elif positive and Decimal(value) <= ZERO:
            invalid.append(CalculationIssue(field, "nonpositive_amount", "Сумма должна быть больше нуля."))
        else:
            return Decimal(value)
        return None

    def calendar_date(value: Any, field: str) -> date | None:
        if value is None:
            missing.append(CalculationIssue(field, "missing_value", "Укажите дату."))
            return None
        try:
            parsed = date.fromisoformat(value)
            if parsed.isoformat() != value:
                raise ValueError
            return parsed
        except (TypeError, ValueError):
            invalid.append(CalculationIssue(field, "invalid_date", "Нужна дата YYYY-MM-DD."))
            return None

    parsed_limit = money(limit, "limit", positive=True)
    if scenario is None:
        missing.append(CalculationIssue("scenario", "missing_scenario", "Укажите план поступлений и расходов."))
    elif not isinstance(scenario, Mapping):
        invalid.append(CalculationIssue("scenario", "invalid_scenario", "Сценарий должен быть объектом."))
    if not isinstance(scenario, Mapping):
        return OverdraftCalculationResult("invalid_data" if invalid else "needs_information", issues=tuple(invalid + missing))

    start = calendar_date(scenario.get("start_date"), "scenario.start_date")
    end = calendar_date(scenario.get("end_date"), "scenario.end_date")
    opening_cash = money(scenario.get("opening_cash_balance"), "scenario.opening_cash_balance")
    reserve = money(scenario.get("cash_reserve"), "scenario.cash_reserve")
    if opening_cash is not None and reserve is not None and reserve > opening_cash:
        invalid.append(CalculationIssue("scenario.cash_reserve", "reserve_exceeds_cash", "Резерв не должен превышать собственный начальный остаток."))
    if start is not None and end is not None and not 1 <= (end - start).days + 1 <= policy.max_scenario_days:
        invalid.append(CalculationIssue("scenario.end_date", "invalid_horizon", f"Нужен период от 1 до {policy.max_scenario_days} дней."))
    transactions = scenario.get("transactions")
    if transactions is None:
        missing.append(CalculationIssue("scenario.transactions", "missing_transactions", "Укажите поступления и расходы; пустой список означает отсутствие операций."))
    elif not isinstance(transactions, list):
        invalid.append(CalculationIssue("scenario.transactions", "invalid_transactions", "Операции должны быть списком."))

    parsed_transactions = []
    transaction_ids = set()
    for index, transaction in enumerate(transactions if isinstance(transactions, list) else []):
        field = f"scenario.transactions[{index}]"
        if not isinstance(transaction, Mapping):
            invalid.append(CalculationIssue(field, "invalid_transaction", "Операция должна быть объектом."))
            continue
        identifier = transaction.get("transaction_id")
        if identifier is None:
            missing.append(CalculationIssue(f"{field}.transaction_id", "missing_value", "Нужен идентификатор операции."))
        elif not isinstance(identifier, str) or not identifier.strip():
            invalid.append(CalculationIssue(f"{field}.transaction_id", "invalid_id", "Нужен непустой строковый идентификатор."))
        elif identifier in transaction_ids:
            invalid.append(CalculationIssue(f"{field}.transaction_id", "duplicate_transaction", "Идентификатор операции повторяется."))
        else:
            transaction_ids.add(identifier)
        operation_date = calendar_date(transaction.get("date"), f"{field}.date")
        if operation_date is not None and start is not None and end is not None and not start <= operation_date <= end:
            invalid.append(CalculationIssue(f"{field}.date", "outside_horizon", "Дата операции вне периода расчёта."))
        direction = transaction.get("direction")
        if direction is None:
            missing.append(CalculationIssue(f"{field}.direction", "missing_value", "Укажите направление операции."))
        elif direction not in ("inflow", "outflow"):
            invalid.append(CalculationIssue(f"{field}.direction", "invalid_direction", "Допустимы inflow и outflow."))
        amount = money(transaction.get("amount"), f"{field}.amount", positive=True)
        if operation_date is not None and amount is not None and direction in ("inflow", "outflow"):
            parsed_transactions.append((operation_date, direction, amount))
    if invalid or missing:
        return OverdraftCalculationResult("invalid_data" if invalid else "needs_information", issues=tuple(invalid + missing))

    amounts = [parsed_limit, opening_cash, reserve, Decimal(policy.annual_rate_percent)]
    amounts.extend(amount for _, _, amount in parsed_transactions)
    with localcontext() as context:
        context.prec = max(64, 2 * max(len(value.as_tuple().digits) for value in amounts) + 32)
        context.rounding = ROUND_HALF_UP
        return _calculate(start, end, opening_cash, reserve, parsed_transactions, parsed_limit, policy)


def _calculate(start, end, opening_cash, reserve, transactions, limit, policy):
    operations: dict[date, dict[str, Decimal]] = {}
    for operation_date, direction, amount in transactions:
        day_operations = operations.setdefault(operation_date, {"inflow": ZERO, "outflow": ZERO})
        day_operations[direction] += amount

    annual_rate = Decimal(policy.annual_rate_percent)
    cash = opening_cash
    principal = unpaid_interest = ZERO
    total_drawn = total_principal_repaid = total_interest = total_interest_paid = ZERO
    peak = ZERO
    # Каждая выборка хранит дату и непогашенный основной долг; поступления гасят старые выборки первыми.
    drawings: list[list] = []
    daily = []
    violations = []
    within_limit = within_repayment_period = True

    for day_number in range((end - start).days + 1):
        day = start + timedelta(days=day_number)
        inflow = operations.get(day, {}).get("inflow", ZERO)
        outflow = operations.get(day, {}).get("outflow", ZERO)
        day_opening_cash, day_opening_principal = cash, principal
        cash += inflow
        interest_paid = min(unpaid_interest, max(ZERO, cash - reserve))
        unpaid_interest -= interest_paid
        cash -= interest_paid
        principal_repaid = min(principal, max(ZERO, cash - reserve))
        principal -= principal_repaid
        cash -= principal_repaid
        remaining_repayment = principal_repaid
        while drawings and remaining_repayment > ZERO:
            payment = min(drawings[0][1], remaining_repayment)
            drawings[0][1] -= payment
            remaining_repayment -= payment
            if drawings[0][1] == ZERO:
                drawings.pop(0)

        own_payment = min(outflow, max(ZERO, cash - reserve))
        cash -= own_payment
        drawn = outflow - own_payment
        if drawn > ZERO:
            principal += drawn
            drawings.append([day, drawn])
        peak = max(peak, principal)
        excess = max(ZERO, principal - limit)
        if excess > ZERO and within_limit:
            violations.append(CalculationIssue(f"daily.{day.isoformat()}", "limit_exceeded", f"Для операций {day.isoformat()} требуется долг {principal:.2f} ₽ при лимите {limit:.2f} ₽."))
            within_limit = False
        if drawings and (day - drawings[0][0]).days >= policy.max_debt_days and within_repayment_period:
            violations.append(CalculationIssue(f"daily.{day.isoformat()}", "repayment_deadline_exceeded", f"К {day.isoformat()} не погашена выборка от {drawings[0][0].isoformat()}."))
            within_repayment_period = False

        interest = (principal * annual_rate / Decimal("100") / Decimal("365")).quantize(CENT)
        unpaid_interest += interest
        total_drawn += drawn
        total_principal_repaid += principal_repaid
        total_interest += interest
        total_interest_paid += interest_paid
        daily.append(OverdraftDay(
            day.isoformat(), day_opening_cash, day_opening_principal,
            inflow, outflow, interest_paid, principal_repaid, drawn, interest,
            cash, principal, unpaid_interest, max(ZERO, limit - principal), excess,
        ))

    fully_repaid = principal == ZERO and unpaid_interest == ZERO
    if not fully_repaid:
        violations.append(CalculationIssue("scenario.end_date", "repayment_not_demonstrated", "До конца сценария не показано полное погашение основного долга и процентов."))
    calculation = OverdraftCalculation(
        policy.version, limit, annual_rate, start.isoformat(), end.isoformat(), reserve,
        peak, total_drawn, total_principal_repaid, total_interest, total_interest_paid,
        unpaid_interest, ZERO, total_drawn + total_interest, principal, cash,
        within_limit, within_repayment_period, fully_repaid,
        within_limit and within_repayment_period and fully_repaid,
        tuple(violations), tuple(daily),
    )
    return OverdraftCalculationResult("calculated", calculation)
