"""Refresh bank history in unsubmitted demo drafts, preserving signed/reviewed snapshots."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
from uuid import uuid4

from backend import demo
from backend.portfolio import belongs_to_client
from backend.service import CreditProcess, event
from backend.store import Store


def refresh(process):
    profile, simulator = demo.profile(process.clock())
    scale = simulator["demo_business_scale"]
    updated = 0
    with process.store.connect(write=True) as connection:
        for record in process.store.records(connection):
            if not belongs_to_client(record) or record["state"]["status"] != "draft":
                continue
            source = record["simulator"]
            if source.get("cash_flow_policy") != "seasonal-v2" or source.get("demo_business_scale", 1) == scale:
                continue
            known = source.get("bank_financials", {})
            if known.get("monthly") != record["application"]["financials"].get("monthly"):
                continue
            known["monthly"] = deepcopy(profile["financials"]["monthly"])
            source["demo_business_scale"] = scale
            need = deepcopy(record["application"]["need"])
            process.patch_record(record, {"financials.monthly": known["monthly"]}, process.clock())
            record["application"]["need"] = need
            event(record, "bank_profile_updated", process.clock(), demo_business_scale=scale)
            process.store.save(connection, record)
            updated += 1
    return {"updated_drafts": updated, "demo_business_scale": scale}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path(os.getenv("DATABASE_PATH", "data/cabinet.sqlite3")))
    args = parser.parse_args()
    if not args.database.is_file():
        parser.error("Existing demo database required")
    backup = args.database.with_name(f"{args.database.stem}.before-profile-{uuid4().hex[:10]}.sqlite3")
    with sqlite3.connect(args.database) as source, sqlite3.connect(backup) as destination:
        source.backup(destination)
    process = CreditProcess(Store(args.database), lambda: datetime.now(timezone.utc))
    print(json.dumps({**refresh(process), "backup": str(backup)}))


if __name__ == "__main__":
    main()
