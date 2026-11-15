FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --filter @moderation/api... --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN pnpm build
EXPOSE 4000
CMD ["pnpm", "start"]
