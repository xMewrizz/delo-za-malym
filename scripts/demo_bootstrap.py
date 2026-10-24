"""Seed only a fresh, dedicated demo volume; preserve an existing cabinet."""
import json
import os
from datetime import date
from pathlib import Path

from backend.store import Store
from scripts.prepare_demo_cabinet import Showcase


def prepare(database: Path, manifest: Path, today: date):
    if database.exists():
        if not manifest.is_file():
            raise RuntimeError("Demo database exists without its manifest. Use a NEW demo project name; no data was replaced.")
        value = json.loads(manifest.read_text(encoding="utf-8"))
        ids = {record["application"]["application_id"] for record in Store(database).list()}
        if value.get("schema_version") != 1 or not set(value["applications"].values()) <= ids:
            raise RuntimeError("Demo database and manifest do not match. No data was replaced.")
        return value
    database.parent.mkdir(parents=True, exist_ok=True)
    value = Showcase(database, today).build()
    manifest.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    return value


def main():
    value = prepare(Path(os.environ["DATABASE_PATH"]), Path(os.environ["DEMO_MANIFEST_PATH"]),
                    date.fromisoformat(os.getenv("DEMO_DATE", date.today().isoformat())))
    print(json.dumps(value["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
