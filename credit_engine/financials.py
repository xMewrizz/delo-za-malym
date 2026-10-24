"""Расчёт денежных показателей по контракту financials версии 0.1."""

from collections.abc import Mapping
from dataclasses import asdict, dataclass
from datetime import date
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP, localcontext
import re
from typing import Any, Literal


ZERO = Decimal("0")
CENT = Decimal("0.01")
MONEY_PATTERN = re.compile(r"[0-9]+\.[0-9]{2}")
MONTH_PATTERN = re.compile(r"[0-9]{4}-(0[1-9]|1[0-2])")
DATE_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


@dataclass(frozen=True)
class FinancialPolicy:
    history_months: int = 6
    debt_service_fraction: Decimal = Decimal("0.70")
    version: str = "demo-v1"
    allow_seasonal_cash_flow: bool = False

    def __post_init__(self) -> None:
        if type(self.allow_seasonal_cash_flow) is not bool:
            raise ValueError("allow_seasonal_cash_flow должен быть bool")
        if type(self.history_months) is not int or self.history_months < 1:
            raise ValueError("history_months должен быть положительным целым числом")
        ratio = self.debt_service_fraction
        if not isinstance(ratio, Decimal) or not ratio.is_finite() or not ZERO < ratio <= 1:
            raise ValueError("debt_service_fraction должен быть Decimal в интервале (0, 1]")


@dataclass(frozen=True)
class CalculationIssue:
    field: str
    code: str
    message: str


@dataclass(frozen=True)
class MonthlyCashFlow:
    month: str
    cash_flow: Decimal


@dataclass(frozen=True)
class FinancialMetrics:
    monthly_cash_flow: tuple[MonthlyCashFlow, ...]
    average_monthly_inflow: Decimal
    average_monthly_outflow: Decimal
    average_monthly_taxes: Decimal
    average_monthly_cash_flow: Decimal
    minimum_monthly_cash_flow: Decimal
    underwriting_cash_flow: Decimal
    existing_monthly_debt_service: Decimal
    cash_flow_after_existing_debt: Decimal
    operating_reserve: Decimal
    total_debt_service_limit: Decimal
    available_monthly_payment: Decimal
    cash_flow_margin: Decimal | None
    inflow_cv: Decimal | None
    largest_buyer_share: Decimal | None
    nonpositive_cash_flow_months: int


@dataclass(frozen=True)
class FinancialMetricsResult:
    status: Literal["calculated", "needs_information", "invalid_data", "out_of_policy"]
    assessment_date: str | None
    policy_version: str
    metrics: FinancialMetrics | None = None
    issues: tuple[CalculationIssue, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        """JSON-совместимое представление; Decimal передаются строками."""
        def serialize(value: Any) -> Any:
            if isinstance(value, Decimal):
                return str(value)
            if isinstance(value, dict):
                return {key: serialize(item) for key, item in value.items()}
            if isinstance(value, (tuple, list)):
                return [serialize(item) for item in value]
            return value

        return serialize(asdict(self))


class _Validation:
    def __init__(self) -> None:
        self.missing: list[CalculationIssue] = []
        self.invalid: list[CalculationIssue] = []

    def money(self, value: Any, field: str) -> Decimal | None:
        if value is None:
            self.missing.append(CalculationIssue(field, "missing_value", "Укажите сумму в рублях."))
            return None
        if not isinstance(value, str) or MONEY_PATTERN.fullmatch(value) is None:
            self.invalid.append(CalculationIssue(
                field, "invalid_money", "Нужна неотрицательная сумма строкой с двумя знаками после точки."
            ))
            return None
        return Decimal(value)

    def iso_date(self, value: Any, field: str) -> date | None:
        if value is None:
            self.missing.append(CalculationIssue(field, "missing_value", "Укажите дату YYYY-MM-DD."))
            return None
        if isinstance(value, str) and DATE_PATTERN.fullmatch(value):
            try:
                return date.fromisoformat(value)
            except ValueError:
                pass
        self.invalid.append(CalculationIssue(field, "invalid_date", "Нужна существующая дата YYYY-MM-DD."))
        return None


def _required_months(assessment_date: date, count: int) -> tuple[str, ...]:
    current = (assessment_date.year - 1) * 12 + assessment_date.month - 1
    if current < count:
        raise ValueError("Недостаточно календарных месяцев до даты оценки")
    return tuple(
        f"{ordinal // 12 + 1:04d}-{ordinal % 12 + 1:02d}"
        for ordinal in range(current - count, current)
    )


def calculate_financial_metrics(
    financials: Mapping[str, Any] | None,
    assessment_date: date | str,
    *,
    policy: FinancialPolicy = FinancialPolicy(),
) -> FinancialMetricsResult:
    """Вернуть показатели или ошибки данных без кредитного решения и внешних проверок."""
    validation = _Validation()
    as_of = assessment_date if type(assessment_date) is date else validation.iso_date(
        assessment_date, "assessment_date"
    )
    if as_of is None:
        issues = tuple(validation.invalid + validation.missing)
        status = "invalid_data" if validation.invalid else "needs_information"
        return FinancialMetricsResult(status, None, policy.version, issues=issues)
    try:
        months = _required_months(as_of, policy.history_months)
    except ValueError as error:
        return FinancialMetricsResult(
            "invalid_data", as_of.isoformat(), policy.version,
            issues=(CalculationIssue("assessment_date", "invalid_history_period", str(error)),),
        )
    if financials is None:
        return FinancialMetricsResult(
            "needs_information", as_of.isoformat(), policy.version,
            issues=(CalculationIssue("financials", "missing_financials", "Предоставьте финансовые данные."),),
        )
    if not isinstance(financials, Mapping):
        return FinancialMetricsResult(
            "invalid_data", as_of.isoformat(), policy.version,
            issues=(CalculationIssue("financials", "invalid_financials", "Финансовые данные должны быть объектом."),),
        )

    # Отбираем полные месяцы; порядок входных записей не влияет на результат.
    monthly = financials.get("monthly")
    selected: dict[str, tuple[Decimal, Decimal, Decimal]] = {}
    seen_months: set[str] = set()
    if monthly is None:
        validation.missing.append(CalculationIssue(
            "financials.monthly", "missing_monthly_history", "Предоставьте помесячные показатели."
        ))
    elif not isinstance(monthly, list):
        validation.invalid.append(CalculationIssue(
            "financials.monthly", "invalid_monthly_history", "Помесячные показатели должны быть списком."
        ))
    else:
        for index, row in enumerate(monthly):
            field = f"financials.monthly[{index}]"
            if not isinstance(row, Mapping):
                validation.invalid.append(CalculationIssue(field, "invalid_month", "Запись месяца должна быть объектом."))
                continue
            month = row.get("month")
            if month is None:
                validation.missing.append(CalculationIssue(f"{field}.month", "missing_month", "Укажите месяц YYYY-MM."))
                continue
            if not isinstance(month, str) or MONTH_PATTERN.fullmatch(month) is None or month.startswith("0000"):
                validation.invalid.append(CalculationIssue(f"{field}.month", "invalid_month", "Нужен месяц YYYY-MM."))
                continue
            if month in seen_months:
                validation.missing.append(CalculationIssue(
                    f"{field}.month", "duplicate_month", f"Уточните единственные итоговые показатели за {month}."
                ))
                continue
            seen_months.add(month)
            if month not in months:
                continue
            values = tuple(validation.money(row.get(key), f"{field}.{key}") for key in (
                "operating_inflow", "operating_outflow", "taxes"
            ))
            if all(value is not None for value in values):
                selected[month] = values
        for month in months:
            if month not in seen_months:
                validation.missing.append(CalculationIssue(
                    "financials.monthly", "missing_month", f"Предоставьте показатели за {month}."
                ))

    payments: list[Decimal] = []
    loans = financials.get("existing_loans")
    seen_loans: set[str] = set()
    if loans is None:
        validation.missing.append(CalculationIssue(
            "financials.existing_loans", "missing_existing_loans", "Укажите кредиты или подтвердите их отсутствие списком []."
        ))
    elif not isinstance(loans, list):
        validation.invalid.append(CalculationIssue(
            "financials.existing_loans", "invalid_existing_loans", "Кредиты должны быть списком."
        ))
    else:
        for index, loan in enumerate(loans):
            field = f"financials.existing_loans[{index}]"
            if not isinstance(loan, Mapping):
                validation.invalid.append(CalculationIssue(field, "invalid_loan", "Кредит должен быть объектом."))
                continue
            loan_id = loan.get("loan_id")
            if loan_id is None:
                validation.missing.append(CalculationIssue(f"{field}.loan_id", "missing_loan_id", "Укажите идентификатор кредита."))
            elif not isinstance(loan_id, str) or not loan_id.strip():
                validation.invalid.append(CalculationIssue(f"{field}.loan_id", "invalid_loan_id", "Нужен непустой строковый идентификатор."))
            elif loan_id in seen_loans:
                validation.missing.append(CalculationIssue(f"{field}.loan_id", "duplicate_loan", "Устраните повтор сведений об одном кредите."))
            else:
                seen_loans.add(loan_id)
            principal = validation.money(loan.get("outstanding_principal"), f"{field}.outstanding_principal")
            payment = validation.money(loan.get("monthly_payment"), f"{field}.monthly_payment")
            maturity = validation.iso_date(loan.get("maturity_date"), f"{field}.maturity_date")
            if principal is not None and principal > ZERO:
                if maturity is not None and maturity < as_of:
                    validation.missing.append(CalculationIssue(
                        f"{field}.maturity_date", "expired_loan_with_balance", "Уточните задолженность по кредиту с истёкшим сроком."
                    ))
                if payment == ZERO:
                    validation.missing.append(CalculationIssue(
                        f"{field}.monthly_payment", "zero_payment_with_balance", "Уточните график обязательств при положительном остатке долга."
                    ))
            if payment is not None:
                payments.append(payment)

    # Остаток не увеличивает доступный платёж; концентрация может быть неизвестной.
    cash_balance = financials.get("cash_balance")
    if cash_balance is not None:
        validation.money(cash_balance, "financials.cash_balance")
    share_value = financials.get("largest_buyer_share")
    share = None
    if share_value is not None:
        if type(share_value) in (int, float, Decimal):
            share = Decimal(str(share_value))
        if share is None or not share.is_finite() or not ZERO <= share <= 1:
            validation.invalid.append(CalculationIssue(
                "financials.largest_buyer_share", "invalid_buyer_share", "Доля должна быть числом от 0 до 1."
            ))

    if validation.invalid or validation.missing:
        status = "invalid_data" if validation.invalid else "needs_information"
        return FinancialMetricsResult(
            status, as_of.isoformat(), policy.version,
            issues=tuple(validation.invalid + validation.missing),
        )

    rows = [selected[month] for month in months]
    values = [value for row in rows for value in row] + payments
    # Запас точности сохраняет копейки и при больших суммах, без изменения глобального контекста.
    with localcontext() as context:
        context.prec = max(38, max(len(value.as_tuple().digits) for value in values) + 28)
        context.rounding = ROUND_HALF_UP
        return _calculate(rows, months, payments, share, as_of, policy)


def _calculate(
    rows: list[tuple[Decimal, Decimal, Decimal]],
    months: tuple[str, ...],
    payments: list[Decimal],
    share: Decimal | None,
    as_of: date,
    policy: FinancialPolicy,
) -> FinancialMetricsResult:
    count = Decimal(len(rows))
    inflow = sum((row[0] for row in rows), ZERO)
    outflow = sum((row[1] for row in rows), ZERO)
    taxes = sum((row[2] for row in rows), ZERO)
    flows = tuple(MonthlyCashFlow(month, row[0] - row[1] - row[2]) for month, row in zip(months, rows))
    total_flow = sum((row.cash_flow for row in flows), ZERO)
    minimum = min(row.cash_flow for row in flows)
    debt_service = sum(payments, ZERO).quantize(CENT)
    underwriting = minimum
    seasonal_supported = False
    if policy.allow_seasonal_cash_flow and minimum <= ZERO and len(flows) >= 3:
        # Скользящий квартал сглаживает разовую закупку, но не скрывает
        # устойчивый дефицит: проверяются все окна, а не только последнее.
        quarterly = tuple(sum((row.cash_flow for row in flows[index:index + 3]), ZERO) / 3
                          for index in range(len(flows) - 2))
        seasonal_supported = (total_flow > ZERO and min(quarterly) > ZERO
                              and sum(row.cash_flow <= ZERO for row in flows) <= 2)
        if seasonal_supported:
            underwriting = min(total_flow / count, min(quarterly)).quantize(CENT, rounding=ROUND_DOWN)
    positive_flow = max(ZERO, underwriting)
    # Лимит округляется вниз: округление вверх нарушило бы ограничение нагрузки.
    limit = (positive_flow * policy.debt_service_fraction).quantize(CENT, rounding=ROUND_DOWN)
    mean_inflow = inflow / count
    variance = sum(((row[0] - mean_inflow) ** 2 for row in rows), ZERO) / count
    metrics = FinancialMetrics(
        monthly_cash_flow=flows,
        average_monthly_inflow=mean_inflow.quantize(CENT),
        average_monthly_outflow=(outflow / count).quantize(CENT),
        average_monthly_taxes=(taxes / count).quantize(CENT),
        average_monthly_cash_flow=(total_flow / count).quantize(CENT),
        minimum_monthly_cash_flow=minimum,
        underwriting_cash_flow=underwriting,
        existing_monthly_debt_service=debt_service,
        cash_flow_after_existing_debt=underwriting - debt_service,
        operating_reserve=positive_flow - limit,
        total_debt_service_limit=limit,
        available_monthly_payment=max(ZERO, limit - debt_service).quantize(CENT),
        cash_flow_margin=total_flow / inflow if inflow else None,
        inflow_cv=variance.sqrt() / mean_inflow if mean_inflow else None,
        largest_buyer_share=share,
        nonpositive_cash_flow_months=sum(row.cash_flow <= ZERO for row in flows),
    )
    issues = ()
    status = "calculated"
    if total_flow > ZERO and minimum <= ZERO and not seasonal_supported:
        status = "out_of_policy"
        issues = (CalculationIssue(
            "financials.monthly", "unstable_seasonal_cash_flow" if policy.allow_seasonal_cash_flow else "nonpositive_monthly_cash_flow",
            "История не проходит автоматическую оценку сезонности: нужен положительный поток в каждом скользящем квартале и не более двух неположительных месяцев." if policy.allow_seasonal_cash_flow else "При положительном среднем потоке есть неположительный месяц; нужна модель календаря денежных потоков.",
        ),)
    return FinancialMetricsResult(status, as_of.isoformat(), policy.version, metrics, issues)
