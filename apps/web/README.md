# apps/web — личный кабинет

Vite 7+ / React 19 / TypeScript / Tailwind v4 / shadcn-ui, TanStack Router (файловый роутинг) + TanStack Query, react-hook-form + zod.

```bash
npm install
npm run dev      # http://localhost:5173 — порт зафиксирован, CORS сервера разрешён только ему
npm run build    # tsr generate + tsc -b + vite build
npm run routes   # перегенерировать src/routeTree.gen.ts вручную
```

## Договорённости, обязательные для всех веток работы

**API.** Только через `apiFetch` из `src/lib/api/client.ts`. Он сам подставляет
Bearer, сам обновляет токен при 401 и превращает конверт `{statusCode, code, message, details?}`
в `ApiError`. Ветвиться в UI — **только по `error.code`**, никогда по тексту.
Health-маршруты (`/health/live`, `/health/ready`) живут вне версии — для них `healthFetch`.

Сервер валидирует тело с `forbidNonWhitelisted`: любое лишнее поле даёт 400.
Тело запроса собирается точно по контракту, а не спредом состояния формы.

**Токены.** Трогает только `src/lib/auth/token-store.ts`. Строки `lp.rt` не должно
быть больше нигде. Access живёт в памяти, refresh — в `localStorage`.

**Обновление токена.** Только `refreshAccessToken()` из `src/lib/auth/refresh.ts`.
Refresh ротируется: повторное предъявление старого токена даёт `TOKEN_REUSED`
и гасит всю сессию, поэтому очередь на один промис — обязательное условие,
а не оптимизация. Своих вызовов `/auth/refresh` не писать.

**Права.** `useSession().can(permission)` или `has()` из `src/lib/auth/permissions.ts`.
Роли в ответе `/auth/me` нет — гейтить по роли нечем и не нужно.

**Имя и почта.** `/auth/me` их не возвращает. Единственный источник — ответ
`POST /auth/login`, он кладётся в `setProfileHint()` и живёт до перезагрузки.
Экраны обязаны работать и без него.

## Точки синхронизации (правятся всеми, аккуратно)

| Файл | Правило |
|---|---|
| `src/lib/api/error-codes.ts` | только добавление ключей, без переструктурирования |
| `src/components/app-shell.tsx` | каждый кусок работы добавляет свой пункт меню одной строкой |
| `src/lib/routes.ts` | адреса ещё не созданных маршрутов; появился файл маршрута — убрать константу и поставить литерал в `to` |

## Заглушки каркаса, которые нужно заменить

- `src/routes/_public/login.tsx` — K1, п. 3.3. Схему `validateSearch`
  (`redirect`, `reason`) менять нельзя: на неё завязаны редиректы каркаса.
- `src/routes/_app/index.tsx` — K3, п. 3.9 (список лицензий).

## Тема

Тёмная и единственная. Палитра — CSS-переменные в `src/styles/globals.css`.
Акцент `#afff01` работает только с тёмным текстом (`--primary-foreground`),
белый на нём нечитаем. Светлую тему не добавлять.
