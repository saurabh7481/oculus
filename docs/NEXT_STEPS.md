# Oculus Next Steps

This repository now contains the first runnable slice of Oculus:

- `packages/server`: in-memory room coordinator, Bun-native WebSocket gateway, field-level operations, event log, replay endpoint, and presence fan-out.
- `packages/sdk`: browser client with optimistic mutations, rollback on rejection, presence throttling, event history, replay fetches, and offline queueing for disconnected mutations.
- `packages/svelte`: `createOculusRoomStore` for Svelte apps.
- `apps/demo`: Svelte collaborative workflow-builder canvas for testing multiple tabs against the same room.

## Run Locally

```bash
pnpm install
pnpm test
pnpm run build
pnpm run server
pnpm run demo
```

Open `http://localhost:5173` in two browser tabs. Move nodes, edit labels, create links, and watch the event history update.

## Run With Docker

```bash
docker compose up --build
```

Server health check:

```bash
curl http://localhost:3000/health
```

Demo:

```bash
open http://localhost:5173
```

## Next Engineering Milestones

1. Replace `MemoryEventStore` with Postgres tables for rooms, events, and snapshots.
2. Add Redis or NATS fan-out so rooms can span multiple server instances.
3. Enforce operation-level permissions on the server before applying mutations.
4. Add durable snapshot loading with compaction after repeated LWW updates.
5. Expand conflict strategies with Yjs-backed text fields and custom resolvers registered per project.
6. Turn the demo replay preview into a full time-travel debugger with diffs between versions.
7. Add Playwright multi-tab tests for cursor, mutation, reconnect, and replay behavior.
8. Add project/API-key management once the SDK surface stabilizes.
