# Устройство приложения

```mermaid
flowchart LR
    U[Предприниматель] --> WEB[Кабинет и чат]
    WEB --> API[FastAPI]
    API --> PROCESS[Процесс заявки и подтверждения]
    API --> OPTIONS[Варианты, денежный план, импорт]
    API --> CHAT[История и общий черновик диалога]
    PROCESS --> ENGINE[Финансы, скоринг, правила продуктов]
    OPTIONS --> ENGINE
    PROCESS --> CHECKS[Локальные симуляторы проверок]
    OPTIONS --> CHECKS
    CHAT --> LLM[Внешний или локальный API открытой модели]
    CHAT --> OPTIONS
    PROCESS --> DB[(SQLite)]
    OPTIONS --> DB
    CHAT --> DB
```

FastAPI отдаёт встроенный веб-интерфейс и API. Модель подключается переменными окружения: локальный сервер или внешний OpenAI-совместимый API; кабинет и оформление работают без неё. Расчёты выполняет Python-модуль `credit_engine`. Статусы и денежные операции не устанавливаются ответом модели.

## Состояния заявки

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> submitted: подтверждение отправки
    submitted --> under_review
    under_review --> waiting_for_data: нужны сведения
    waiting_for_data --> draft: подтверждение дополнений
    under_review --> check_retry_pending: проверка недоступна
    check_retry_pending --> under_review: повтор
    under_review --> offers_ready: есть предложения
    under_review --> declined
    under_review --> out_of_policy
    offers_ready --> conditions_pending: выбрано предложение с условием
    offers_ready --> ready_to_sign: выбрано предложение без условий
    conditions_pending --> ready_to_sign: условие выполнено
    ready_to_sign --> signed: подтверждение подписания
    signed --> disbursed: разовый кредит
    signed --> limit_opened: овердрафт
    ready_to_sign --> offer_expired: срок истёк
    offer_expired --> under_review: повторное рассмотрение
    draft --> cancelled
```

Рассмотрение выполняется синхронно: промежуточные этапы записываются в событиях в одной транзакции. Интерфейс показывает историю фактических этапов. Изменение данных после рассмотрения возвращает заявку в черновик с новой версией; отправленные версии остаются неизменными.

## Данные

Физическое хранение — четыре таблицы SQLite:

| Таблица | Ключ | Содержимое |
|---|---|---|
| `applications` | `application_id` | JSON записи заявки и `updated_at` |
| `chats` | `chat_id` | JSON диалога, включая ссылку на `application_id` |
| `documents` | `document_id` | PDF BLOB и связь с заявкой |
| `account_payments` | `request_id` | JSON подтверждённой оплаты и источников средств |

В записи заявки находятся `application`, `state`, `checks`, `result`, `recommendation`, `readiness`, `signature`, `completion`, `events`, `submitted_versions`, `explorations`, `imports`. Результаты симулятора хранятся отдельно от редактируемых клиентом данных.

```mermaid
flowchart TD
    A[Запись заявки] --> V[Версия данных application]
    A --> S[Состояние state]
    A --> R[Итоговая оценка и предложения]
    A --> H[Отправленные версии и события]
    A --> E[До 10 отдельных расчётов]
    A --> I[До 5 импортов с источниками]
    C[Диалог] --> A
    C --> M[Сообщения]
    M --> P[Общий неподтверждённый черновик need]
```

Изменения защищены `application_version` и `chat_version`. При подтверждении диалога дополнительно сравниваются исходные значения конкретных полей: независимые правки объединяются, конфликтующие требуют проверки. Заявка и подтверждение карточки сохраняются атомарно.

SQLite использует WAL и транзакции записи `BEGIN IMMEDIATE`. Ожидание LLM происходит вне блокировки базы. Повтор сообщения с тем же `request_id` не создаёт дублей. Предварительные расчёты и CSV не меняют заявку без подтверждения; перед подписанием проверяются итоговая оценка, версия, выбранное предложение, срок и условия.

API описан в `openapi.json` и `/docs`; коллекция запросов — `contracts/credit_process.postman_collection.json`. Проверки: `uv run --frozen python -m unittest discover -s tests` и `python -m scripts.run_api_scenarios`.

В стендовом запуске Caddy принимает HTTP/HTTPS и передаёт запросы FastAPI по внутренней Docker-сети. API модели вызывается только backend; ключ не попадает в браузер или образ. Настройки провайдера заменяются без изменения кода. `compose.stand.yaml` ограничивает память API и прокси, а LLM работает за пределами VPS с 4 ГБ. Одновременно выполняются до двух генераций; остальные запросы получают понятный отказ ожидания без блокировки форм. См. [развёртывание](DEPLOYMENT.md).
