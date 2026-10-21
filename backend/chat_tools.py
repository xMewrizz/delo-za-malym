"""Инструменты одного хода: расчёты на копии заявки и публичный поиск."""

from copy import deepcopy
import json
import logging
import re

from credit_engine import calculate_loan, recommend_financing
from scr.delo_za_malyn.Models.Agent.tools import AgentTools

from . import demo
from .assistant import validate_changes
from .service import ProcessError

logger = logging.getLogger(__name__)


def definition(name, description, properties=None, required=None):
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": properties or {},
                       "required": required or [], "additionalProperties": False},
    }}


CALCULATIONS = [
    definition("calculate_loan", "Аннуитетный платёж и переплата вне лимитов продуктов. Нужны сумма, срок и ставка клиента; неизвестное — null. Не оценивает одобрение.",
               {"amount": {"type": ["string", "null"], "description": "Рубли: 30000000.00"},
                "term_months": {"type": ["integer", "null"], "description": "Месяцы: 1–600"},
                "annual_rate_percent": {"type": ["string", "null"], "description": "Проценты годовых: 18.00"}}),
    definition("assess_credit", "Предварительно рассчитать сохранённую заявку. Не меняет заявку и не отправляет её в банк. Продукт должен быть выбран."),
    definition("recommend_financing", "Подобрать разовый кредит или овердрафт по сохранённой потребности. Не меняет заявку."),
    definition("simulate_alternative", "Посчитать отдельный вариант «а если» на копии заявки, не сохраняя изменения.",
               {"changes": {"type": "object", "description": "Только изменённые поля need, например need.requested_amount: строка рублей с двумя десятичными знаками, need.term_months: целое.", "additionalProperties": True}}, ["changes"]),
]


def compact(value):
    """Не передавать модели скоринговые правила и большие графики платежей."""
    excluded = {"scoring", "financial_metrics", "schedule", "payment_schedule",
                "daily_balances", "evaluation", "checks", "simulator"}
    if isinstance(value, dict):
        return {key: compact(item) for key, item in value.items() if key not in excluded}
    if isinstance(value, list):
        return [compact(item) for item in value]
    return value


class CabinetTools:
    def __init__(self, process, record, now, search):
        self.process, self.record, self.now = process, deepcopy(record), now
        self.search = AgentTools(search)

    @property
    def definitions(self):
        selected = self.record["application"]["need"].get("preferred_product") in demo.PRODUCTS
        return [deepcopy(item) for item in CALCULATIONS
                if selected or item["function"]["name"] != "assess_credit"] + self.search.definitions

    def execute(self, name, arguments):
        if name == "assess_credit" and self.record["application"]["need"].get("preferred_product") not in demo.PRODUCTS:
            return {"ok": False, "error": {"code": "product_required", "message": "Сначала выберите продукт или выполните подбор по потребности."}}
        allowed = {item["function"]["name"] for item in self.definitions}
        if name not in allowed:
            return {"ok": False, "error": {"code": "unknown_tool", "message": "Инструмент недоступен."}}
        try:
            if not isinstance(arguments, str) or len(arguments) > 4096:
                raise ValueError("Нужен короткий JSON-объект аргументов.")
            args = json.loads(arguments)
            if not isinstance(args, dict):
                raise ValueError("Аргументы должны быть объектом.")
            if name == "calculate_loan":
                return self.calculate_payment(args)
            if name == "web_search":
                query = args.get("query")
                business = self.record["application"].get("business") or {}
                if isinstance(query, str) and (
                    re.search(r"\b\d{10,12}\b|\S+@\S+", query)
                    or any(str(business.get(field, "")).strip() in query for field in
                           ("inn", "name", "company_name", "address")
                           if len(str(business.get(field, "")).strip()) >= 6)
                ):
                    return {"ok": False, "error": {"code": "private_query", "message": "Уберите сведения о клиенте из публичного запроса."}}
                return json.loads(self.search.execute(name, arguments))
            if set(args) != ({"changes"} if name == "simulate_alternative" else set()):
                raise ValueError("Недопустимые аргументы инструмента.")
            snapshot = deepcopy(self.record)
            changes = args.get("changes", {})
            if name == "simulate_alternative":
                if not isinstance(changes, dict) or not changes:
                    raise ValueError("Укажите изменения для отдельного варианта.")
                validate_changes(changes)
                for path, value in changes.items():
                    snapshot["application"]["need"][path.split(".")[1]] = value
                snapshot["application"]["confirmation"] = None
            if name == "recommend_financing":
                checks = demo.simulate_checks(snapshot["application"], snapshot["simulator"], self.now)
                result = recommend_financing(snapshot["application"], checks, calculated_at=self.now).to_dict()
            else:
                self.process._assess(snapshot, self.now, stage="preliminary")
                result = snapshot["result"]
            return {"ok": True, "mode": "simulated", "stage": "preliminary", "saved": False,
                    "application_version": self.record["application"]["application_version"],
                    "changes": changes, "result": compact(result)}
        except (ValueError, TypeError, ProcessError) as exc:
            code = exc.code if isinstance(exc, ProcessError) else "invalid_arguments"
            logger.info("Calculation tool rejected: name=%s code=%s", name, code)
            return {"ok": False, "error": {"code": code, "message": str(exc)}}

    @staticmethod
    def calculate_payment(args):
        fields = {"amount", "term_months", "annual_rate_percent"}
        if set(args) - fields:
            raise ValueError("Калькулятор принимает только amount, term_months и annual_rate_percent.")
        for field in ("amount", "annual_rate_percent"):
            if isinstance(args.get(field), str) and len(args[field]) > 64:
                raise ValueError("Слишком длинная числовая запись; используйте до 64 символов.")
        # Reuse the project's Decimal calculator, including its validation and
        # final-payment rounding. No product policy or application state is used.
        result = calculate_loan(args.get("amount"), args.get("term_months"),
                                args.get("annual_rate_percent")).to_dict()
        response = {"ok": result["status"] == "calculated", "mode": "illustrative",
                    "saved": False, "eligibility_assessed": False,
                    "assumptions": {"payment_type": "annuity", "currency": "RUB",
                                    "fees_included": False, "insurance_included": False},
                    "missing_fields": [issue["field"] for issue in result["issues"] if issue["code"] == "missing_value"],
                    "result": compact(result)}
        if not response["ok"]:
            names = {"amount": "сумму", "term_months": "срок в месяцах", "annual_rate_percent": "годовую ставку"}
            message = ("Уточните " + ", ".join(names[field] for field in response["missing_fields"]) + "."
                       if result["status"] == "needs_information" else "Проверьте сумму, срок и ставку: " + "; ".join(issue["message"] for issue in result["issues"]))
            response["error"] = {"code": result["status"], "message": message}
        return response
