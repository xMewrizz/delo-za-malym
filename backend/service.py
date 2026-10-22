"""Процесс заявки: версии, рассмотрение, выбор, условия и моделируемая выдача."""

from copy import deepcopy
from uuid import uuid4
from decimal import Decimal

from credit_engine import assess_application, assess_overdraft, calculate_loan, check_offer_readiness, recommend_financing

from . import demo
from .client_data import bank_financials, client_data, preserves_bank_values
from .store import Store
from .sources import source_value
from .portfolio import belongs_to_client, issued_loans, with_loans, include_scheduled_payments, calendar_data
from .portfolio import refinanced_loans, cash_disbursed
from credit_engine.refinancing import assess_refinancing
from credit_engine.financials import MONEY_PATTERN
from credit_engine.revolving import assess_revolving
from credit_engine.investment import assess_investment, project_values


class ProcessError(Exception):
    def __init__(self, code, message, status_code=409):
        self.code, self.message, self.status_code = code, message, status_code
        super().__init__(message)


NEED_FIELDS = {"purpose", "preferred_product", "requested_amount", "term_months", "needed_by", "recurring",
               "own_funds", "priority", "minimum_acceptable_amount", "financing_pattern", "project_cost", "principal_grace_months"}
FINANCIAL_FIELDS = {"monthly", "cash_balance", "existing_loans", "largest_buyer_share"}
EDITABLE_STATES = {"draft", "waiting_for_data", "check_retry_pending", "offers_ready", "conditions_pending",
                   "ready_to_sign", "offer_expired", "declined", "out_of_policy"}


def set_state(record, status, step, action, label, now):
    record["state"].update(status=status, current_step=step, next_action={"type": action, "label": label},
                           updated_at=now.isoformat())


def event(record, kind, now, **details):
    record["events"].append({"event_id": str(uuid4()), "type": kind, "application_version": record["application"]["application_version"],
                             "created_at": now.isoformat(), "details": details})


class CreditProcess:
    def __init__(self, store: Store, clock):
        self.store, self.clock = store, clock

    def profile(self):
        profile, _ = demo.profile(self.clock())
        records = self.store.list()
        profile["financials"] = with_loans(profile["financials"], issued_loans(records, self.clock()), closed=refinanced_loans(records), cash_total=cash_disbursed(records))
        return profile

    def calendar(self):
        result = calendar_data(self.store.list(), self.clock())
        profile = self.profile()
        for loan in profile["financials"].get("existing_loans", []):
            if loan.get("application_id"):
                continue
            for row in loan.get("schedule", []):
                result["events"].append({"event_id": f"bank:{loan['loan_id']}:{row['date']}", "application_id": "", "loan_id": loan["loan_id"],
                    "date": row["date"], "amount": row["total_payment"], "direction": "outflow", "kind": "existing_loan_payment",
                    "title": "Платёж по действующему кредиту", "forecast": True})
        result["events"].sort(key=lambda item: (item["date"], item["event_id"]))
        return result

    def sync_portfolio(self, connection=None):
        if connection is None:
            with self.store.connect(write=True) as connection:
                return self.sync_portfolio(connection)
        records = self.store.records(connection)
        loans = issued_loans(records, self.clock())
        closed, cash = refinanced_loans(records), cash_disbursed(records)
        for record in records:
            completion = record.get("completion") or {}
            closure = closed.get("cabinet-loan:" + completion.get("operation_id", ""))
            if closure and completion.get("refinanced_by") != closure["application_id"]:
                completion.update(refinanced_by=closure["application_id"], refinanced_at=closure["closed_at"])
                event(record, "credit_refinanced", self.clock(), replacement_application_id=closure["application_id"])
                self.store.save(connection, record)
            if not belongs_to_client(record) or record["state"]["status"] not in EDITABLE_STATES:
                continue
            known = bank_financials(record)
            updated = with_loans(known, loans, closed=closed, cash_total=cash)
            if updated == known:
                continue
            record["simulator"]["bank_financials"] = updated
            record["simulator"]["known_loans"] = deepcopy(updated["existing_loans"])
            application = record["application"]
            application["financials"]["existing_loans"] = deepcopy(updated["existing_loans"])
            if updated.get("cash_balance") is not None:
                application["financials"]["cash_balance"] = updated["cash_balance"]
                application["financials"]["portfolio_cash_total"] = updated["portfolio_cash_total"]
            details = application.get("product_details") or {}
            if details.get("overdraft"):
                details["overdraft"]["opening_cash_balance"] = updated.get("cash_balance") or "0.00"
                details["overdraft"] = include_scheduled_payments(details["overdraft"], updated["existing_loans"], closed=closed)
            application["application_version"] += 1
            application["confirmation"] = None
            record["field_sources"] = {path: source for path, source in record.get("field_sources", {}).items()
                if source_value(application, path) == source["value"]}
            record["state"].update(application_version=application["application_version"], latest_assessment_id=None, selected_offer_id=None)
            record.update(checks=None, result=None, readiness=None, recommendation=None, fulfilled_conditions={})
            set_state(record, "draft", "data_collection", "complete_profile", "Обязательства обновились. Пересчитайте предложения перед отправкой", self.clock())
            event(record, "bank_obligations_updated", self.clock())
            self.store.save(connection, record)

    @staticmethod
    def public(record):
        return deepcopy({key: record.get(key) for key in
                         ("application", "state", "checks", "result", "readiness", "recommendation", "signature", "completion", "events", "submitted_versions")} |
                        {key: record.get(key, []) for key in ("explorations", "imports")} |
                        {"documents": record.get("documents", []), "field_sources": record.get("field_sources", {})} |
                        {"client_data": client_data(record)})

    def get(self, application_id):
        with self.store.connect() as connection:
            record = self.store.get(connection, application_id)
        if record is None:
            raise ProcessError("application_not_found", "Заявка не найдена.", 404)
        return self.public(record)

    def list(self):
        return [{"application_id": record["application"]["application_id"], "need": record["application"]["need"],
                 "state": record["state"], "completion": record["completion"],
                 "ready_for_application": record["state"]["status"] != "draft" or any(
                     item["type"] == "explored_option_applied" for item in record["events"])} for record in self.store.list()]

    def create(self, *, need=None, financials=None, product_details=None, scenario=None):
        now = self.clock()
        if scenario:
            try:
                application, simulator = demo.scenario_data(*scenario, now)
            except ValueError as exc:
                raise ProcessError("scenario_not_found", "Демонстрационный сценарий не найден.", 404) from exc
        else:
            profile, simulator = demo.profile(now)
            application = {
                "schema_version": "0.1", "currency": "RUB",
                "business": profile["business"], "financials": profile["financials"] if financials is None else financials,
                "need": {field: None for field in sorted(NEED_FIELDS)},
            }
            if need:
                self._validate_fields(need, NEED_FIELDS, "need")
                application["need"].update(deepcopy(need))
            if product_details is not None:
                application["product_details"] = deepcopy(product_details)
            # Учёт уже выданных денег восстанавливается только из операций банка.
            application["financials"].pop("portfolio_cash_total", None)
            self._check_bank_financials(simulator["bank_financials"], application["financials"])
        application.update(application_id=str(uuid4()), application_version=1, confirmation=None)
        state = {"application_id": application["application_id"], "application_version": 1,
                 "latest_assessment_id": None, "selected_offer_id": None}
        record = {"application": application, "state": state, "simulator": simulator, "checks": None, "result": None,
                  "readiness": None, "recommendation": None, "fulfilled_conditions": {}, "signature": None, "completion": None,
                  "events": [], "submitted_versions": []}
        set_state(record, "draft", "data_collection", "complete_profile", "Укажите потребность в финансировании", now)
        event(record, "application_created", now, scenario=scenario)
        with self.store.connect(write=True) as connection:
            if not scenario:
                records = self.store.records(connection)
                loans, closed, cash = issued_loans(records, now), refinanced_loans(records), cash_disbursed(records)
                application["financials"] = with_loans(application["financials"], loans, closed=closed, cash_total=cash)
                simulator["bank_financials"] = with_loans(simulator["bank_financials"], loans, closed=closed, cash_total=cash)
                simulator["known_loans"] = deepcopy(application["financials"]["existing_loans"])
                details = application.get("product_details") or {}
                if details.get("overdraft"):
                    details["overdraft"] = include_scheduled_payments(details["overdraft"], application["financials"]["existing_loans"], closed=closed)
            self._normalize_product_need(application)
            self.store.save(connection, record)
        return self.public(record)

    @staticmethod
    def _validate_fields(value, allowed, section):
        if not isinstance(value, dict) or set(value) - allowed:
            raise ProcessError("unsupported_fields", f"Недопустимые поля раздела {section}.", 422)

    @staticmethod
    def _version(record, version):
        if record["application"]["application_version"] != version:
            raise ProcessError("version_conflict", "Заявка уже изменена. Загрузите актуальную версию.")

    def change(self, application_id, version, operation):
        self.sync_portfolio()
        with self.store.connect(write=True) as connection:
            record = self.store.get(connection, application_id)
            if record is None:
                raise ProcessError("application_not_found", "Заявка не найдена.", 404)
            self._version(record, version)
            operation(record, self.clock())
            self.store.save(connection, record)
            if record.get("completion"):
                self.sync_portfolio(connection)
        return self.public(record)

    def patch(self, application_id, version, changes):
        return self.change(application_id, version, lambda record, now: self.patch_record(record, changes, now))

    def patch_record(self, record, changes, now):
        if record["state"]["status"] not in EDITABLE_STATES:
            raise ProcessError("editing_not_allowed", "На текущем этапе изменение заявки недоступно.")
        if not changes:
            raise ProcessError("empty_changes", "Нет изменений для сохранения.", 422)
        known = deepcopy(bank_financials(record))
        # Используется и формой, и подтверждёнными предложениями ассистента.
        for path, value in changes.items():
            if path in ("need", "financials", "product_details"):
                allowed = NEED_FIELDS if path == "need" else FINANCIAL_FIELDS if path == "financials" else {"overdraft", "refinancing"}
                self._validate_fields(value, allowed, path)
                record["application"][path] = deepcopy(value)
                if path == "financials" and "portfolio_cash_total" in known:
                    record["application"][path]["portfolio_cash_total"] = known["portfolio_cash_total"]
            else:
                parts = path.split(".")
                allowed = NEED_FIELDS if parts[0] == "need" else FINANCIAL_FIELDS if parts[0] == "financials" else {"overdraft", "refinancing"} if parts[0] == "product_details" else set()
                if len(parts) != 2 or parts[1] not in allowed:
                    raise ProcessError("unsupported_field", f"Изменение поля {path} недоступно.", 422)
                record["application"].setdefault(parts[0], {})[parts[1]] = deepcopy(value)
        self._check_bank_financials(known, record["application"].get("financials"))
        self._normalize_product_need(record["application"])
        if record["application"]["need"].get("preferred_product") == "revolving_credit_line":
            record["application"]["need"].update(recurring=True, financing_pattern="gradual_repayment")
        details = record["application"].get("product_details") or {}
        if details.get("overdraft"):
            details["overdraft"] = include_scheduled_payments(details["overdraft"], record["application"]["financials"].get("existing_loans", []))
        record["field_sources"] = {path: source for path, source in record.get("field_sources", {}).items()
                                   if source_value(record["application"], path) == source["value"]}
        record["simulator"].setdefault("bank_financials", known)
        record["application"]["application_version"] += 1
        record["application"]["confirmation"] = None
        record["state"].update(application_version=record["application"]["application_version"],
                                latest_assessment_id=None, selected_offer_id=None)
        record.update(checks=None, result=None, readiness=None, recommendation=None, fulfilled_conditions={})
        set_state(record, "draft", "data_collection", "complete_profile", "Подтвердите обновлённые сведения", now)
        event(record, "application_updated", now, fields=list(changes))

    @staticmethod
    def _normalize_product_need(application):
        need = application["need"]
        if need.get("preferred_product") == "investment_loan" or (need.get("purpose") == "investment" and not need.get("preferred_product")):
            need.update(purpose="investment", preferred_product="investment_loan", financing_pattern="gradual_repayment", minimum_acceptable_amount=None)
            project, _ = project_values(need)
            need["requested_amount"] = project["loan_amount"] if project else None
            application.setdefault("product_details", {}).pop("overdraft", None)
            return
        if need.get("preferred_product") != "refinancing" and need.get("purpose") != "refinancing":
            return
        need.update(purpose="refinancing", preferred_product="refinancing", financing_pattern="gradual_repayment",
                    minimum_acceptable_amount=None, own_funds=None)
        details = application.setdefault("product_details", {})
        selection = details.get("refinancing") or {}
        if not isinstance(selection, dict) or set(selection) - {"loan_ids"}:
            raise ProcessError("invalid_refinancing_selection", "Для рефинансирования передайте только идентификаторы кредитов.", 422)
        ids = selection.get("loan_ids", [])
        if not isinstance(ids, list) or len(ids) > 20 or any(not isinstance(item, str) for item in ids) or len(ids) != len(set(ids)):
            raise ProcessError("invalid_refinancing_selection", "Выберите разные кредиты из банковского профиля.", 422)
        loans = application["financials"].get("existing_loans", [])
        selected = [loan for loan in loans if loan["loan_id"] in ids]
        if len(selected) != len(ids):
            raise ProcessError("refinancing_loan_unavailable", "Выбранный кредит уже закрыт или отсутствует в банковском профиле.", 422)
        if any(not isinstance(loan.get("outstanding_principal"), str) or not MONEY_PATTERN.fullmatch(loan["outstanding_principal"]) or Decimal(loan["outstanding_principal"]) <= 0 for loan in selected):
            raise ProcessError("refinancing_balance_missing", "Банк должен уточнить остаток долга.", 422)
        need["requested_amount"] = f'{sum((Decimal(loan["outstanding_principal"]) for loan in selected), Decimal("0.00")):.2f}' if selected else None
        details.pop("overdraft", None)

    @staticmethod
    def _check_bank_financials(known, proposed):
        if not preserves_bank_values(known, proposed):
            raise ProcessError("bank_data_read_only",
                               "Сведения, полученные из банка, нельзя заменить данными анкеты. Дополните только отсутствующие показатели.", 422)

    def recommend(self, application_id, version):
        def select_mechanism(record, now):
            if record["state"]["status"] not in EDITABLE_STATES:
                raise ProcessError("recommendation_not_allowed", "Для новой потребности создайте новую заявку.")
            previous = record.get("recommendation") or {}
            checks = demo.simulate_checks(record["application"], record["simulator"], now,
                                          retry=previous.get("status") in ("check_retry_pending", "needs_checks"))
            if record["application"]["need"].get("preferred_product") == "investment_loan":
                from credit_engine.investment import investment_options
                result = investment_options(record["application"], checks, calculated_at=now)
                record["recommendation"] = {**result, "recommended_product_id": "investment_loan" if result["options"] else None, "candidates": []}
                return
            if record["application"]["need"].get("preferred_product") == "revolving_credit_line":
                from credit_engine.revolving import revolving_options
                result = revolving_options(record["application"], checks, calculated_at=now)
                record["recommendation"] = {**result, "recommended_product_id": "revolving_credit_line" if result["options"] else None, "candidates": []}
                return
            if record["application"]["need"].get("purpose") == "refinancing":
                from credit_engine.refinancing import refinancing_options
                result = refinancing_options(record["application"], checks, calculated_at=now)
                record["recommendation"] = {**result, "recommended_product_id": "refinancing" if result["options"] else None, "candidates": []}
                return
            record["recommendation"] = recommend_financing(record["application"], checks, calculated_at=now).to_dict()
            event(record, "recommendations_calculated", now, status=record["recommendation"]["status"],
                  recommended_product_id=record["recommendation"]["recommended_product_id"])
        return self.change(application_id, version, select_mechanism)

    @staticmethod
    def _calculator(record):
        need = record["application"]["need"]
        product = need.get("preferred_product")
        pattern = need.get("financing_pattern")
        if pattern is not None and pattern not in ("cash_gap", "gradual_repayment"):
            raise ProcessError("invalid_financing_pattern", "Укажите временный разрыв, постепенный возврат или null.", 422)
        if product == "overdraft" and pattern == "gradual_repayment":
            raise ProcessError("product_pattern_conflict", "Для постепенного возврата по графику выберите разовый кредит или уточните задачу.", 422)
        if product not in demo.SUPPORTED_PRODUCTS:
            raise ProcessError("product_required", "Выберите кредитный продукт.", 422)
        return assess_investment if product == "investment_loan" else assess_revolving if product == "revolving_credit_line" else assess_refinancing if product == "refinancing" else assess_overdraft if product == "overdraft" else assess_application

    def _assess(self, record, now, *, stage, retry=False):
        calculator = self._calculator(record)
        record["checks"] = demo.simulate_checks(record["application"], record["simulator"], now, retry=retry)
        if stage == "final":
            set_state(record, "under_review", "external_checks", "wait", "Выполняются проверки", now)
            event(record, "review_started", now, retry=retry)
        result = calculator(record["application"], record["checks"], calculated_at=now, stage=stage).to_dict()
        record.update(result=result, readiness=None)
        assessment = result["assessment"]
        record["state"].update(latest_assessment_id=assessment["assessment_id"] if assessment else None, selected_offer_id=None)
        if stage == "preliminary":
            set_state(record, "draft", "product_selection", "confirm_submission" if assessment and assessment["offers"] else "complete_profile",
                      "Проверьте и отправьте заявку" if assessment and assessment["offers"] else "Дополните сведения", now)
        elif result["status"] in ("needs_checks", "check_retry_pending"):
            set_state(record, "check_retry_pending", "external_checks", "wait", "Ожидается повтор внешней проверки", now)
        elif result["status"] == "invalid_data" or assessment["outcome"] == "needs_information":
            set_state(record, "waiting_for_data", "data_validation", "provide_information", "Дополните сведения по замечаниям", now)
        elif assessment["offers"]:
            set_state(record, "offers_ready", "offer_selection", "select_offer", "Выберите итоговое предложение", now)
        else:
            set_state(record, assessment["outcome"], "completion", "none", "Рассмотрение завершено", now)
        event(record, "assessment_completed", now, stage=stage, status=result["status"],
              outcome=assessment["outcome"] if assessment else None)

    def preview(self, application_id, version):
        def calculate(record, now):
            if record["state"]["status"] != "draft":
                raise ProcessError("preview_not_allowed", "Предварительный расчёт доступен для черновика.")
            self._assess(record, now, stage="preliminary")
        return self.change(application_id, version, calculate)

    def submit(self, application_id, version):
        def send(record, now):
            if record["state"]["status"] != "draft":
                raise ProcessError("submission_not_allowed", "Отправить можно только черновик заявки.")
            self._calculator(record)
            record["application"]["confirmation"] = {"application_version": version, "confirmed_at": now.isoformat()}
            record["submitted_versions"].append({"application": deepcopy(record["application"]), "submitted_at": now.isoformat()})
            set_state(record, "submitted", "data_validation", "wait", "Заявка отправлена", now)
            event(record, "application_submitted", now)
            self._assess(record, now, stage="final")
        return self.change(application_id, version, send)

    def retry(self, application_id, version):
        def retry_checks(record, now):
            if record["state"]["status"] not in ("check_retry_pending", "offer_expired"):
                raise ProcessError("retry_not_allowed", "Для заявки не требуется повторная проверка.")
            self._assess(record, now, stage="final", retry=True)
        return self.change(application_id, version, retry_checks)

    @staticmethod
    def _readiness(record, now):
        assessment = record["result"]["assessment"] if record["result"] else None
        selected = record["state"]["selected_offer_id"]
        codes = list(record["fulfilled_conditions"].get(selected, {}))
        readiness = check_offer_readiness(record["application"], assessment, record["state"],
                                         checked_at=now, fulfilled_condition_codes=codes).to_dict()
        record["readiness"] = readiness
        status = readiness["status"]
        if status in ("ready_to_sign", "conditions_pending", "offer_expired"):
            set_state(record, status, "signing" if status == "ready_to_sign" else "conditions_check",
                      readiness["next_action"]["type"], readiness["next_action"]["label"], now)
        return readiness

    def select(self, application_id, version, assessment_id, offer_id):
        def select_offer(record, now):
            if record["state"]["status"] not in ("offers_ready", "conditions_pending", "ready_to_sign"):
                raise ProcessError("selection_not_allowed", "Выбор предложения сейчас недоступен.")
            if record["state"]["latest_assessment_id"] != assessment_id:
                raise ProcessError("assessment_conflict", "Результат рассмотрения уже обновлён.")
            assessment = record["result"]["assessment"]
            if offer_id not in {offer["offer_id"] for offer in assessment["offers"]}:
                raise ProcessError("offer_not_found", "Предложение не найдено в последней оценке.", 422)
            record["state"]["selected_offer_id"] = offer_id
            self._readiness(record, now)
            event(record, "offer_selected", now, offer_id=offer_id)
        return self.change(application_id, version, select_offer)

    @staticmethod
    def _selected(record, offer_id):
        if record["state"]["selected_offer_id"] != offer_id:
            raise ProcessError("offer_conflict", "Выбранное предложение уже изменено.")

    def fulfill(self, application_id, version, offer_id, code):
        def complete_condition(record, now):
            self._selected(record, offer_id)
            readiness = self._readiness(record, now)
            if readiness["status"] not in ("conditions_pending", "ready_to_sign"):
                return
            offer = next(offer for offer in record["result"]["assessment"]["offers"] if offer["offer_id"] == offer_id)
            if code != "guarantee_required" or code not in {condition["code"] for condition in offer["conditions"]}:
                raise ProcessError("condition_not_found", "Условие не найдено или не поддерживается симулятором.", 422)
            completed = record["fulfilled_conditions"].setdefault(offer_id, {})
            if code not in completed:
                completed[code] = {"completed_at": now.isoformat(), "mode": "simulated"}
                event(record, "condition_completed", now, offer_id=offer_id, code=code, mode="simulated")
            self._readiness(record, now)
        return self.change(application_id, version, complete_condition)

    def sign(self, application_id, version, offer_id):
        def sign_and_complete(record, now):
            self._selected(record, offer_id)
            if record["completion"] is not None:
                return
            readiness = self._readiness(record, now)
            if readiness["status"] != "ready_to_sign":
                return
            offer = next(offer for offer in record["result"]["assessment"]["offers"] if offer["offer_id"] == offer_id)
            repaid = []
            if offer["product_id"] == "refinancing":
                from credit_engine.refinancing import selected_debts
                try:
                    comparison = selected_debts(record["application"], now)
                except ValueError as exc:
                    raise ProcessError("refinancing_changed", str(exc)) from None
                if any(
                    comparison[key] != offer.get("refinancing", {}).get(key) for key in ("loan_ids", "payoff_amount", "current_total_repayment")):
                    raise ProcessError("refinancing_changed", "Долги изменились. Пересчитайте рефинансирование.")
                if comparison["payoff_amount"] != offer["amount"]:
                    raise ProcessError("refinancing_changed", "Сумма не покрывает выбранные кредиты.")
                repaid = [{"loan_id": loan["loan_id"], "outstanding_principal": loan["outstanding_principal"]} for loan in comparison["loans"]]
            record["signature"] = {"signature_id": str(uuid4()), "offer_id": offer_id, "signed_at": now.isoformat(), "mode": "simulated"}
            set_state(record, "signed", "signing", "wait", "Договор подписан", now)
            event(record, "contract_signed", now, offer_id=offer_id, mode="simulated")
            overdraft = offer["product_id"] == "overdraft"
            revolving = offer["product_id"] == "revolving_credit_line"
            record["completion"] = {"operation_id": str(uuid4()), "offer_id": offer_id, "amount": offer["amount"],
                                    "product_id": offer["product_id"], "completed_at": now.isoformat(), "mode": "simulated",
                                    "type": "limit_opening" if overdraft or revolving else "disbursement"}
            if revolving:
                from credit_engine.revolving import local_date, add_months
                opened = local_date(now)
                record["completion"]["credit_line"] = {"limit": offer["amount"], "annual_rate_percent": offer["annual_rate_percent"],
                    "opened_at": opened.isoformat(), "maturity_date": add_months(opened, offer["term_months"]).isoformat(),
                    "term_months": offer["term_months"], "capacity_reserve": offer["revolving"]["capacity_reserve"],
                    "version": 1, "operations": [], "closed_at": None}
            if repaid:
                record["completion"].update(repaid_loans=repaid, cash_to_client="0.00", settlement_type="direct_loan_repayment")
                event(record, "loans_refinanced", now, loan_ids=[loan["loan_id"] for loan in repaid], mode="simulated")
            if not overdraft and not revolving:
                from credit_engine.cashflow import payment_calendar
                from .overdraft_chat import local_now
                schedule = calculate_loan(offer["amount"], offer["term_months"], offer["annual_rate_percent"], principal_grace_months=offer.get("investment", {}).get("principal_grace_months", 0)).to_dict()["calculation"]["schedule"]
                record["completion"]["schedule"] = payment_calendar(schedule, local_now(now).date())
            set_state(record, "limit_opened" if overdraft or revolving else "disbursed", "completion", "none",
                      "Кредитная линия открыта" if revolving else "Рефинансирование завершено" if repaid else "Лимит открыт" if overdraft else "Кредит выдан", now)
            event(record, "limit_opened" if overdraft or revolving else "credit_disbursed", now, operation_id=record["completion"]["operation_id"], mode="simulated")
        return self.change(application_id, version, sign_and_complete)

    def cancel(self, application_id, version):
        def cancel_application(record, now):
            if record["signature"] is not None or record["state"]["status"] == "cancelled":
                raise ProcessError("cancellation_not_allowed", "Заявку уже нельзя отменить.")
            set_state(record, "cancelled", "completion", "none", "Заявка отменена", now)
            event(record, "application_cancelled", now)
        return self.change(application_id, version, cancel_application)
