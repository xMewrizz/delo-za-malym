# Документация

## Для продуктовой проверки

- [Обзор решения: выводы анализа, ключевые механики и ограничения](PRODUCT.md).
- [Требования сдачи и где их проверить](SUBMISSION.md).
- [Руководство по всем разделам кабинета](../frontend/public/project-docs/guide.md) — также доступно в приложении на `/documentation`.

## Запуск и проверка

- [Развёртывание из клона, Dahl, режим без ИИ и свой API](CLONE_AND_RUN.md).
- [Локальная Gemma и переключение режимов](LLM_MODES.md).
- [Развёртывание на VPS](technical/DEPLOYMENT.md).
- [Тестовые сценарии](technical/SCENARIOS.md), [тесты](../tests), [Postman](../contracts/credit_process.postman_collection.json).

## Как устроено решение

- [Архитектура, диаграмма состояний и модель данных](technical/ARCHITECTURE.md).
- [API](technical/BACKEND.md), [OpenAPI](technical/openapi.json), [контракты данных](technical/CONTRACTS.md).
- [Финансовые показатели](technical/FINANCIAL_METRICS.md), [скоринг](technical/SCORING.md), [решение](technical/ASSESSMENT.md).
- [Оборотный кредит](technical/FIRST_PRODUCT.md), [овердрафт](technical/OVERDRAFT.md), [линия](technical/REVOLVING_CREDIT_LINE.md), [рефинансирование](technical/REFINANCING.md), [инвестиционный кредит](technical/INVESTMENT_LOAN.md).
- [LLM-ассистент](technical/LLM_AGENT.md), [диалог и API](technical/CHAT.md).
- [Сторонние компоненты, модели и симуляторы](../THIRD_PARTY_NOTICES.md).

## Подтверждения и история

- [Сдаваемый снимок: сборка, проверки и наполнение](../reports/submission-readiness-2026-10-25/README.md).
- [Чистый клон и API Dahl](../reports/clone-readiness-2026-10-25/README.md).
- [Надёжность Лумы](../reports/luma-reliability-2026-10-25/README.md).
- [Визуальная проверка подписания](../reports/signing-ui-2026-10-25/README.md).
- [Материалы экспериментов и предыдущих проверок](../reports). Отчёты отражают состояние на указанную в них дату, включая исправленные позднее ошибки.
- [Команда](TEAM.md).

## Запуск тестов

Из корня репозитория, с установленными uv и Node.js 24+:

```shell
uv sync --frozen
uv run --frozen python -m unittest discover -s tests
npm --prefix frontend ci
npm --prefix frontend run check
uv run --frozen python -m scripts.run_frontend_checks
```

Последняя команда создаёт отдельную временную базу для каждого набора UI/API-тестов.
Не направляйте эти тесты на демонстрационный кабинет: сценарии создают и подписывают
синтетические заявки. Для пользовательского просмотра используйте шаги из корневого README.
