from datetime import date
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts.demo_bootstrap import prepare
from scripts.restore_demo_snapshot import restore
from scripts import start_hackathon

SOURCE = Path(__file__).resolve().parent.parent / "contracts" / "demo"


class HackathonLaunchTests(unittest.TestCase):
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
