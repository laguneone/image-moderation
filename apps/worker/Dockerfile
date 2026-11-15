FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY packages/shared/src packages/shared/src
COPY packages/database/package.json packages/database/package.json
COPY packages/database/tsconfig.json packages/database/tsconfig.json
COPY packages/database/prisma packages/database/prisma
COPY packages/database/src packages/database/src
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --filter @moderation/worker... --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/database packages/database
COPY apps/worker apps/worker
WORKDIR /app/apps/worker
RUN pnpm --filter @moderation/shared build && pnpm --filter @moderation/database generate && pnpm --filter @moderation/database build
RUN pnpm build
CMD ["pnpm", "start"]
