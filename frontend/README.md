# Фронтенд «Дело за малым»

Рабочий клиент на React, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query и
React Router. Главная `/` показывает продукты; `/cabinet` работает с реальным API
FastAPI: профиль, заявки, черновик, предварительный расчёт, сравнение вариантов,
рассмотрение, выбор предложения, демонстрационное оформление и ассистент.
Для овердрафта есть форма денежного плана. Исходники интерфейса находятся в `src/`,
а `backend/static` остаётся старым демонстрационным интерфейсом backend.

## Запуск

Node.js 24+, npm, Python 3.13+ и uv. Из корня репозитория запустить backend без Docker:

```sh
uv sync --frozen
uv run --frozen uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Затем в другом терминале:

```sh
cd frontend
npm ci
npm run dev
```

Открыть http://127.0.0.1:5173/cabinet. Главная доступна по корню сайта.
Vite проксирует `/api` на http://127.0.0.1:8000.
Чтобы изменить адрес backend, скопировать `.env.example` в `.env.local`, поменять
`BACKEND_URL` и перезапустить Vite. Если backend выключен, страницы покажут ошибку
с кнопкой повторной загрузки. Данные не подменяются моками. Примеры в кабинете
создают отдельные демонстрационные заявки на backend.

```sh
npm run check       # типы, линтер и тесты преобразования данных
npm run build       # production-сборка в dist/
npm run preview     # просмотр сборки; API требует отдельной настройки
```

Dev proxy действует только для `npm run dev`. Для preview/production раздавайте
`/api` через reverse proxy либо соберите приложение с абсолютным
`VITE_API_BASE_URL=http://127.0.0.1:8000/api` и разрешите origin фронтенда в backend
`CORS_ORIGINS`. SPA-маршруты хостинг должен направлять в `index.html`.
Автоматическое размещение и frontend-сервис в Docker Compose пока не настроены.

## Где менять приложение

- [Архитектура](../docs/technical/FRONTEND.md) — границы модулей, данные и стили.
- [Этапы реализации](docs/ROADMAP.md) — следующий законченный пользовательский сценарий.
- `src/styles/tokens.css` — тема всего кабинета.
- `src/shared/ui` — общие компоненты shadcn/ui.
- `src/features/products` — образец модуля с API, проверкой данных и UI.
- `src/features/applications` — API заявки, формы, расчёт, варианты и оформление.
- `src/features/assistant` — диалог и подтверждение предложенных изменений.
- `src/pages/cabinet-page.tsx` — композиция кабинета и координация запросов.

Добавить компонент: `npx shadcn@latest add input`. CLI использует `components.json`
и помещает исходники в `src/shared/ui`. Перед обновлением существующих компонентов
проверь локальные изменения. Кредитные расчёты и решения остаются на backend.
