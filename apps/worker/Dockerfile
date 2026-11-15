FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --filter @moderation/worker... --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/worker apps/worker
WORKDIR /app/apps/worker
RUN pnpm build
CMD ["pnpm", "start"]
