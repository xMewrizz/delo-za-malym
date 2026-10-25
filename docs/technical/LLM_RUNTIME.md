# Клиент модели

Пакет `scr.delo_za_malyn` содержит клиент OpenAI-совместимого API и настройки модели. Основной кабинет использует его через `backend/assistant.py`.

## Состав

- `Models/Llm/client.py` — запросы, структурированные ответы и обработка ошибок.
- `Models/Llm/check.py` — проверка доступности API без генерации.
- `Models/Llm/run.py` — запуск установленного `llama-server` с локальным GGUF.
- `Models/Llm/weights/source.json` — источник, размер и SHA-256 весов Gemma Q4_K_M.
- `settings/settings.py` — параметры API, контекста и инструментов.

```python
from scr.delo_za_malyn.Models.Llm.client import LLMClient
from scr.delo_za_malyn.settings.settings import settings
```

Переменные окружения имеют приоритет над файлом настроек. Для кабинета используются `.env.api` или явно переданный `--env-file`. Лабораторный модуль может использовать `scr/delo_za_malyn/settings/.env`.

## Режимы подключения

- Внешний API: URL с `/v1`, точный ID модели и ключ задаются на backend.
- Локальная Gemma: GGUF загружается отдельно и импортируется в Ollama; в образ приложения веса не входят.
- Ручной режим без модели: `python -m scripts.start_hackathon --without-ai`.

Контекст кабинета — 16 384 токена, предел ответа — 4096. Локальному инференсу дополнительно нужна память для весов, кеша контекста и буферов. [Загрузка весов, Docker и GPU](../LLM_MODES.md), [собственный API](../CLONE_AND_RUN.md#свой-api-или-модель-вне-docker).

Для модели на хосте контейнер использует `http://host.docker.internal:11434/v1`; `localhost` внутри контейнера относится к самому контейнеру. Локальная Ollama может работать без API-ключа.

## Проверка подключения

```shell
uv run --env-file .env.api --frozen python -m scripts.check_llm
uv run --env-file .env.api --frozen python -m scripts.check_llm --generate
```

Первая команда проверяет доступность модели. Вторая отправляет синтетический запрос и проверяет структуру ответа; она расходует квоту API. [Тестирование диалогов](../TESTING.md).
