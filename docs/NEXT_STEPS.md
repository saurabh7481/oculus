# Oculus Next Steps

This repository now contains the first runnable slice of Oculus:

- `packages/server`: room coordinator, Bun-native WebSocket gateway, field-level operations, event log, replay endpoint, snapshot loading, Postgres persistence, and presence fan-out.
- `packages/sdk`: browser client with optimistic mutations, rollback on rejection, presence throttling, event history, replay fetches, and offline queueing for disconnected mutations.
- `packages/svelte`: `createOculusRoomStore` for Svelte apps.
- `apps/demo`: Svelte collaborative workflow-builder canvas for testing multiple tabs against the same room.

## Run Locally

```bash
bun install
bun run test
bun run build
bun run server
bun run demo
```

Open `http://localhost:5173` in two browser tabs. Move nodes, edit labels, create links, and watch the event history update.

## Run With Docker

```bash
docker compose up --build
```

Docker Compose starts Postgres, the Oculus server, and the Svelte demo. The server receives:

```bash
DATABASE_URL=postgres://oculus:oculus@postgres:5432/oculus
```

When `DATABASE_URL` is present, the server runs the Postgres schema migration at startup and stores room initial state, event logs, and snapshots durably. Without `DATABASE_URL`, it falls back to `MemoryEventStore` for fast local tests.

Server health check:

```bash
curl http://localhost:3000/health
```

Room storage status:

```bash
curl http://localhost:3000/rooms/workflow_123/storage
```

Demo:

```bash
open http://localhost:5173
```

## Next Engineering Milestones

1. Add Redis or NATS fan-out so rooms can span multiple server instances.
2. Enforce operation-level permissions on the server before applying mutations.
3. Add snapshot compaction policies for repeated LWW updates and long-lived rooms.
4. Expand conflict strategies with Yjs-backed text fields and custom resolvers registered per project.
5. Turn the demo replay preview into a full time-travel debugger with diffs between versions.
6. Add Playwright multi-tab tests for cursor, mutation, reconnect, persistence, and replay behavior.
7. Add project/API-key management once the SDK surface stabilizes.
