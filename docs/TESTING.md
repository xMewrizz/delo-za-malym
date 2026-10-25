# Тестирование

Нужны Python 3.13+, uv и Node.js 24+. Все команды выполняются из корня репозитория.

## Backend

```shell
uv sync --frozen
uv run --frozen python -m unittest discover -s tests
```

Тесты охватывают финансовые расчёты, продуктовые правила, состояния заявок, операции по счёту, диалог и обработку ошибок. Вместо внешней модели и банковских сервисов используются тестовые адаптеры.

## Frontend

```shell
npm --prefix frontend ci
npm --prefix frontend run check
npm --prefix frontend run build
```

`check` выполняет TypeScript-проверку, линтер и модульные тесты.

## Интеграция интерфейса и API

```shell
uv run --frozen python -m scripts.run_frontend_checks
```

Раннер запускает FastAPI с отдельной временной базой для каждого набора. Сценарии создают заявки, выбирают условия и выполняют демонстрационные операции. Не направляйте их на базу демонстрационного кабинета.

## Диалог с реальной моделью

Настройте `.env.api` по [инструкции подключения](CLONE_AND_RUN.md). Запуск расходует квоту провайдера:

```shell
uv run --frozen python -m scripts.run_dialogue_evaluation --env-file .env.api --cases contracts/evals/luma-regression-cases.json --trials 3 --workers 2 --output reports/luma-regression.json
```

Набор проверяет сбор и исправление параметров, уточнения, сравнение и запреты на изменение банковских данных. Каждое испытание использует временную базу. Результаты записываются локально в JSON и JSONL; ошибка даёт ненулевой код завершения.

Для проверки одного сценария добавьте `--case <id>`. Другие тестовые диалоги находятся в `contracts/dialogue_cases.json`.
