# Oculus

Oculus is a free, open-source, self-hosted TypeScript SDK and realtime room server for building multiuser, sync-enabled applications without recreating collaboration infrastructure from scratch.

The initial implementation includes:

- A room coordinator with field-level operations, versioning, event history, and replay snapshots.
- A Bun-native WebSocket gateway for realtime mutations and presence.
- Durable Postgres-backed event and snapshot storage when run through Docker.
- A browser SDK and Svelte store package.
- A collaborative workflow-builder demo designed for testing in multiple browser tabs.
- Docker Compose for a runnable local stack with Postgres, server, and demo services.

See [docs/NEXT_STEPS.md](./docs/NEXT_STEPS.md) for the roadmap from this initial implementation toward a production-grade system.
