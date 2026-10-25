from datetime import date, datetime
from decimal import Decimal
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts.demo_bootstrap import prepare
from scripts.restore_demo_snapshot import restore
from scripts import start_hackathon
from backend.service import CreditProcess
from backend.store import Store
from backend.loan_payments import LoanPayments
from backend.overdrafts import Overdrafts
from backend.credit_lines import CreditLines

SOURCE = Path(__file__).resolve().parent.parent / "contracts" / "demo"


class HackathonLaunchTests(unittest.TestCase):
    def test_delivery_snapshot_has_coherent_history_all_products_and_room_for_new_requests(self):
        with TemporaryDirectory() as directory, patch.dict("os.environ", {"DEMO_BUSINESS_SCALE": "6"}):
            db, manifest = Path(directory) / "cabinet.sqlite3", Path(directory) / "manifest.json"
            fixture = restore(db, manifest, SOURCE)
            process = CreditProcess(Store(db), lambda: datetime.fromisoformat(fixture["prepared_at"]))
            ids = fixture["applications"]
            profile = process.profile()["financials"]
            self.assertEqual(len(process.store.list()), 13)
            self.assertGreaterEqual(Decimal(profile["cash_balance"]), Decimal("1000000"))
            self.assertEqual({loan["product_id"] for loan in profile["existing_loans"]},
                {"working_capital_loan", "investment_loan", "refinancing", "overdraft", "revolving_credit_line"})
            self.assertEqual(LoanPayments(process).get(ids["repaid_loan"])["status"], "closed")
            self.assertTrue(process.get(ids["refinanced_original"])["completion"]["refinanced_by"])
            self.assertEqual(process.get(ids["ready_to_sign"])["state"]["status"], "ready_to_sign")
            self.assertEqual(process.get(ids["needs_contribution"])["state"]["status"], "waiting_for_data")
            self.assertEqual(process.get(ids["cancelled_project"])["state"]["status"], "cancelled")
            self.assertTrue(process.get(ids["offers_ready"])["result"]["assessment"]["offers"])
            self.assertEqual(len(process.store.payments()), 4)
            self.assertGreaterEqual(len(Overdrafts(process).get(ids["overdraft"])["operations"]), 3)
            self.assertGreaterEqual(len(CreditLines(process).get(ids["credit_line"])["operations"]), 2)
            calendar = process.calendar()
            self.assertGreater(len(calendar["events"]), 100)
            self.assertTrue(all(row["date"] >= fixture["prepared_at"][:10]
                for loan in profile["existing_loans"] for row in loan.get("schedule", [])))
            self.assertEqual({event["direction"] for event in calendar["settlement_account"]["events"]}, {"inflow", "outflow"})
            # The populated portfolio must still admit a new, ordinary request.
            request = process.create(need={"purpose": "working_capital", "preferred_product": "working_capital_loan",
                "requested_amount": "1000000.00", "minimum_acceptable_amount": "1000000.00", "term_months": 24})
            result = process.submit(request["application"]["application_id"], request["application"]["application_version"])
            self.assertTrue(result["result"]["assessment"]["offers"])

    @patch("scripts.start_hackathon.getpass")
    @patch("scripts.start_hackathon.subprocess.run")
    def test_without_ai_needs_no_key_config_or_model_and_overrides_inherited_model_mode(self, run, getpass):
        with TemporaryDirectory() as directory:
            missing = Path(directory) / "does-not-exist.env"
            with patch.dict("os.environ", {"DEMO_CHAT_MODE": "model", "LLM_API_KEY": "must-not-leak"}), patch("sys.argv", ["start_hackathon", "--without-ai", "--env-file", str(missing), "--no-build"]):
                start_hackathon.main()
            getpass.assert_not_called()
            self.assertFalse(missing.exists())
            command = run.call_args.args[0]
            self.assertFalse(any(value.endswith("compose.api.yaml") for value in command))
            self.assertFalse(any("gemma" in value or "ollama" in value for value in command))
            self.assertNotIn(str(missing), command)
            self.assertEqual(run.call_args.kwargs["env"]["DEMO_CHAT_MODE"], "demo")
            self.assertNotIn("LLM_API_KEY", run.call_args.kwargs["env"])

    def test_snapshot_preserves_all_records_and_restart_does_not_reset_user_changes(self):
        with TemporaryDirectory() as directory:
            db, manifest = Path(directory) / "cabinet.sqlite3", Path(directory) / "manifest.json"
            with patch.dict("os.environ", {"DEMO_SNAPSHOT_DIRECTORY": str(SOURCE)}):
                first = prepare(db, manifest, date(2026, 10, 25))
                connection = sqlite3.connect(db)
                try:
                    counts = json.loads((SOURCE / "hackathon-snapshot.json").read_text())["counts"]
                    for table, count in counts.items():
                        self.assertEqual(connection.execute("SELECT COUNT(*) FROM " + table).fetchone()[0], count)
                    connection.execute("CREATE TABLE user_restart_marker (value TEXT)")
                    connection.execute("INSERT INTO user_restart_marker VALUES ('preserved')")
                    connection.commit()
                    second = prepare(db, manifest, date(2026, 10, 26))
                    self.assertEqual(first, second)
                    self.assertEqual(connection.execute("SELECT value FROM user_restart_marker").fetchone()[0], "preserved")
                finally:
                    connection.close()
                with self.assertRaises(RuntimeError):
                    restore(db, manifest, SOURCE)

    def test_restart_after_seeded_draft_deletion_never_resurrects_it(self):
        with TemporaryDirectory() as directory:
            db, manifest = Path(directory) / "cabinet.sqlite3", Path(directory) / "manifest.json"
            first = restore(db, manifest, SOURCE)
            identifier = first["contexts"]["manual"]
            connection = sqlite3.connect(db)
            try:
                connection.execute("DELETE FROM applications WHERE application_id=?", (identifier,))
                connection.commit()
                second = prepare(db, manifest, date(2026, 10, 26))
                self.assertNotIn(identifier, second["contexts"].values())
                self.assertNotIn(identifier, second["applications"].values())
                self.assertIsNone(connection.execute("SELECT payload FROM applications WHERE application_id=?", (identifier,)).fetchone())
            finally:
                connection.close()

    @patch("scripts.start_hackathon.subprocess.run")
    def test_launch_uses_saved_data_api_only_and_never_exposes_key_in_arguments(self, run):
        with TemporaryDirectory() as directory:
            env = Path(directory) / "api.env"
            env.write_text("LLM_API_KEY=test-only-secret\n")
            with patch.dict("os.environ", {"LLM_API_KEY": "wrong-shell-key"}), patch("sys.argv", ["start_hackathon", "--env-file", str(env), "--port", "18009"]):
                start_hackathon.main()
            call = run.call_args
            command = call.args[0]
            self.assertTrue(any(value.endswith("compose.hackathon.yaml") for value in command))
            self.assertTrue(any(value.endswith("compose.api.yaml") for value in command))
            self.assertIn("--build", command)
            self.assertNotIn("LLM_API_KEY", call.kwargs["env"])
            self.assertEqual(call.kwargs["env"]["DEMO_PORT"], "18009")
            self.assertNotIn("test-only-secret", " ".join(command))
            self.assertFalse(any("gemma" in value or "ollama" in value for value in command))
