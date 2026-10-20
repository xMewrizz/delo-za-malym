"""Запуск сохранённых сценариев через настоящий модуль рассмотрения."""

import argparse
import difflib
import json
from pathlib import Path
import sys

from credit_engine import assess_application


SCENARIOS_DIR = Path(__file__).resolve().parents[1] / "contracts" / "scenarios"


def load_scenarios(scenario_id: str | None = None) -> list[dict]:
    scenarios = []
    for path in sorted(SCENARIOS_DIR.glob("*.json")):
        scenario = json.loads(path.read_text(encoding="utf-8"))
        if scenario["scenario_id"] != path.stem:
            raise ValueError(f"Идентификатор сценария не совпадает с именем файла: {path.name}")
        if scenario_id is None or scenario["scenario_id"] == scenario_id:
            scenarios.append(scenario)
    if not scenarios:
        raise ValueError(f"Сценарии не найдены: {scenario_id or SCENARIOS_DIR}")
    return scenarios


def run_scenario(scenario: dict) -> dict:
    inputs = scenario["input"]
    return assess_application(
        inputs["application"],
        inputs["checks"],
        calculated_at=inputs["calculated_at"],
        stage=inputs["stage"],
        assessment_id=inputs["assessment_id"],
    ).to_dict()


def json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", help="Идентификатор сценария, например 01_approved")
    parser.add_argument("--list", action="store_true", help="Показать список сценариев без расчёта")
    parser.add_argument("--json", action="store_true", help="Вывести рассчитанный ответ выбранного сценария")
    args = parser.parse_args(argv)
    if args.json and (args.scenario is None or args.list):
        parser.error("--json используется вместе с --scenario и без --list")
    try:
        scenarios = load_scenarios(args.scenario)
    except (OSError, ValueError, KeyError) as exc:
        print(f"Не удалось прочитать сценарии: {exc}", file=sys.stderr)
        return 1
    if args.list:
        for scenario in scenarios:
            print(f"{scenario['scenario_id']}: {scenario['title']}")
        return 0

    failures = 0
    for scenario in scenarios:
        actual = run_scenario(scenario)
        matches = actual == scenario["expected"]
        if not matches:
            failures += 1
            difference = difflib.unified_diff(
                json_text(scenario["expected"]).splitlines(),
                json_text(actual).splitlines(),
                fromfile=f"{scenario['scenario_id']}: expected",
                tofile=f"{scenario['scenario_id']}: actual",
                lineterm="",
            )
            print("\n".join(difference), file=sys.stderr)
        if args.json:
            print(json_text(actual), end="")
        else:
            assessment = actual["assessment"]
            outcome = assessment["outcome"] if assessment else "assessment отсутствует"
            print(f"{'OK' if matches else 'FAIL'} {scenario['scenario_id']}: {actual['status']} / {outcome}")
    return 1 if failures else 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
