# Сторонние компоненты

Версии Python-зависимостей закреплены в [uv.lock](uv.lock). Runtime-зависимости Docker с хешами — в [requirements.txt](requirements.txt). Лицензии ниже взяты из метаданных установленных пакетов.

| Компонент | Версия | Лицензия | Назначение |
|---|---|---|---|
| FastAPI | 0.156.2 | MIT | HTTP API и OpenAPI |
| Uvicorn | 0.54.0 | BSD-3-Clause | ASGI-сервер |
| Starlette | 1.9.0 | BSD-3-Clause | HTTP и тестовый клиент |
| Pydantic | 2.14.1 | MIT | Валидация запросов |
| pydantic-core | 2.50.1 | MIT | Валидация запросов |
| annotated-doc | 0.0.5 | MIT | Зависимость FastAPI |
| annotated-types | 0.8.0 | MIT | Зависимость Pydantic |
| AnyIO | 4.15.1 | MIT | Асинхронные операции |
| Click | 8.5.0 | BSD-3-Clause | Командная строка Uvicorn |
| h11 | 0.16.0 | MIT | HTTP-протокол |
| idna | 3.20 | BSD-3-Clause | Обработка имён хостов |
| opentelemetry-api | 1.45.1 | Apache-2.0 | Зависимость FastAPI |
| typing-extensions | 4.16.0 | PSF-2.0 | Аннотации типов |
| typing-inspection | 0.4.4 | MIT | Зависимость Pydantic |
| HTTPX2 / HTTPCore2 | 2.15.1 | BSD-3-Clause | HTTP-клиент для тестов |
| truststore | 0.10.5 | MIT | Зависимость тестового HTTP-клиента |

Для публичного стенда дополнительно используется Caddy (Apache-2.0), образ закреплён digest в `compose.stand.yaml`; локальный запуск не требует прокси.

Среда выполнения — Python 3.13+ и SQLite из стандартной библиотеки Python. Docker-образ основан на `python:3.13-slim`. Для управления зависимостями при разработке используется uv. Интерактивная страница `/docs` использует Swagger UI, подключаемый FastAPI.

## Модели и данные

Материалы экспериментов LLM используют `yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF`; имя файла, SHA-256 и источник проверки записаны в [источнике модели](scr/delo_za_malyn/Models/Llm/weights/source.json). Ревизия репозитория указывается только после подтверждения. Модель подключается отдельно от HTTP-процесса; условия распространения определяются её [карточкой](https://huggingface.co/yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF).

Данные компаний, финансовые показатели, заявки и планы операций в `contracts` — синтетические примеры проекта.

## Смоделированные интеграции

Регистрационная проверка, ограничения финансирования, кредитная история и сверка обязательств воспроизводятся локальным симулятором `backend/demo.py`. Поручительство, электронная подпись, выдача кредита и открытие лимита воспроизводятся в `backend/service.py`. У операций сохраняются идентификатор, время и признак `mode: simulated`.

Подключённый для проверки LLM-провайдер — **Dahl Inference**, OpenAI-совместимый API `https://inference.dahl.global/v1`. Модель — `MiniMaxAI/MiniMax-M2.7`; открытые веса и условия лицензии опубликованы в [официальном репозитории](https://huggingface.co/MiniMaxAI/MiniMax-M2.7), [лицензия](https://huggingface.co/MiniMaxAI/MiniMax-M2.7/blob/main/LICENSE). Используется бесплатный подарочный пул аккаунта по [условиям Dahl](https://inference.dahl.global/docs/tokens/); платный резервный маршрут в приложении не предусмотрен. URL, ключ и model ID задаются через `LLM_API_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` и заменяются без изменения кода. Веса модели не копируются в образ. Корневой `.env.example` остаётся нейтральным шаблоном, ключ хранится в игнорируемом `.env`.

Tavily — необязательный публичный поиск; без ключа отключён, кредитный процесс от него не зависит.
