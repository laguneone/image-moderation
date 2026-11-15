FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @moderation/web... --frozen-lockfile
COPY apps/web apps/web
WORKDIR /app/apps/web
RUN pnpm build
EXPOSE 3000
CMD ["pnpm", "start"]
