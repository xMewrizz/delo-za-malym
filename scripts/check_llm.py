"""Проверка выбранного LLM API из того же окружения, что и кабинет."""

import argparse
import sys
from time import monotonic

from backend.assistant import ModelAssistant


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate", action="store_true", help="Дополнительно выполнить один синтетический запрос JSON; расходует квоту API")
    args = parser.parse_args()
    started = monotonic()
    try:
        model = ModelAssistant()
        model.client.check_ready()
        print("OK: configured model is available via /models")
        if args.generate:
            reply = model.reply([
                {"role": "system", "content": 'Верни JSON: {"text":"Готово","intent":"answer_question","changes":{},"question":null}. Без рассуждений и другого текста.'},
                {"role": "user", "content": "Проверка подключения на синтетических данных."},
            ])
            if reply.intent != "answer_question" or reply.changes:
                raise ValueError("Probe reply violated the expected action")
            print("OK: structured generation and backend validation passed")
        print(f"Elapsed: {monotonic()-started:.2f} s")
        return 0
    except (ValueError, RuntimeError, OSError) as exc:
        # Do not print exception text: it can contain credentials or provider output.
        print(f"FAILED: {type(exc).__name__}. Check model name, API URL, response format, key and quota.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
