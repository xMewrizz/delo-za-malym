"""Restore the committed showcase snapshot into an empty demo volume only."""
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile


def restore(database: Path, manifest: Path, source: Path):
    if database.exists() or manifest.exists():
        raise RuntimeError("Snapshot restore requires a fresh database and manifest; existing data was preserved.")
    metadata = json.loads((source / "hackathon-snapshot.json").read_text(encoding="utf-8"))
    raw = gzip.decompress((source / "hackathon-cabinet.sqlite3.gz").read_bytes())
    if (metadata.get("schema_version") != 1 or len(raw) != metadata["size_bytes"]
            or hashlib.sha256(raw).hexdigest() != metadata["sha256"]):
        raise ValueError("Demo snapshot integrity check failed.")
    manifest_bytes = (source / "hackathon-manifest.json").read_bytes()
    value = json.loads(manifest_bytes)
    database.parent.mkdir(parents=True, exist_ok=True)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=database.parent, suffix=".sqlite3", delete=False) as output:
        temporary = Path(output.name)
        output.write(raw)
    try:
        connection = sqlite3.connect(temporary)
        try:
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Invalid demo snapshot database.")
            ids = {row[0] for row in connection.execute("SELECT application_id FROM applications")}
            if not set(value["applications"].values()) <= ids:
                raise ValueError("Demo snapshot does not match its manifest.")
        finally:
            connection.close()
        temporary.replace(database)
        manifest.write_bytes(manifest_bytes)
    finally:
        temporary.unlink(missing_ok=True)
    return value
