from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient

from backend.assistant import DemoAssistant
from backend.main import create_app


class FrontendServingTests(unittest.TestCase):
    def test_production_routes_share_api_without_exposing_sources(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            frontend = root / "dist"
            (frontend / "assets").mkdir(parents=True)
            (frontend / "fonts").mkdir()
            (frontend / "images").mkdir()
            (frontend / "index.html").write_text('<div id="root"></div><script src="/assets/app.js"></script>', encoding="utf-8")
            (frontend / "assets" / "app.js").write_text("export const ready = true", encoding="utf-8")
            (root / ".env").write_text("SECRET=private", encoding="utf-8")
            app = create_app(root / "test.sqlite3", assistant=DemoAssistant(), frontend_directory=frontend)
            with TestClient(app) as client:
                for path in ("/", "/cabinet", "/cabinet/", "/cabinet/application/123"):
                    response = client.get(path)
                    self.assertEqual(response.status_code, 200, path)
                    self.assertIn('id="root"', response.text)
                    self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertIn("ready = true", client.get("/assets/app.js").text)
                self.assertEqual(client.get("/api/profile").status_code, 200)
                self.assertEqual(client.get("/api/not-a-route").status_code, 404)
                self.assertEqual(client.get("/assets/missing.js").status_code, 404)
                self.assertNotIn("private", client.get("/.env").text)
                self.assertNotIn('id="root"', client.get("/chat").text)
                self.assertEqual(client.get("/chat-assets/chat.js").status_code, 200)

    def test_source_checkout_keeps_laboratory_available_without_build(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            with TestClient(create_app(root / "test.sqlite3", assistant=DemoAssistant(), frontend_directory=root / "missing")) as client:
                self.assertIn("chat-assets", client.get("/cabinet").text)
                self.assertEqual(client.get("/health").json(), {"status": "ok"})
