"""Сохранение заявки и атомарные изменения её состояния в SQLite."""

from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3


class Store:
    def __init__(self, path: str | Path):
        self.path = str(path)

    def initialize(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("""CREATE TABLE IF NOT EXISTS applications (
                application_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )""")
            connection.execute("""CREATE TABLE IF NOT EXISTS chats (
                chat_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            )""")
            connection.execute("""CREATE TABLE IF NOT EXISTS documents (
                document_id TEXT PRIMARY KEY,
                application_id TEXT NOT NULL,
                content BLOB NOT NULL
            )""")
            connection.execute("PRAGMA user_version=3")
            connection.execute("""CREATE TABLE IF NOT EXISTS account_payments (
                request_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            )""")

    @contextmanager
    def connect(self, *, write=False):
        connection = sqlite3.connect(self.path, timeout=15)
        try:
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def get(connection, application_id):
        row = connection.execute("SELECT payload FROM applications WHERE application_id = ?", (application_id,)).fetchone()
        return json.loads(row[0]) if row else None

    @staticmethod
    def save(connection, record):
        connection.execute(
            """INSERT INTO applications(application_id, payload, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(application_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at""",
            (record["application"]["application_id"], json.dumps(record, ensure_ascii=False, allow_nan=False),
             record["state"]["updated_at"]),
        )

    @staticmethod
    def records(connection):
        return [json.loads(row[0]) for row in connection.execute("SELECT payload FROM applications ORDER BY updated_at DESC, application_id")]

    def list(self):
        with self.connect() as connection:
            return self.records(connection)

    @staticmethod
    def account_payments(connection):
        return [json.loads(row[0]) for row in connection.execute("SELECT payload FROM account_payments ORDER BY rowid")]

    def payments(self):
        with self.connect() as connection:
            return self.account_payments(connection)

    @staticmethod
    def get_chat(connection, chat_id):
        row = connection.execute("SELECT payload FROM chats WHERE chat_id = ?", (chat_id,)).fetchone()
        return json.loads(row[0]) if row else None

    @staticmethod
    def save_chat(connection, chat):
        connection.execute(
            "INSERT INTO chats(chat_id, payload) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET payload=excluded.payload",
            (chat["chat_id"], json.dumps(chat, ensure_ascii=False, allow_nan=False)),
        )

    @staticmethod
    def delete_draft(connection, application_id):
        # Called only after the process validates the current version and draft status.
        connection.execute("DELETE FROM documents WHERE application_id = ?", (application_id,))
        connection.execute("DELETE FROM chats WHERE json_extract(payload, '$.application_id') = ?", (application_id,))
        connection.execute("DELETE FROM applications WHERE application_id = ?", (application_id,))
