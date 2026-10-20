"""Проверка работающего HTTP API на сценариях двух продуктов."""

import argparse
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .run_credit_scenarios import load_scenarios


def run(base_url: str, product: str, case: dict) -> str:
    def request(path, payload=None):
        body = json.dumps(payload).encode() if payload is not None else None
        with urlopen(Request(base_url.rstrip("/") + path, data=body, headers={"Content-Type": "application/json"}), timeout=30) as response:
            return json.load(response)

    record = request(f"/api/demo/scenarios/{product}/{case['scenario_id']}", {})
    application_id = record["application"]["application_id"]
    def action(name, **fields):
        return request(f"/api/applications/{application_id}/{name}", {"base_application_version": record["application"]["application_version"], **fields})
    record = action("submit", confirmed=True)
    expected = case["expected"]
    if record["result"]["status"] != expected["status"]:
        raise ValueError(f"Ожидалось {expected['status']}, получено {record['result']['status']}")
    assessment = record["result"]["assessment"]
    if expected["assessment"] is not None and (assessment is None or assessment["outcome"] != expected["assessment"]["outcome"]):
        raise ValueError("Кредитный результат отличается от ожидаемого")
    if record["state"]["status"] == "check_retry_pending":
        record = action("retry")
        if record["state"]["status"] != "offers_ready":
            raise ValueError("Повтор проверки не восстановил рассмотрение")
    assessment = record["result"]["assessment"]
    if assessment and assessment["offers"]:
        offer_id = assessment["offers"][0]["offer_id"]
        record = action("select-offer", assessment_id=assessment["assessment_id"], offer_id=offer_id)
        if record["state"]["status"] == "conditions_pending":
            record = action("conditions/guarantee_required/complete", offer_id=offer_id, confirmed=True)
        record = action("sign", offer_id=offer_id, confirmed=True)
        final = "limit_opened" if product == "overdraft" else "disbursed"
        if record["state"]["status"] != final or record["completion"] is None:
            raise ValueError("Оформление не завершено")
    restored = request(f"/api/applications/{application_id}")
    if restored != record:
        raise ValueError("Сохранённая заявка отличается от результата операции")
    return record["state"]["status"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args(argv)
    failures = 0
    for product in ("working_capital_loan", "overdraft"):
        for case in load_scenarios(product=product):
            try:
                status = run(args.base_url, product, case)
                print(f"OK {case['scenario_id']}: {status}")
            except (HTTPError, URLError, ValueError, KeyError) as exc:
                failures += 1
                print(f"FAIL {case['scenario_id']}: {exc}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
