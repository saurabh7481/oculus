# Universal Collaboration Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Oculus from a workflow-demo sync server into a self-hosted, open-source collaboration engine that can support canvas, document, whiteboard, and design-tool state.

**Architecture:** Keep the current Postgres-backed room/event/snapshot foundation and evolve the public operation model in backward-compatible layers. The first layer standardizes universal operation types; the second layer adds strategy-aware server application; the third layer adds Yjs-backed text fields, ordered structures, locks, replay tooling, and reconnect recovery.

**Tech Stack:** Bun, TypeScript, Svelte, PostgreSQL, Vitest, Yjs, Docker Compose.

---

### Task 1: Reframe Roadmap Around Self-Hosting And Engine Capabilities

**Files:**
- Modify: `docs/NEXT_STEPS.md`
- Modify: `README.md`
- Modify: `Collab-Engine.md`

- [ ] Remove hosted SaaS, billing, paid tier, and API-key platform language from active roadmap sections.
- [ ] State the project philosophy: free, open source, self-hosted, bring-your-own auth, bring-your-own deployment.
- [ ] Replace "project/API-key management" with self-hosting docs, migrations, backups, observability, and deployment hardening.
- [ ] Preserve API-key/auth mentions only as optional integration examples for downstream apps, not Oculus billing infrastructure.

### Task 2: Add Universal Operation Model V1

**Files:**
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/server/src/coordinator.ts`
- Modify: `packages/server/src/protocol.ts`
- Test: `packages/sdk/test/client.test.ts`
- Test: `packages/server/test/coordinator.test.ts`
- Modify: `docs/SDK.md`

- [x] Add named operation variants while preserving legacy `insert`, `update`, and `delete`:

```ts
type Operation =
  | { op: "insert" | "update" | "delete"; path: string; value?: unknown }
  | { op: "set"; path: string; value: unknown }
  | { op: "text"; path: string; value: { insert?: string; delete?: number; index?: number } }
  | { op: "list-move"; path: string; value: { from: number; to: number } }
  | { op: "lock"; path: string; value: { owner: string | null } };
```

- [x] Treat `set` as the canonical field/object write operation.
- [x] Keep legacy `insert` and `update` as aliases for `set` so existing demo behavior does not break.
- [x] Implement SDK/server local application for `text`, `list-move`, and `lock` without yet claiming full CRDT semantics.
- [x] Document that `text` V1 is an operation-shape bridge; Yjs-backed text merge comes in Task 3.

### Task 3: Add Yjs-Backed `crdt-text` Fields

**Files:**
- Modify: `packages/server/src/coordinator.ts`
- Create: `packages/server/src/crdt.ts`
- Modify: `packages/sdk/src/index.ts`
- Test: `packages/server/test/coordinator.test.ts`
- Test: `packages/sdk/test/client.test.ts`
- Modify: `docs/SDK.md`

- [x] Add server support for `FieldStrategy { strategy: "crdt-text" }`.
- [x] Accept native Yjs update payloads from advanced clients.
- [x] Rehydrate Yjs text state from materialized snapshots before applying post-snapshot text events.
- [x] Persist CRDT sidecar state separately from materialized snapshots.
- [x] Expose SDK helpers for producing text operations without making app developers touch Yjs directly for common plain-text fields.
- [x] Update the workflow demo so node labels use the CRDT-text path.

### Task 4: Add Ordered List And Tree Operations

**Files:**
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/server/src/coordinator.ts`
- Test: `packages/sdk/test/client.test.ts`
- Test: `packages/server/test/coordinator.test.ts`
- Modify: `docs/SDK.md`

- [x] Support deterministic `list-move` for ordered layers, children, cards, and canvas z-order.
- [x] Add tombstone-aware delete semantics for objects that may receive stale offline updates.
- [x] Add ordered tree moves for design-tool child trees.
- [x] Add examples for whiteboard layer order and design-tool child tree order.

### Task 5: Add Operation-Level Permissions

**Files:**
- Modify: `packages/server/src/coordinator.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/test/coordinator.test.ts`
- Modify: `docs/SDK.md`
- Modify: `docs/NEXT_STEPS.md`

- [ ] Define room-local permission rules by path pattern and operation type.
- [ ] Reject unauthorized operations before applying or persisting them.
- [ ] Keep auth pluggable for self-hosted deployments: the server consumes caller-provided user/role context instead of issuing paid platform API keys.

### Task 6: Add Reconnect And Offline Recovery

**Files:**
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/svelte/src/index.ts`
- Modify: `apps/demo/src/App.svelte`
- Test: `packages/sdk/test/client.test.ts`
- Modify: `docs/SDK.md`

- [ ] Add reconnect backoff with jitter.
- [ ] Surface connection status as connected, reconnecting, offline, and syncing.
- [ ] Flush queued operations after fresh `room_init`.
- [ ] Show queued operation count in the demo.

### Task 7: Expand Replay Into A Debugger

**Files:**
- Modify: `apps/demo/src/App.svelte`
- Modify: `apps/demo/src/styles.css`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/test/coordinator.test.ts`

- [ ] Add diff between two versions.
- [ ] Show event details, operation type, user, timestamp, and affected paths.
- [ ] Keep replay backed by the durable Postgres event store.

### Task 8: Self-Hosting Polish

**Files:**
- Create: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Modify: `docs/NEXT_STEPS.md`

- [ ] Document Docker Compose, migrations, backup/restore, and production environment variables.
- [ ] Add health and readiness endpoints.
- [ ] Add simple observability guidance for logs, Postgres, and room storage metrics.

### Self-Review

- The plan covers the five systems in `Collab-Engine.md`: shared state runtime, room server, conflict resolution, presence, and event log/replay.
- The first task removes hosted SaaS assumptions and aligns the project with free self-hosting.
- The implementation starts with a backward-compatible operation model so existing SDK/demo behavior remains intact while richer collaboration features are added.
- Yjs text support is separated from operation-shape work because snapshot/replay correctness requires storing CRDT document state deliberately.
