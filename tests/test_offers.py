from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import unittest

from credit_engine import check_offer_readiness
from scripts.run_credit_scenarios import load_scenarios, run_scenario


def reviewed_case(scenario_id="01_approved", product="working_capital_loan", stage="final"):
    scenario = deepcopy(load_scenarios(scenario_id, product=product)[0])
    scenario["input"]["stage"] = stage
    assessment = run_scenario(scenario)["assessment"]
    application = scenario["input"]["application"]
    state = {
        "application_id": application["application_id"],
        "application_version": application["application_version"],
        "status": "offers_ready",
        "latest_assessment_id": assessment["assessment_id"],
        "selected_offer_id": assessment["offers"][0]["offer_id"] if assessment["offers"] else None,
    }
    return application, assessment, state


class OfferReadinessTests(unittest.TestCase):
    def setUp(self):
        self.application, self.assessment, self.state = reviewed_case()
        self.now = datetime.fromisoformat(self.assessment["calculated_at"]) + timedelta(minutes=1)

    def check(self, **kwargs):
        return check_offer_readiness(self.application, self.assessment, self.state,
                                     checked_at=kwargs.pop("checked_at", self.now), **kwargs)

    def test_both_products_can_proceed_after_real_assessment(self):
        for product, scenario in (("working_capital_loan", "01_approved"), ("overdraft", "01_overdraft_approved")):
            with self.subTest(product=product):
                application, assessment, state = reviewed_case(scenario, product)
                result = check_offer_readiness(application, assessment, state, checked_at=self.now)
                self.assertEqual(result.status, "ready_to_sign")
                self.assertEqual(result.next_action["type"], "sign")
                self.assertEqual(result.offer_id, assessment["offers"][0]["offer_id"])
                self.assertEqual(json.loads(json.dumps(result.to_dict())), result.to_dict())

    def test_alternative_amount_and_term_can_be_selected(self):
        for scenario in ("02_longer_term", "03_lower_amount"):
            with self.subTest(scenario=scenario):
                application, assessment, state = reviewed_case(scenario)
                for offer in assessment["offers"]:
                    state["selected_offer_id"] = offer["offer_id"]
                    self.assertEqual(check_offer_readiness(application, assessment, state, checked_at=self.now).status,
                                     "ready_to_sign")

    def test_guarantee_must_be_completed_for_both_products(self):
        for product, scenario in (("working_capital_loan", "05_guarantor_required"), ("overdraft", "05_overdraft_guarantor")):
            with self.subTest(product=product):
                application, assessment, state = reviewed_case(scenario, product)
                original = deepcopy((application, assessment, state))
                pending = check_offer_readiness(application, assessment, state, checked_at=self.now)
                self.assertEqual(pending.status, "conditions_pending")
                self.assertEqual(pending.pending_conditions[0]["code"], "guarantee_required")
                ready = check_offer_readiness(application, assessment, state, checked_at=self.now,
                                              fulfilled_condition_codes=["guarantee_required"])
                self.assertEqual(ready.status, "ready_to_sign")
                self.assertEqual((application, assessment, state), original)
                pending.pending_conditions[0]["fulfilled"] = True
                self.assertFalse(assessment["offers"][0]["conditions"][0]["fulfilled"])

    def test_one_completed_condition_does_not_complete_another(self):
        self.assessment["offers"][0]["conditions"] = [
            {"code": "guarantee_required", "message": "Оформить поручительство", "fulfilled": False},
            {"code": "document_required", "message": "Предоставить документ", "fulfilled": False},
        ]
        result = self.check(fulfilled_condition_codes=("guarantee_required",))
        self.assertEqual(result.status, "conditions_pending")
        self.assertEqual([condition["code"] for condition in result.pending_conditions], ["document_required"])

    def test_new_version_invalidates_previous_decision(self):
        self.application["application_version"] += 1
        self.application["confirmation"] = None
        self.assertEqual(self.check().status, "reassessment_required")
        self.state["application_version"] += 1
        self.assertEqual(self.check().issues[0].code, "assessment_binding_mismatch")

    def test_another_application_is_not_accepted(self):
        self.assessment["application_id"] = "another-application"
        self.assertEqual(self.check().status, "reassessment_required")

    def test_superseded_assessment_is_not_accepted_even_for_same_version(self):
        self.state["latest_assessment_id"] = "new-assessment"
        self.assertEqual(self.check().issues[0].code, "assessment_not_current")

    def test_preliminary_offer_cannot_be_signed(self):
        application, assessment, state = reviewed_case(stage="preliminary")
        result = check_offer_readiness(application, assessment, state, checked_at=self.now)
        self.assertEqual(result.status, "not_available")
        self.assertEqual(result.next_action["type"], "confirm_submission")

    def test_offer_expires_at_exact_deadline_in_any_timezone(self):
        deadline = datetime.fromisoformat(self.assessment["offers"][0]["valid_until"])
        self.assertEqual(self.check(checked_at=deadline - timedelta(microseconds=1)).status, "ready_to_sign")
        self.assertEqual(self.check(checked_at=deadline).status, "offer_expired")
        utc_deadline = deadline.astimezone(timezone.utc).isoformat()
        self.assertEqual(self.check(checked_at=utc_deadline).status, "offer_expired")
        self.assertEqual(self.check(checked_at=deadline.astimezone(timezone.utc) - timedelta(microseconds=1)).status,
                         "ready_to_sign")

    def test_no_selection_and_old_offer_require_selection(self):
        for selected in (None, "offer-from-previous-assessment"):
            with self.subTest(selected=selected):
                self.state["selected_offer_id"] = selected
                result = self.check()
                self.assertEqual(result.status, "not_available")
                self.assertEqual(result.next_action["type"], "select_offer")

    def test_offer_binding_is_checked_independently(self):
        self.assessment["offers"][0]["application_version"] = 2
        self.assertEqual(self.check().issues[0].code, "offer_binding_mismatch")

    def test_confirmation_must_precede_assessment(self):
        for confirmation in (None, {"application_version": 2, "confirmed_at": self.assessment["calculated_at"]},
                             {"application_version": 1, "confirmed_at": self.now.isoformat()}):
            with self.subTest(confirmation=confirmation):
                self.application["confirmation"] = confirmation
                self.assertEqual(self.check().issues[0].code, "confirmation_required")

    def test_signing_is_blocked_before_review_and_after_completion(self):
        for status in ("draft", "submitted", "under_review", "waiting_for_data", "check_retry_pending",
                       "signed", "disbursed", "limit_opened", "cancelled", "declined", "out_of_policy", "unknown"):
            with self.subTest(status=status):
                self.state["status"] = status
                self.assertEqual(self.check().status, "not_available")
        self.state["status"] = "offer_expired"
        self.assertEqual(self.check().status, "offer_expired")

    def test_available_state_alone_does_not_bypass_pending_conditions(self):
        self.application, self.assessment, self.state = reviewed_case("05_guarantor_required")
        self.state["status"] = "ready_to_sign"
        self.assertEqual(self.check().status, "conditions_pending")

    def test_no_assessment_and_nonpositive_outcomes_cannot_be_signed(self):
        self.assessment = None
        self.assertEqual(self.check().status, "not_available")
        for scenario in ("04_needs_information", "06_declined"):
            with self.subTest(scenario=scenario):
                self.application, self.assessment, self.state = reviewed_case(scenario)
                self.assertEqual(self.check().status, "not_available")

    def test_malformed_data_never_allows_signing(self):
        original = deepcopy((self.application, self.assessment, self.state))
        mutations = [
            lambda: self.application.update(application_version=True),
            lambda: self.assessment.update(application_version=True),
            lambda: self.assessment.update(calculated_at="2026-10-20T12:00:00"),
            lambda: self.assessment.update(calculated_at=(self.now + timedelta(hours=1)).isoformat()),
            lambda: self.assessment.update(offers=[]),
            lambda: self.assessment["offers"].append(deepcopy(self.assessment["offers"][0])),
            lambda: self.assessment["offers"][0].update(valid_until="invalid"),
            lambda: self.assessment["offers"][0].update(valid_until=self.assessment["calculated_at"]),
            lambda: self.assessment["offers"][0].update(conditions=None),
            lambda: self.assessment["offers"][0].update(conditions=[{"code": "guarantee_required", "message": "Поручительство", "fulfilled": "true"}]),
            lambda: self.state.update(selected_offer_id=[]),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index):
                self.application, self.assessment, self.state = deepcopy(original)
                mutate()
                self.assertNotEqual(self.check().status, "ready_to_sign")

    def test_unknown_or_malformed_completed_condition_is_rejected(self):
        for codes in ("guarantee_required", ["unknown"], [["nested"]], None, ["x", "x"]):
            with self.subTest(codes=codes):
                self.assertEqual(self.check(fulfilled_condition_codes=codes).status, "invalid_data")

    def test_invalid_time_and_missing_objects_are_reported(self):
        self.assertEqual(self.check(checked_at="2026-10-20T12:30:00").status, "invalid_data")
        for application, assessment, state in ((None, self.assessment, self.state),
                                               (self.application, self.assessment, None),
                                               (self.application, [], self.state)):
            self.assertEqual(check_offer_readiness(application, assessment, state, checked_at=self.now).status,
                             "invalid_data")


if __name__ == "__main__":
    unittest.main()
