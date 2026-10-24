import hashlib
import io
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts import gemma_weights, start_demo


class LaunchModesTest(unittest.TestCase):
    @patch("scripts.start_demo.subprocess.run")
    @patch("scripts.gemma_weights.verify")
    def test_local_mode_verifies_weights_and_uses_no_api_env_file(self, verify, run):
        with patch("sys.argv", ["start_demo", "--provider", "local", "--gpu", "--no-build"]):
            start_demo.main()
        verify.assert_called_once()
        command = run.call_args.args[0]
        self.assertTrue(any(value.endswith("compose.gemma.yaml") for value in command))
        self.assertTrue(any(value.endswith("compose.gemma-gpu.yaml") for value in command))
        self.assertFalse(any(value.endswith("compose.api.yaml") for value in command))
        self.assertNotIn("build", command)

    @patch("scripts.start_demo.subprocess.run")
    def test_api_mode_requires_explicit_server_configuration_and_never_starts_model(self, run):
        with TemporaryDirectory() as directory:
            config = Path(directory) / "provider.env"
            config.write_text("LLM_API_KEY=test-only-secret\n", encoding="utf-8")
            with patch("sys.argv", ["start_demo", "--provider", "api", "--env-file", str(config), "--no-build"]):
                start_demo.main()
            command = run.call_args.args[0]
            self.assertTrue(any(value.endswith("compose.api.yaml") for value in command))
            self.assertFalse(any("gemma" in value or "ollama" in value for value in command))
            self.assertIn(str(config), command)
            self.assertNotIn("test-only-secret", " ".join(command))

    @patch("scripts.start_demo.subprocess.run")
    @patch("scripts.gemma_weights.verify", side_effect=ValueError("Invalid weights"))
    def test_invalid_local_weights_stop_before_any_docker_mutation(self, verify, run):
        with patch("sys.argv", ["start_demo", "--provider", "local"]), self.assertRaises(ValueError):
            start_demo.main()
        run.assert_not_called()


class WeightIntegrityTest(unittest.TestCase):
    def test_full_hash_and_size_are_both_checked(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "weights.gguf"
            path.write_bytes(b"abcdef")
            expected = hashlib.sha256(b"abcdef").hexdigest()
            self.assertEqual(gemma_weights.verify(path, expected, 6), expected)
            path.write_bytes(b"abcdeg")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                gemma_weights.verify(path, expected, 6)
            path.write_bytes(b"abc")
            with self.assertRaisesRegex(ValueError, "incomplete"):
                gemma_weights.verify(path, expected, 6)

    def test_ignored_range_restarts_partial_instead_of_corrupting_it(self):
        real_verify = gemma_weights.verify
        expected = hashlib.sha256(b"abcdef").hexdigest()
        response = io.BytesIO(b"abcdef")
        response.status = 200
        response.headers = {}
        with TemporaryDirectory() as directory:
            path = Path(directory) / "weights.gguf"
            path.with_suffix(".gguf.part").write_bytes(b"abc")
            with patch.object(gemma_weights, "SIZE", 6), patch.object(gemma_weights, "urlopen", return_value=response), patch.object(gemma_weights, "verify", side_effect=lambda value: real_verify(value, expected, 6)):
                gemma_weights.download(path)
            self.assertEqual(path.read_bytes(), b"abcdef")
            self.assertFalse(path.with_suffix(".gguf.part").exists())

    def test_bad_partial_is_not_published_as_model_weights(self):
        real_verify = gemma_weights.verify
        with TemporaryDirectory() as directory:
            path = Path(directory) / "weights.gguf"
            partial = path.with_suffix(".gguf.part")
            partial.write_bytes(b"wrong!")
            with patch.object(gemma_weights, "SIZE", 6), patch.object(gemma_weights, "verify", side_effect=lambda value: real_verify(value, hashlib.sha256(b"abcdef").hexdigest(), 6)), self.assertRaises(ValueError):
                gemma_weights.download(path)
            self.assertFalse(path.exists())
            self.assertTrue(partial.exists())


if __name__ == "__main__":
    unittest.main()
