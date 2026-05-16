FROM oven/bun:1.2.23-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/server/package.json packages/server/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/svelte/package.json packages/svelte/package.json
COPY apps/demo/package.json apps/demo/package.json

RUN bun install --frozen-lockfile

COPY . .

EXPOSE 3000 5173

CMD ["bun", "run", "dev"]
