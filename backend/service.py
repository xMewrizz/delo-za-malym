"""Процесс заявки: версии, рассмотрение, выбор, условия и моделируемая выдача."""

from copy import deepcopy
from uuid import uuid4

from credit_engine import assess_application, assess_overdraft, calculate_loan, check_offer_readiness, recommend_financing

from . import demo
from .client_data import bank_financials, client_data, preserves_bank_values
from .store import Store


class ProcessError(Exception):
    def __init__(self, code, message, status_code=409):
        self.code, self.message, self.status_code = code, message, status_code
        super().__init__(message)


NEED_FIELDS = {"purpose", "preferred_product", "requested_amount", "term_months", "needed_by", "recurring",
               "own_funds", "priority", "minimum_acceptable_amount", "financing_pattern"}
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

    @staticmethod
    def public(record):
        return deepcopy({key: record.get(key) for key in
                         ("application", "state", "checks", "result", "readiness", "recommendation", "signature", "completion", "events", "submitted_versions")} |
                        {key: record.get(key, []) for key in ("explorations", "imports")} |
                        {"client_data": client_data(record)})

    def get(self, application_id):
        with self.store.connect() as connection:
            record = self.store.get(connection, application_id)
        if record is None:
            raise ProcessError("application_not_found", "Заявка не найдена.", 404)
        return self.public(record)

    def list(self):
        return [{"application_id": record["application"]["application_id"], "need": record["application"]["need"],
                 "state": record["state"], "completion": record["completion"]} for record in self.store.list()]

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
        with self.store.connect(write=True) as connection:
            record = self.store.get(connection, application_id)
            if record is None:
                raise ProcessError("application_not_found", "Заявка не найдена.", 404)
            self._version(record, version)
            operation(record, self.clock())
            self.store.save(connection, record)
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
                allowed = NEED_FIELDS if path == "need" else FINANCIAL_FIELDS if path == "financials" else {"overdraft"}
                self._validate_fields(value, allowed, path)
                record["application"][path] = deepcopy(value)
            else:
                parts = path.split(".")
                allowed = NEED_FIELDS if parts[0] == "need" else FINANCIAL_FIELDS if parts[0] == "financials" else set()
                if len(parts) != 2 or parts[1] not in allowed:
                    raise ProcessError("unsupported_field", f"Изменение поля {path} недоступно.", 422)
                record["application"].setdefault(parts[0], {})[parts[1]] = deepcopy(value)
        self._check_bank_financials(known, record["application"].get("financials"))
        record["simulator"].setdefault("bank_financials", known)
        record["application"]["application_version"] += 1
        record["application"]["confirmation"] = None
        record["state"].update(application_version=record["application"]["application_version"],
                                latest_assessment_id=None, selected_offer_id=None)
        record.update(checks=None, result=None, readiness=None, recommendation=None, fulfilled_conditions={})
        set_state(record, "draft", "data_collection", "complete_profile", "Подтвердите обновлённые сведения", now)
        event(record, "application_updated", now, fields=list(changes))

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
        if product not in demo.PRODUCTS:
            raise ProcessError("product_required", "Выберите разовый кредит или овердрафт.", 422)
        return assess_overdraft if product == "overdraft" else assess_application

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
            record["signature"] = {"signature_id": str(uuid4()), "offer_id": offer_id, "signed_at": now.isoformat(), "mode": "simulated"}
            set_state(record, "signed", "signing", "wait", "Договор подписан", now)
            event(record, "contract_signed", now, offer_id=offer_id, mode="simulated")
            overdraft = offer["product_id"] == "overdraft"
            record["completion"] = {"operation_id": str(uuid4()), "offer_id": offer_id, "amount": offer["amount"],
                                    "product_id": offer["product_id"], "completed_at": now.isoformat(), "mode": "simulated",
                                    "type": "limit_opening" if overdraft else "disbursement"}
            if not overdraft:
                record["completion"]["schedule"] = calculate_loan(offer["amount"], offer["term_months"], offer["annual_rate_percent"]).to_dict()["calculation"]["schedule"]
            set_state(record, "limit_opened" if overdraft else "disbursed", "completion", "none",
                      "Лимит открыт" if overdraft else "Кредит выдан", now)
            event(record, "limit_opened" if overdraft else "credit_disbursed", now, operation_id=record["completion"]["operation_id"], mode="simulated")
        return self.change(application_id, version, sign_and_complete)

    def cancel(self, application_id, version):
        def cancel_application(record, now):
            if record["signature"] is not None or record["state"]["status"] == "cancelled":
                raise ProcessError("cancellation_not_allowed", "Заявку уже нельзя отменить.")
            set_state(record, "cancelled", "completion", "none", "Заявка отменена", now)
            event(record, "application_cancelled", now)
        return self.change(application_id, version, cancel_application)
