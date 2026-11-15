# AI/AR Content Moderation Platform

Локальная платформа модерации изображений на TypeScript. Структура следует ТЗ: монорепозиторий pnpm, NestJS API и Worker, Next.js frontend, PostgreSQL/Prisma, Redis, MinIO.

## Быстрый запуск

1. Скопируйте `.env.example` в `.env`, замените локальные пароли, выполните `openssl rand -hex 32` и вставьте результат в `UPLOAD_API_KEY`.
2. Запустите `docker compose up --build -d`.
3. Откройте веб-приложение на `http://localhost:3000`, health endpoint API — `http://localhost:4000/health`, консоль MinIO — `http://localhost:9001`.

`docker compose down` сохраняет данные в named volumes. Для полного удаления данных используйте `docker compose down -v`.

## Загрузка

Веб-форма принимает JPEG, PNG и WebP. API проверяет сигнатуру, MIME type, размер файла, декодируемость, число кадров и разрешение, считает SHA-256, сохраняет оригинал приватно в MinIO и ставит задачу в BullMQ. SHA-256 используется для повторного использования уже сохранённого оригинала.

`UPLOAD_API_KEY` хранится только на сервере и передаётся из Next.js proxy в API; браузер не получает ключ. Без заданного ключа загрузка отключена. Идентификатор приложения задаётся в форме. API статуса: `GET /api/v1/moderations/:id`.

Текущий Worker принимает задачу и переводит её в `processing`; сами этапы модерации появятся в следующей фазе. Системные сбои ставят задаче статус `failed`, автоматического `allow` нет.

MinIO собирается из закреплённых исходников Community-релиза, поскольку готовый публичный образ недоступен. Bucket приватный, данные хранятся в named volume.

Не коммитьте `.env`, API ключи и другие секреты.
