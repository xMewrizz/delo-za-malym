"""Данные существующего клиента и локальный симулятор банковских проверок."""

from copy import deepcopy
from datetime import date, datetime, timedelta

from scripts.run_credit_scenarios import load_scenarios


PRODUCTS = ("working_capital_loan", "overdraft")
SUPPORTED_PRODUCTS = (*PRODUCTS, "refinancing")


def shifted_month(month: str, delta: int) -> str:
    year, number = map(int, month.split("-"))
    year, index = divmod(year * 12 + number - 1 + delta, 12)
    return f"{year:04d}-{index + 1:02d}"


def scenario_data(product: str, scenario_id: str, now: datetime):
    scenario = deepcopy(load_scenarios(scenario_id, product=product)[0])
    application, checks = scenario["input"]["application"], scenario["input"]["checks"]
    anchor = datetime.fromisoformat(scenario["input"]["calculated_at"]).date()
    days = now.date() - anchor
    months = (now.year - anchor.year) * 12 + now.month - anchor.month
    for row in application["financials"]["monthly"]:
        row["month"] = shifted_month(row["month"], months)
    def shift(value):
        return (date.fromisoformat(value) + days).isoformat() if value else value
    application["need"]["needed_by"] = shift(application["need"].get("needed_by"))
    for loan in application["financials"].get("existing_loans") or []:
        loan["maturity_date"] = shift(loan["maturity_date"])
    plan = application.get("product_details", {}).get("overdraft")
    if plan:
        plan["start_date"], plan["end_date"] = shift(plan["start_date"]), shift(plan["end_date"])
        for transaction in plan["transactions"]:
            transaction["date"] = shift(transaction["date"])
    return application, {
        "checks": checks,
        "known_loans": deepcopy(application["financials"].get("existing_loans")),
        "bank_financials": deepcopy(application["financials"]),
        "profile_loaded_at": now.isoformat(),
        "attempts": 0,
    }


def profile(now: datetime):
    application, simulator = scenario_data("working_capital_loan", "01_approved", now)
    # График существующего кредита приходит из демонстрационного банковского профиля.
    for loan in application["financials"].get("existing_loans", []):
        maturity = date.fromisoformat(loan["maturity_date"])
        current = now.date().replace(day=15)
        if current < now.date():
            month = shifted_month(current.strftime("%Y-%m"), 1)
            current = date.fromisoformat(month + "-15")
        schedule = []
        while current <= maturity:
            schedule.append({"date": current.isoformat(), "total_payment": loan["monthly_payment"]})
            month = shifted_month(current.strftime("%Y-%m"), 1)
            current = date.fromisoformat(month + "-15")
        loan["schedule"] = schedule
    simulator["known_loans"] = deepcopy(application["financials"].get("existing_loans", []))
    simulator["bank_financials"] = deepcopy(application["financials"])
    return {"client_id": "demo-client", "company_name": "ООО «Север»", "business": application["business"],
            "financials": application["financials"]}, simulator


def simulate_checks(application, simulator, now, *, retry=False):
    checks = deepcopy(simulator["checks"])
    checks.update(application_id=application["application_id"], application_version=application["application_version"],
                  business_inn=application["business"]["inn"], checked_at=now.isoformat())
    # Регистрационные сведения и долги приходят из профиля симулятора, а не из редактируемой анкеты.
    if checks["obligations"]["status"] == "completed":
        checks["obligations"]["matches_application"] = (
            application.get("financials", {}).get("existing_loans") == simulator["known_loans"]
        )
    if retry:
        simulator["recovered"] = True
    if simulator.get("recovered"):
        for name in ("registration", "restrictions", "credit_history", "obligations"):
            if checks[name]["status"] in ("error", "pending"):
                checks[name]["status"] = "completed"
                if name == "credit_history":
                    checks[name]["category"] = checks[name].get("category") or "good"
    simulator["attempts"] += 1
    return checks


def scenarios():
    return [{"product_id": product, "scenario_id": case["scenario_id"], "title": case["title"],
             "description": case["description"]}
            for product in PRODUCTS for case in load_scenarios(product=product)]
