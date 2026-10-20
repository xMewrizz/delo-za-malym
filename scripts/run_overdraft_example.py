"""Запуск примера дневного расчёта овердрафта."""

import argparse
import json
from pathlib import Path
import sys

from credit_engine import calculate_overdraft


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Вывести полный результат с дневной таблицей")
    args = parser.parse_args()
    path = Path(__file__).resolve().parents[1] / "contracts/overdraft/example.json"
    example = json.loads(path.read_text(encoding="utf-8"))
    result = calculate_overdraft(**example["input"]).to_dict()
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    else:
        calculation = result["calculation"]
        print(f"Статус расчёта: {result['status']}")
        if calculation is not None:
            print(f"Заданный лимит: {calculation['limit']} ₽")
            print(f"Требуемый лимит по плану: {calculation['required_limit']} ₽")
            print(f"Проценты: {calculation['total_interest']} ₽")
            print(f"Всего к возврату по сценарию: {calculation['total_repayment']} ₽")
            print(f"Сценарий выполним: {'да' if calculation['feasible'] else 'нет'}")
    if result != example["expected"]:
        print("Результат отличается от сохранённого примера.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
