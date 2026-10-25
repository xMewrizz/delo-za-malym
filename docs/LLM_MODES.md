# Два режима Лумы

Локальный профиль использует Gemma 4 12B Agentic v2 Q4_K_M. Стандартный запуск — API Dahl. Внешний API и локальная модель используют один банковский модуль; модель не определяет одобрение, ставки и суммы самостоятельно.

## Локально: Gemma в Docker

Из корня проекта:

```shell
uv run --frozen python -m scripts.gemma_weights
uv run --frozen python -m scripts.start_demo --provider local
```

Кабинет: `http://localhost:18007`. Ollama: `http://localhost:11437/v1`, модель `alfa-gemma-q4`. Первый запуск импортирует уже скачанный GGUF; повторно тянуть веса из Hugging Face внутри контейнера не нужно. Модель хранится в отдельном Docker-томе. Для повторной проверки локального файла: `uv run --frozen python -m scripts.gemma_weights --check`.

Полный SHA-256: `0b9506cab36f7f818e34f9c0f5a3d6568d0b37100f3a3e1092e2eec3c4c96791`. Размер: 7 381 381 664 байта. Источник: [веса GGUF](https://huggingface.co/yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF).

На компьютере с NVIDIA и настроенной поддержкой GPU в Docker:

```shell
uv run --frozen python -m scripts.start_demo --provider local --gpu
```

Это включает `compose.gemma-gpu.yaml`. CPU-режим не требует NVIDIA. Контекст — 16 384 токена, ответ — до 4096. Помимо памяти под веса нужны кеш контекста и буферы. GPU-профиль требует NVIDIA и поддержки GPU в Docker.

## API: локально или на VPS

В серверном `.env` по образцу `.env.example` укажите:

```dotenv
CHAT_MODE=model
LLM_API_BASE_URL=<OpenAI-совместимый URL Dahl>
LLM_MODEL=<точный ID модели у провайдера>
LLM_API_KEY=<ключ провайдера>
LLM_RESPONSE_FORMAT=json_object
```

Не коммитьте `.env` и не передавайте ключ через frontend. Для наполненного локального кабинета:

```shell
uv run --frozen python -m scripts.start_demo --provider api --env-file .env
```

Для VPS:

```shell
docker compose --env-file .env -f compose.yaml -f compose.api.yaml -f compose.stand.yaml up --build -d
```

В составе VPS нет Ollama, контейнера импорта, модельного тома и GGUF. Веса исключены из Docker build context. Адрес сайта и доступ задаются настройками стенда. [Настройка VPS и прокси](technical/DEPLOYMENT.md).

## Переключение с сохранением данных

Используйте одно имя `--project` и не удаляйте тома. Сначала остановите предыдущий состав через тот же набор Compose-файлов с командой `down` **без `-v`**, затем запустите нужный режим. Так локальная модель не останется занимать память при переходе на API, а база заявок сохранится.

Пример остановки локального демо:

```shell
docker compose --env-file /dev/null -p alfa-showcase -f compose.demo.yaml -f compose.gemma.yaml down
```

На Windows вместо `/dev/null` используется `NUL`. Останавливайте только свой Docker-проект. Обычный `start_demo` не удаляет базу и не переинициализирует наполненное демо. `--no-build` позволяет использовать уже собранный образ приложения.

## Проверка подключения

[Команды проверки API и диалога](TESTING.md). Для локальной Gemma используйте URL `http://127.0.0.1:11437/v1` и модель `alfa-gemma-q4`.
