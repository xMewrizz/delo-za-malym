"""Объяснимый демонстрационный скоринг; баллы не являются вероятностью дефолта."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from .financials import CalculationIssue, FinancialMetrics


CREDIT_HISTORY_POINTS = {
    "good": 50,
    "no_history": 25,
    "minor_delinquency": 15,
    "serious_delinquency": 0,
}
LOW_RISK_THRESHOLD = 80
MEDIUM_RISK_THRESHOLD = 50


@dataclass(frozen=True)
class ScoreComponent:
    code: str
    points: int
    max_points: int
    message: str


@dataclass(frozen=True)
class RiskScoreResult:
    status: Literal["calculated", "needs_information", "invalid_data"]
    score: int | None = None
    risk_grade: Literal["low", "medium", "high"] | None = None
    components: tuple[ScoreComponent, ...] = ()
    issues: tuple[CalculationIssue, ...] = ()
    policy_version: str = "demo-v1"


def calculate_risk_score(
    metrics: FinancialMetrics, credit_history_category: str | None,
) -> RiskScoreResult:
    """Оценить историю, колебания поступлений и концентрацию покупателей."""
    issues = []
    if credit_history_category is None:
        issues.append(CalculationIssue(
            "checks.credit_history.category", "missing_credit_history",
            "Нужен результат проверки кредитной истории.",
        ))
    elif not isinstance(credit_history_category, str) or credit_history_category not in CREDIT_HISTORY_POINTS:
        return RiskScoreResult("invalid_data", issues=(CalculationIssue(
            "checks.credit_history.category", "invalid_credit_history", "Неизвестная категория кредитной истории.",
        ),))
    if metrics.inflow_cv is None:
        issues.append(CalculationIssue(
            "financials.monthly", "undefined_inflow_variation", "Недостаточно поступлений для оценки их стабильности.",
        ))
    if metrics.largest_buyer_share is None:
        issues.append(CalculationIssue(
            "financials.largest_buyer_share", "missing_buyer_share",
            "Укажите долю крупнейшего покупателя в поступлениях за расчётный период.",
        ))
    if issues:
        return RiskScoreResult("needs_information", issues=tuple(issues))

    cv = metrics.inflow_cv
    share = metrics.largest_buyer_share
    stability = next((points for limit, points in (
        (Decimal("0.10"), 30), (Decimal("0.30"), 20), (Decimal("0.60"), 10),
    ) if cv <= limit), 0)
    concentration = next((points for limit, points in (
        (Decimal("0.25"), 20), (Decimal("0.50"), 10), (Decimal("0.75"), 5),
    ) if share <= limit), 0)
    components = (
        ScoreComponent("credit_history", CREDIT_HISTORY_POINTS[credit_history_category], 50,
                       f"Категория кредитной истории: {credit_history_category}."),
        ScoreComponent("inflow_stability", stability, 30, f"Коэффициент колебаний поступлений: {cv:.4f}."),
        ScoreComponent("buyer_concentration", concentration, 20, f"Доля крупнейшего покупателя: {share:.2%}."),
    )
    score = sum(component.points for component in components)
    if credit_history_category == "serious_delinquency":
        grade = "high"
    else:
        grade = "low" if score >= LOW_RISK_THRESHOLD else "medium" if score >= MEDIUM_RISK_THRESHOLD else "high"
    return RiskScoreResult("calculated", score, grade, components)
