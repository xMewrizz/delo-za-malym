"""Rebuild the curated delivery fixture without touching any running cabinet."""
import argparse
from contextlib import closing
from datetime import date
import gzip
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory

from scripts.prepare_demo_cabinet import Showcase

ROOT = Path(__file__).resolve().parent.parent


def build(destination: Path, today: date):
    previous = os.environ.get("DEMO_BUSINESS_SCALE")
    os.environ["DEMO_BUSINESS_SCALE"] = "6"
    try:
        with TemporaryDirectory() as directory:
            database = Path(directory) / "cabinet.sqlite3"
            manifest = Showcase(database, today, rich=True).build()
            # SQLite backup includes committed WAL contents in one portable file.
            backup = Path(directory) / "snapshot.sqlite3"
            with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
                source.backup(target)
                counts = {table: target.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                          for table in ("applications", "chats", "documents", "account_payments")}
                assert target.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            raw = backup.read_bytes()
        metadata = {"schema_version": 1, "captured_on": today.isoformat(),
                    "source": "curated synthetic business history through normal application services",
                    "generation_command": f"python -m scripts.build_submission_snapshot --date {today.isoformat()}",
                    "sha256": hashlib.sha256(raw).hexdigest(), "size_bytes": len(raw), "counts": counts}
        destination.mkdir(parents=True, exist_ok=True)
        (destination / "hackathon-cabinet.sqlite3.gz").write_bytes(gzip.compress(raw, mtime=0))
        (destination / "hackathon-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (destination / "hackathon-snapshot.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return manifest["summary"]
    finally:
        if previous is None:
            os.environ.pop("DEMO_BUSINESS_SCALE", None)
        else:
            os.environ["DEMO_BUSINESS_SCALE"] = previous


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", type=date.fromisoformat, default=date.today())
    parser.add_argument("--output", type=Path, default=ROOT / "contracts" / "demo")
    args = parser.parse_args()
    print(json.dumps(build(args.output, args.date), ensure_ascii=False))
