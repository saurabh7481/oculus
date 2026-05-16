FROM oven/bun:1.2.23-alpine

WORKDIR /app

RUN apk add --no-cache nodejs npm \
  && npm install -g pnpm@10.16.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json packages/server/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/svelte/package.json packages/svelte/package.json
COPY apps/demo/package.json apps/demo/package.json

RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3000 5173

CMD ["pnpm", "dev"]
