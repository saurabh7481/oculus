# Oculus Next Steps

Oculus is being built as free, open-source, self-hosted collaboration infrastructure. The core project should not depend on paid hosted accounts, billing tiers, or Oculus-issued API keys. Production apps can still plug in their own auth, roles, deployment, and observability around the engine.

This repository now contains the first runnable slice of Oculus:

- `packages/server`: room coordinator, Bun-native WebSocket gateway, field-level operations, operation-level permissions, event log, replay endpoint, snapshot loading, Postgres persistence, and presence fan-out.
- `packages/sdk`: browser client with universal operations, optimistic mutations, rollback on rejection, presence throttling, event history, replay fetches, reconnect backoff, visible sync state, and offline queue flushing.
- `packages/svelte`: `createOculusRoomStore` for Svelte apps, including readable connection status and queued operation counts.
- `apps/demo`: Svelte collaborative workflow-builder canvas for testing multiple tabs against the same room, including visible reconnect/syncing/offline queue status.

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

1. Add snapshot compaction policies for repeated LWW updates and long-lived rooms.
2. Turn the demo replay preview into a full time-travel debugger with diffs between versions.
3. Add Playwright multi-tab tests for cursor, mutation, reconnect, persistence, permissions, text merge, tombstone deletes, ordered lists, tree moves, and replay behavior.
4. Add self-hosting polish: `.env.example`, migration commands, backup/restore docs, readiness checks, and production Docker Compose guidance.
5. Deepen advanced CRDT support beyond text, including Yjs maps/arrays for rich nested document and whiteboard structures.
