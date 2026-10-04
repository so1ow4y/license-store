# Директива `# syntax=docker/dockerfile:1.7` намеренно НЕ используется:
# она заставляет BuildKit тянуть frontend-образ с Docker Hub при каждой
# сборке. Встроенного синтаксиса здесь достаточно, а лишняя сетевая
# зависимость ломает сборку в закрытом контуре.

# ============================================================================
#  API — многостадийная сборка.
#
#  Базовый образ bookworm-slim, а не alpine: @node-rs/argon2 и движки Prisma
#  собраны под glibc. Под musl они существуют, но выигрыш в 40 МБ не стоит
#  риска поймать несовместимость нативного модуля в проде.
# ============================================================================

ARG NODE_VERSION=22-bookworm-slim

# ---------- 1. Зависимости --------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Prisma требует openssl для движков запросов.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Отдельным слоем: пока манифесты не менялись, npm ci не перевыполняется
# при каждой правке исходников.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- 2. Сборка -------------------------------------------------------
FROM deps AS builder
WORKDIR /app

COPY prisma ./prisma
# Клиент Prisma генерируется до компиляции: без него не разрешатся типы.
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json .swcrc ./
COPY src ./src
RUN npm run build

# Сид компилируется ОТДЕЛЬНО, и это не прихоть.
#
# prisma/seed.ts лежит вне src, поэтому nest build его не видит, а в рантайме
# нет ни tsx, ни ts-node — их вырезает `npm prune --omit=dev` строкой ниже.
# Команда `prisma db seed` тоже не спасает: секции `prisma.seed` в манифесте
# нет, и она молча завершается НУЛЁМ, ничего не сделав. Из-за этого первый
# боевой деплой отчитался об успехе на базе, где не было ни одного
# пользователя, включая администратора, — войти в систему было некем.
#
# Зависимости у сида ровно три (@prisma/client, uuid, @node-rs/argon2), и все
# они продовые, поэтому отдельный файл рядом с dist/main.js самодостаточен и
# запускается обычным node. test -s обязателен: без него молчаливо пустой
# результат компиляции доехал бы до сервера так же незаметно.
RUN npx swc prisma/seed.ts -o dist/seed.js && test -s dist/seed.js

# Выкидываем dev-зависимости из node_modules, оставляя сгенерированный
# клиент Prisma на месте.
RUN npm prune --omit=dev

# ---------- 3. Рантайм ------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    # Заставляет Node уважать лимит памяти контейнера, а не память хоста:
    # иначе GC не срабатывает вовремя и контейнер убивает OOM-killer.
    NODE_OPTIONS="--max-old-space-size=768"

# node — непривилегированный пользователь, уже существующий в образе.
# Работать от root в контейнере, который смотрит в интернет, незачем.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

# Проверка здоровья на уровне контейнера — liveness, без зависимостей:
# перезапуск контейнера из-за недоступной БД делает только хуже.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health/live || exit 1

# Без оболочки-обёртки: PID 1 — сам node, поэтому SIGTERM доходит до него
# напрямую и enableShutdownHooks успевает отработать. Через `npm start`
# сигнал застревает в npm, и контейнер убивается по таймауту.
CMD ["node", "dist/main.js"]
