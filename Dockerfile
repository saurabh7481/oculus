FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/react/package.json packages/react/package.json
COPY apps/demo/package.json apps/demo/package.json

RUN npm ci

COPY . .

EXPOSE 3000 5173

CMD ["npm", "run", "dev"]
