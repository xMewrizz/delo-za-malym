# Сторонние компоненты

Версии Python-зависимостей закреплены в [uv.lock](uv.lock). Runtime-зависимости Docker с хешами — в [requirements.txt](requirements.txt). Лицензии ниже взяты из метаданных установленных пакетов.

| Компонент | Версия | Лицензия | Назначение |
|---|---|---|---|
| FastAPI | 0.156.2 | MIT | HTTP API и OpenAPI |
| Uvicorn | 0.54.0 | BSD-3-Clause | ASGI-сервер |
| Starlette | 1.9.0 | BSD-3-Clause | HTTP и тестовый клиент |
| Pydantic | 2.14.1 | MIT | Валидация запросов |
| pypdf | 6.21.2 | BSD-3-Clause | Чтение текстовых PDF-счетов |
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

## Новый фронтенд

Версии JavaScript-зависимостей закреплены в [frontend/package-lock.json](frontend/package-lock.json).
React, React DOM, React Router, TanStack Query, Zod, Radix UI, Tailwind CSS и Vite
распространяются по MIT; иконки lucide-react — по ISC. Компоненты Button, Card и
Skeleton, Select, Input, Label и Textarea в `frontend/src/shared/ui` получены через shadcn/ui (preset radix-nova)
и адаптированы к локальным утилитам. [Текст MIT-лицензии shadcn/ui](frontend/licenses/shadcn-ui.txt).
Для тестов используются Vitest и jsdom (MIT); версии закреплены в том же lock-файле. Node.js нужен на этапе сборки, готовые файлы раздаёт FastAPI.

CLI shadcn используется через npx; для этих компонентов отдельный пакет
`shadcn` и его дополнительные CSS-варианты не требуются.

В `frontend/public/fonts` включены Manrope и JetBrains Mono из локальной
дизайн-системы AkarmainOS. Шрифты распространяются по SIL Open Font License 1.1:
[Manrope](frontend/licenses/Manrope-OFL.txt),
[JetBrains Mono](frontend/licenses/JetBrainsMono-OFL.txt).

GSAP 3.12.5 используется для анимаций. Установленный пакет указывает собственную [Standard «no charge» license](https://gsap.com/standard-license); это отдельная лицензия, не MIT. В релизе нужно сохранять её уведомления и проверять применимость условий. `react-markdown` 10.1.0 и `remark-gfm` 4.0.1 (MIT) отображают руководство; версии закреплены в lock-файле.

## Модели и данные

Материалы экспериментов LLM используют `yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF`; имя файла, SHA-256 и источник проверки записаны в [источнике модели](scr/delo_za_malyn/Models/Llm/weights/source.json). Ревизия репозитория указывается только после подтверждения. Модель подключается отдельно от HTTP-процесса; условия распространения определяются её [карточкой](https://huggingface.co/yuxinlu1/gemma-4-12B-agentic-fable5-composer2.5-v2-3.5x-tau2-GGUF).

Данные компаний, финансовые показатели, заявки и планы операций в `contracts` — синтетические примеры проекта.

## Смоделированные интеграции

Регистрационная проверка, ограничения финансирования, кредитная история и сверка обязательств воспроизводятся локальным симулятором `backend/demo.py`. Поручительство, электронная подпись, выдача кредита и открытие лимита воспроизводятся в `backend/service.py`. У операций сохраняются идентификатор, время и признак `mode: simulated`.

Подключённый для проверки LLM-провайдер — **Dahl Inference**, OpenAI-совместимый API `https://inference.dahl.global/v1`. Модель — `MiniMaxAI/MiniMax-M2.7`; открытые веса и условия лицензии опубликованы в [официальном репозитории](https://huggingface.co/MiniMaxAI/MiniMax-M2.7), [лицензия](https://huggingface.co/MiniMaxAI/MiniMax-M2.7/blob/main/LICENSE). Для демонстрации может использоваться подарочный пул аккаунта по [условиям Dahl](https://inference.dahl.global/docs/tokens/); остаток и доступность конкретного ключа требуют проверки перед показом. Платный резервный маршрут в приложении не предусмотрен. URL, ключ и model ID задаются через `LLM_API_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` и заменяются без изменения кода. Веса модели не копируются в образ. Корневой `.env.example` остаётся нейтральным шаблоном, ключ хранится в игнорируемом `.env`.

Tavily — необязательный публичный поиск; без ключа отключён, кредитный процесс от него не зависит.

Проверка 24 октября 2026: опубликованная лицензия MiniMax-M2.7 ограничивает коммерческое применение и требует отдельного письменного разрешения для такого использования. Наличие открытых весов не означает MIT или неограниченное промышленное использование. Проверяемый ручной путь запускается в `CHAT_MODE=demo` без LLM; свободный диалог требует отдельно настроенного инференса.


## Воспроизводимый локальный инференс

Маршрут `scripts.start_demo --luma` использует Ollama 0.13.5, образ
`ollama/ollama@sha256:2c9595c555fd70a28363489ac03bd5bf9e7c5bdf2890373c3a830ffd7252ce6d`.
Ollama: [официальный репозиторий и MIT-лицензия](https://github.com/ollama/ollama).
Модель — [Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507),
[лицензия Apache 2.0](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/blob/main/LICENSE).
Квантованный вариант из [официальной библиотеки Ollama](https://ollama.com/library/qwen3:4b-instruct-2507-q4_K_M):
Q4_K_M, манифест `0edcdef34593`. Веса скачиваются из upstream, в репозитории и
образе кабинета не распространяются. Настройки Compose принудительно оставляют
оба API-ключа пустыми; коммерческий провайдер и подарочная квота не используются.
Ограничения MiniMax, описанные выше, относятся к экспериментальному альтернативному
подключению через API, а не к этому локальному маршруту. Стандартная команда
`scripts.start_hackathon` использует Dahl; `--without-ai` не запускает модель.
Qwen — сохранённый отдельный эксперимент, Gemma — локальный профиль команды.

## Оформление репозитория

Обложка README собрана локально в HyperFrames CLI 0.8.197 из собственного логотипа,
шрифта Manrope и реального скриншота синтетического кабинета. Источник инструмента
и скиллов — [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes).
В приложение и Docker-образ HyperFrames не входит; опубликован статичный PNG.
