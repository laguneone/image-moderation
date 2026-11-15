# AI/AR Content Moderation Platform

Локальный каркас платформы модерации изображений на TypeScript. Структура следует ТЗ: монорепозиторий pnpm, NestJS API и Worker, Next.js frontend, PostgreSQL/Prisma, Redis, MinIO.

## Быстрый запуск

1. Скопируйте `.env.example` в `.env` и замените локальные пароли.
2. Запустите `docker compose up --build -d`.
3. Откройте веб-приложение на `http://localhost:3000`, health endpoint API — `http://localhost:4000/health`, консоль MinIO — `http://localhost:9001`.

`docker compose down` сохраняет данные в named volumes. Для полного удаления данных используйте `docker compose down -v`.

## Статус

Сейчас реализуется только фаза Infrastructure. Загрузка изображений, очередь модерации и вызовы моделей относятся к следующим фазам и пока не включены. Настройте `.env` перед запуском; секреты не коммитить.
