# Развёртывание на VPS

На VPS запускаются backend, статический frontend, SQLite и Caddy. Лума подключается через внешний API; локальные веса и Ollama в серверный состав не входят. Для небольшого демонстрационного стенда достаточно 2 CPU, 4 ГБ RAM и 40 ГБ диска.

## Конфигурация

Скопируйте `.env.api.example` в `.env.api`, укажите свой `LLM_API_KEY` и домен:

```dotenv
LLM_API_BASE_URL=https://inference.dahl.global/v1
LLM_MODEL=MiniMaxAI/MiniMax-M2.7
LLM_RESPONSE_FORMAT=json_object
STAND_BIND_ADDRESS=0.0.0.0
STAND_SITE=credit.example.org
STAND_HTTP_PORT=80
STAND_HTTPS_PORT=443
```

URL и ID модели можно заменить на другой OpenAI-совместимый сервер. Для JSON Schema задайте `LLM_RESPONSE_FORMAT=json_schema`; для модели без инструментов — `AGENT_TOOLS_ENABLED=false`. Ключ используется только backend и не попадает во frontend или Docker-образ.

Направьте DNS домена на сервер и откройте входящие порты 80 и 443. Для HTTP по IP используйте `STAND_SITE=http://ваш-IP`.

## Запуск наполненного кабинета

Из корня репозитория:

```shell
docker compose --env-file .env.api -p delo -f compose.demo.yaml -f compose.api.yaml -f compose.hackathon.yaml -f compose.stand.yaml up --build -d --wait
```

При первом запуске `seed` восстанавливает демонстрационные данные в новый том. Caddy получает сертификат и проксирует запросы к API. Кабинет доступен по `https://ваш-домен/cabinet`; порт API на хосте привязан к `127.0.0.1`.

Это демонстрационная версия с синтетическими данными и без промышленной авторизации. Реальные банковские документы и персональные данные в неё загружать не следует.

## Проверка сервиса

Откройте `/health`, `/cabinet` и `/documentation`. Проверка модели из контейнера:

```shell
docker compose --env-file .env.api -p delo -f compose.demo.yaml -f compose.api.yaml -f compose.hackathon.yaml -f compose.stand.yaml exec -T api python -m scripts.check_llm --generate
```

Команда проверяет доступность модели и структуру ответа; генерация расходует квоту API. Доступность и скорость свободного диалога зависят от провайдера. Ручной кредитный путь от модели не зависит.

## Обновление и сохранность данных

Для обновления повторите команду запуска с тем же именем проекта и набором Compose-файлов. Существующая база не заменяется исходным снимком. Заявки и операции хранятся в томе `demo_data`, сертификаты — в `gateway_data` и `gateway_config`.

Остановка через `down` сохраняет данные; `down -v` удаляет тома. Перед обновлением сохраните резервную копию SQLite через backup API и текущий Git commit. После обновления проверьте `/health` и сохранённую заявку.

[Локальный запуск](../CLONE_AND_RUN.md) · [Модели](../LLM_MODES.md) · [Архитектура](ARCHITECTURE.md)
