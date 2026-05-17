# Multiplayer State Synchronization Engine — Complete Build Guide

> You are not building "websockets."
> You are building a realtime shared-state infrastructure platform that lets developers create multiplayer applications with synced state, presence, conflict resolution, persistence, permissions, and replay.

---

## Table of contents

1. [One-line idea](#1-one-line-idea)
2. [What problem are you solving?](#2-what-problem-are-you-solving)
3. [What will developers use it for?](#3-what-will-developers-use-it-for)
4. [Core concepts explained simply](#4-core-concepts-explained-simply)
5. [The 5 core systems](#5-the-5-core-systems)
6. [Production hardening — critical gaps](#6-production-hardening--critical-gaps)
7. [Improvements to each system](#7-improvements-to-each-system)
8. [How it adapts across use cases](#8-how-it-adapts-across-use-cases)
9. [Exact SDK API](#9-exact-sdk-api)
10. [Backend components](#10-backend-components)
11. [Tech stack](#11-tech-stack)
12. [Database schema](#12-database-schema)
13. [Wire protocol](#13-wire-protocol)
14. [Starter implementation](#14-starter-implementation)
15. [Product decisions — what NOT to build first](#15-product-decisions--what-not-to-build-first)
16. [Business case](#16-business-case)
17. [Target customers](#17-target-customers)
18. [Pricing model](#18-pricing-model)
19. [Roadmap](#19-roadmap)
20. [Demo app spec](#20-demo-app-spec)

---

## 1. One-line idea

Build a developer platform that lets people add Figma/Notion/Google Docs-style realtime collaboration to any app without building sync, conflict resolution, presence, offline recovery, or replay themselves.

Think: **"Supabase/Firebase for multiplayer app state"** — but focused on complex shared state, not just database rows.

---

## 2. What problem are you solving?

Developers building collaborative apps face nine hard problems:

1. How do two users edit the same object at the same time?
2. How do changes reach all users instantly?
3. What happens if one user goes offline?
4. How do you merge offline changes later?
5. How do you show who is currently editing what?
6. How do you replay/debug what happened?
7. How do you persist collaborative state reliably?
8. How do you enforce permissions on realtime state?
9. How do you avoid building a custom WebSocket server for every app?

Your product solves all of this.

---

## 3. What will developers use it for?

Your engine should power apps like:

- Collaborative whiteboards
- Workflow builders (n8n-style)
- Diagram editors (Figma/Miro-style)
- Collaborative dashboards
- Multiplayer project management tools
- AI canvas apps (LangFlow/Dify-style)
- Collaborative code/design tools
- Realtime form builders
- Node-based automation builders
- Collaborative document/data editors

**Example scenario:** A developer is building a workflow builder. They want user A to move a node, user B to edit a node name, user C to connect two nodes — all changes syncing instantly, with live cursors, offline merge, and full session replay. They use your SDK instead of building all that infrastructure.

---

## 4. Core concepts explained simply

Think of your engine as a **post office for app state**. Multiple people are editing the same "thing." Your engine makes sure everyone sees the same thing in real time, without losing anyone's work.

### Rooms
A "room" is one shared workspace. Like a Google Doc has one URL all editors join — your engine calls this a room. Every piece of shared state lives inside one. `room_123` might be one user's workflow diagram.

### Operations
Instead of sending the whole document on every change, users send tiny descriptions of what changed: "User A moved node_1 to position x:200, y:100." That description is an operation. The server applies it and broadcasts it to everyone else. Much smaller and faster than sending full state.

### Version numbers
Every time an operation is applied, the room's version increments by 1 (v1, v2, v3...). This is how the engine knows what order things happened in. If your client is on version 50 and the server is on version 60, you know exactly which 10 operations you missed.

### Conflict resolution
Two people edit the same thing at the same time. Who wins? There are three answers:
- **Last write wins** — whoever sent their change latest wins. Simple.
- **CRDT** — a mathematical system where both changes merge automatically with no winner or loser. How Google Docs works for text.
- **Custom** — you write the rule yourself.

Most fields need strategy 1. Text fields need strategy 2. Business logic fields (like task status) need strategy 3.

### Presence
Temporary, throwaway information about what each user is doing right now. Cursor position, which node they're hovering, whether they're typing. This is NOT saved to the database. It dies when they disconnect. It travels on a separate fast channel because it changes 60 times per second.

### Event log + replay
Every operation ever applied is stored as a record. This gives you undo/redo, version history, audit logs, and the ability to "rewind" any session and watch what happened step by step. This is your killer feature.

---

## 5. The 5 core systems

### System 1: Shared State Runtime

This is the core. It stores and syncs the actual collaborative state.

```typescript
type WorkflowState = {
  nodes: Record<string, {
    id: string
    x: number
    y: number
    label: string
    config: Record<string, unknown>
  }>
  edges: Record<string, {
    id: string
    source: string
    target: string
  }>
}
```

Your engine lets multiple clients mutate this state safely:

```typescript
const room = sync.connect("workflow_123")

room.state.nodes.create({
  id: "node_1",
  x: 100,
  y: 200,
  label: "Send Email",
  config: {}
})

room.state.nodes.update("node_1", { x: 180, y: 220 })
```

Every connected user sees the update instantly.

### System 2: Realtime Room Server

A room is one collaborative workspace (`doc_123`, `canvas_456`, `workflow_789`).

The room server manages connected users, WebSocket connections, state updates, presence, permissions, broadcasting, persistence, and reconnection.

```typescript
const room = await client.joinRoom("project-board-123")
```

The room server maintains live state:

```json
{
  "roomId": "project-board-123",
  "connectedUsers": ["u1", "u2", "u3"],
  "currentVersion": 1842,
  "lastPersistedVersion": 1830
}
```

### System 3: Conflict Resolution Engine

Support three conflict strategies for MVP, plus a fourth added for production:

**Strategy 1 — Last Write Wins (LWW)**
For simple fields like position. Latest timestamp/version wins.
Best for: cursor movement, dragging objects, resizing, simple metadata.

```typescript
// x and y always use LWW — whoever moved last wins
nodes.node_1.x = 200  // wins if it's the latest op
```

**Strategy 2 — CRDT Merge**
For collaborative text or rich nested structures. Use Yjs (battle-tested, powers Notion).
Best for: text, comments, rich documents, JSON-like collaborative state.

**Strategy 3 — Custom Resolver**
Developer-defined merge logic:

```typescript
sync.defineCollection("tasks", {
  conflictResolver: (current, incoming) => {
    if (incoming.status === "done") return incoming
    return current.updatedAt > incoming.updatedAt ? current : incoming
  }
})
```

**Strategy 4 — Field-level Merge (added for production)**
The gap between LWW for whole objects and CRDT for text. A node like `{ id, x, y, label, config }` should merge field-by-field — concurrent position updates use LWW, concurrent label updates use CRDT:

```typescript
sync.defineCollection("nodes", {
  fields: {
    x:      { strategy: "lww" },
    y:      { strategy: "lww" },
    label:  { strategy: "crdt-text" },
    config: { strategy: "custom", resolver: myFn },
  }
})
```

This is the most powerful and ergonomic API for developers — it meets them at their data model.

### System 4: Presence Engine

Presence is not persistent state. It is temporary realtime awareness.

Examples: who is online, cursor position, selected object, currently editing field, typing status, active viewport, user color/avatar, idle/active status.

```typescript
room.presence.update({
  cursor: { x: 200, y: 400 },
  selectedNodeId: "node_1",
  status: "editing"
})

room.presence.onChange((users) => {
  console.log(users)
})
```

**Production note:** Separate presence into two channels:
- **Ephemeral channel** (no ack required): cursor positions, viewport, hover state. Drop these if the buffer is full.
- **Durable channel** (ack required): room join/leave, selection locks, typing indicators that affect document structure.

Also throttle presence on the SDK side before it hits the wire. At 50 users sending 60 cursor updates/second, that is 3,000 messages/second through your coordination layer — enough to kill throughput for actual mutations.

```typescript
room.presence.update(data, { throttle: 50 }) // max 20 updates/sec per client
```

**Also add: Awareness vs presence distinction**
- Awareness: anything ephemeral (cursor, selection) — never stored
- Presence: online status — brief TTL in Redis, used to show who is in the room

**Also add: Presence locking**
```typescript
const lock = await room.presence.lock("nodes.node_1.label")
if (lock.acquired) {
  // Safe to show edit UI — other clients see this field is locked
}
```

### System 5: Event Log + Replay System

Every change should be stored as an event:

```json
{
  "eventId": "evt_001",
  "roomId": "workflow_123",
  "userId": "user_1",
  "type": "node.updated",
  "timestamp": "2026-05-16T10:00:00Z",
  "version": 102,
  "patch": {
    "nodes.node_1.x": 180,
    "nodes.node_1.y": 220
  }
}
```

This gives you: debugging, replay, version history, undo/redo, audit logs, and branching later.

This is your major differentiator. Most realtime tools do not make replay a first-class feature.

**Production additions to the event log:**

**Branching:** Allow users to fork a session from any point and experiment. Store branches as a tree of event sequences, each with a `parent_event_id`. This is the "infinite undo" that Figma-like tools need.

**Event annotations:** Let admins attach metadata to events — tags, comments, labels. This turns the event log into a review/audit tool.

**Compaction jobs:** A background process that merges sequential LWW ops on the same path into one. 500 cursor moves → 1 final position. Keeps the log queryable without scanning millions of tiny ops.

---

## 6. Production hardening — critical gaps

These are things that look fine in a prototype but will break in production. Address them before launch.

### 6.1 The coordination layer needs a distributed foundation

Your coordinator will become a single point of failure and bottleneck. For production:

**Leader election per room:** Use a library like `locket` (etcd-based) or Redis-based election. When a coordinator crashes mid-session, another node takes over in seconds without losing in-flight operations.

**Operation ordering is harder than it looks:** Your protocol uses `baseVersion` on each mutation. You also need to handle operations that arrive out-of-order (network jitter, mobile) and operations with a stale `baseVersion`. The standard approach is an operation transformation queue — buffer out-of-order ops, transform them against already-applied ops, then apply. Your CRDT path handles this automatically. Your LWW path needs explicit handling.

**Vector clocks for multi-region:** A single monotonic version counter works for a single-server room. For multi-region active/active, you need vector clocks or hybrid logical clocks (HLCs) — each client and server node gets a component in the clock. This is the difference between "we support high availability" and "we support it correctly."

### 6.2 The offline/reconnect path must be designed from day one

It affects your wire protocol. Design it now:

- **Client-side operation queue:** Every mutation is appended to a local queue before sending. On reconnect, the client replays the queue from its last acknowledged `serverVersion`.
- **Rebase on reconnect:** When the client's queued operations are based on a stale version, the server transforms (rebases) them against the ops that happened in the interim.
- **Tombstones for deletions:** If client A deletes node X while offline, and client B updates node X, the tombstone must propagate correctly. Naive LWW gets this wrong.

Your `MutationAck` message should include a `transformedOps` field — the server returns the client's ops after they've been rebased. The client applies these to its local pending queue.

### 6.3 The event store schema will constrain you at scale

Plan from day one:

- **Partition by `(room_id, version)`** — this is the primary query pattern.
- **Separate hot and cold storage:** Recent events (last 7 days) stay in Postgres. Older events archive to S3/ClickHouse. The replay timeline pages across both transparently.
- **Compaction jobs:** Merge sequential LWW ops. 500 cursor moves → 1 final position.

### 6.4 Permissions must be operation-level, not just room-level

Room-level roles are not enough. Real apps need field-level control:

```typescript
sync.definePermissions({
  "nodes.*.position": ["editor", "admin"],   // only editors can move nodes
  "nodes.*.label":    ["viewer", "editor"],  // viewers can rename
  "edges.*":          ["admin"],             // only admins can connect nodes
  "presence.*":       ["viewer"],            // everyone can update presence
})
```

This permission model must be enforced on the server. Never trust the client to self-enforce. Every incoming operation must be validated against the permission table before being applied.

### 6.5 Infrastructure requirements for production

**Message broker between coordinator nodes:** Redis Streams or NATS JetStream for broadcasting mutations across nodes. Without this, users on different servers don't see each other's changes.

**Sticky sessions at the load balancer:** WebSocket connections need to stay on the same server node for the life of the session, or you need to synchronize state across nodes on every message (expensive). Use consistent hashing on `room_id` at the load balancer.

**Circuit breakers on the event store write path:** If Postgres is slow, mutation acks should not block. Use a write-ahead buffer (Redis) that persists synchronously but flushes to Postgres asynchronously. Clients get an ack as soon as the buffer commits.

**Connection limits per room:** Enforce a hard cap (e.g. 500 connections per room). Above this, return a 429 with `Retry-After`. Otherwise a viral room can take down your coordinator.

**Graceful degradation:** If the coordination server goes down during an active session, clients should fall back to local-only mode (changes buffer locally, UI shows "reconnecting"). When the server returns, the queue is replayed. Never show a blank screen or data loss.

---

## 7. Improvements to each system

### SDK improvements

**Optimistic updates with rollback:**
```typescript
const rollback = room.state.nodes.update("node_1", { x: 200 })
// If server rejects, automatically calls rollback()
```

**Schema validation at the SDK boundary:**
Let developers define a Zod schema for their state type. Mutations that fail validation are rejected client-side before hitting the wire, with a clear error. This prevents bad data from ever entering the event log.

```typescript
import { z } from "zod"

const NodeSchema = z.object({
  x: z.number(),
  y: z.number(),
  label: z.string().max(100),
})

const room = sync.room("workflow_123", { schema: NodeSchema })
```

### Conflict engine improvements

Add a fourth strategy — **field-level merge** — as described in System 3 above. Also add **3-way merge** for complex object updates: instead of "current vs incoming," track the common ancestor and merge both diffs against it.

### Snapshot system improvements

Your plan says "every 100 events or every 5 minutes." Add a third trigger: **on room idle** (last user disconnects). This ensures that when a room is reopened after a long pause, the load path is always snapshot + small delta, never a full replay.

Also store snapshots in a content-addressed store (hash the state JSON) so identical states share storage.

### Event log improvements

Add **time-travel inspection** to the replay UI: click any point in the timeline, inspect the full state at that moment, see a diff view between any two points, and generate user activity heatmaps from event data. No competitor does this well — make it a product in itself.

---

## 8. How it adapts across use cases

The engine's core never changes. What changes is which conflict strategy you configure per field, and what shape your state object takes.

### Document editor (Notion/Google Docs-style)

```typescript
type DocState = {
  title: string        // CRDT text
  body: YDoc           // CRDT (Yjs)
  comments: Comment[]  // CRDT list
  metadata: {
    tags: string[]     // LWW array
    status: string     // LWW string
  }
}
```

| Field | Strategy | Reason |
|---|---|---|
| body text | CRDT | Concurrent paragraph edits must merge |
| title | CRDT | Short text, still concurrent-safe |
| cursor position | drop (ephemeral) | Presence only |
| status field | LWW | Simple toggle, last user wins |
| tags list | LWW | Rare conflict, simple |

Presence data: cursor line + column, selection range, typing indicator.

### Workflow / node editor (n8n/Figma-style)

```typescript
type WorkflowState = {
  nodes: Record<string, {
    id: string
    x: number          // LWW
    y: number          // LWW
    label: string      // CRDT text
    config: object     // custom merge
  }>
  edges: Record<string, {
    source: string     // LWW
    target: string     // LWW
  }>
}
```

| Field | Strategy | Reason |
|---|---|---|
| node x/y position | LWW | Whoever moved last wins |
| node label | CRDT | Two people renaming merges both edits |
| node config | custom | Business logic decides merge |
| edge connections | LWW | Last connection wins |
| cursor/selection | drop | Presence only |

Presence data: cursor x/y, hovered node id, selected node ids, user color.

### Whiteboard (Miro/Excalidraw-style)

```typescript
type BoardState = {
  shapes: Record<string, {
    type: "rect" | "ellipse" | "arrow"
    x: number          // LWW
    y: number          // LWW
    w: number          // LWW
    h: number          // LWW
    color: string      // LWW
    text: string       // CRDT
    locked: string     // custom (lock owner)
  }>
  layers: string[]     // custom (ordered)
}
```

Layer order uses custom merge — reordering by two users uses a deterministic tiebreak rule instead of LWW.

Presence data: viewport position, cursor, lasso selection, user color + name.

### Project management / kanban (Linear/Jira-style)

```typescript
type BoardState = {
  tasks: Record<string, {
    title: string      // CRDT text
    status: string     // custom (state machine)
    assignee: string   // LWW
    priority: number   // LWW
    dueDate: string    // LWW
    description: YDoc  // CRDT
  }>
  columns: string[]    // LWW (ordered)
}
```

Status uses a custom state-machine resolver — a task already marked "Done" cannot be moved back to "In Progress" by a stale update. This is the kind of business logic only a custom resolver can express.

### Collaborative code / design (VS Code Live Share / Figma-style)

```typescript
type DesignState = {
  components: Record<string, {
    name: string       // CRDT
    props: object      // custom field-level
    styles: object     // LWW per-property
    children: string[] // custom (ordered tree)
    locked_by: string  // custom (mutex)
  }>
  tokens: Record<string, string> // LWW
}
```

Mutex lock lets one user "own" a component for editing. Others see a lock badge. Custom resolver prevents lock conflicts.

### AI agent canvas (Dify/LangFlow-style)

```typescript
type AgentState = {
  nodes: Record<string, {
    type: "llm" | "tool" | "memory"
    config: {
      model: string    // LWW
      prompt: string   // CRDT text
      params: object   // LWW per-key
    }
    status: string     // server-written (read-only to clients)
  }>
  runs: RunRecord[]    // append-only log
}
```

Run status is server-authoritative — only the backend can write it. Client mutations on this field are rejected by the permission layer. This pattern (server-written fields) is important to design into your permission system early.

---

## 9. Exact SDK API

### Core client

```typescript
import { createClient } from "@collab/client"

const sync = createClient({
  serverUrl: "https://collab.your-app.example",
  userId: "user_123",
  authToken: userToken
})

const room = sync.room("workflow_123")

await room.connect()
```

### State mutations

```typescript
// Insert a new object into a collection
room.state.nodes.insert({
  id: "node_1",
  x: 100,
  y: 100,
  label: "Start"
})

// Update specific fields (field-level — each field gets its own conflict strategy)
room.state.nodes.update("node_1", {
  x: 200
})

// Delete an object
room.state.nodes.delete("node_1")
```

### Optimistic updates with rollback

```typescript
// Returns a rollback function automatically called on server rejection
const rollback = await room.state.nodes.update("node_1", { x: 200 })
```

### Presence

```typescript
// Update your own presence state
room.presence.update({
  cursor: { x: 10, y: 50 },
  selected: ["node_1"],
  status: "editing"
})

// Throttle high-frequency updates
room.presence.update(cursorData, { throttle: 16 }) // ~60fps

// Acquire a field lock (for exclusive editing)
const lock = await room.presence.lock("nodes.node_1.label")
if (lock.acquired) {
  // Show edit UI — other clients see this is locked
  await lock.release() // when done
}
```

### Schema validation (optional)

```typescript
import { z } from "zod"

const room = sync.room("workflow_123", {
  schema: z.object({
    nodes: z.record(z.object({
      x: z.number(),
      y: z.number(),
      label: z.string().max(100),
    }))
  })
})
// Mutations that fail schema are rejected client-side with a clear error
```

### React hooks

```typescript
const { state, updateNode, presence } = useSyncRoom("workflow_123")

function Canvas() {
  const { nodes, updateNode, cursors, connected } = useSyncRoom("workflow_123")

  return (
    <CanvasView
      nodes={nodes}
      cursors={cursors}
      onNodeMove={(id, position) => updateNode(id, position)}
    />
  )
}
```

### Collection schemas with conflict strategies

```typescript
// Define this once, server-side, when initialising your project
sync.defineCollection("nodes", {
  fields: {
    x:         { strategy: "lww" },
    y:         { strategy: "lww" },
    label:     { strategy: "crdt-text" },
    config:    { strategy: "custom", resolver: configMerger },
    locked_by: { strategy: "custom", resolver: lockResolver },
  }
})

sync.defineCollection("tasks", {
  fields: {
    title:       { strategy: "crdt-text" },
    status:      { strategy: "custom", resolver: statusStateMachine },
    assignee:    { strategy: "lww" },
    description: { strategy: "crdt-text" },
  }
})
```

---

## 10. Backend components

### Component 1: API Server

Optional management surface for self-hosted deployments. Handles room metadata, app-provided auth context, permissions, health, and administration. Oculus does not require a hosted billing or API-key control plane.

Tech: Bun + Hono, PostgreSQL, Drizzle ORM

### Component 2: Realtime Gateway

Handles WebSocket connections, room joining, message broadcasting, presence updates, auth validation.

Tech: uWebSockets.js (10× faster than Node's ws), Bun runtime

### Component 3: Room Coordinator

The brain. Responsible for room state, connected users, version numbers, operation ordering, conflict handling, and leader election.

Tech: TypeScript/Node for MVP. Port to Rust/Tokio when you need 100k+ concurrent rooms per node.

### Component 4: Event Store

Stores every mutation, partitioned for scale.

```
rooms               — room registry
room_snapshots      — periodic state snapshots
room_events         — every mutation, partitioned by room_id
room_members        — user membership + roles
deployments         — optional self-hosted deployment metadata
auth_identities     — optional app-provided user identity mapping
```

Tech: PostgreSQL for MVP, NATS JetStream for high-throughput event streaming at scale.

### Component 5: Snapshot System

Periodically persist full room state so replay doesn't start from event 1.

Trigger snapshots:
- Every 100 events
- Every 5 minutes of activity
- When the last user leaves a room (idle trigger — most important)

Loading sequence:
1. Load latest snapshot
2. Replay events after snapshot version
3. Rebuild current state in memory

### Component 6: Presence Store

Separate from the event store. Redis/Valkey with TTL-based keys. If a client disconnects without sending a leave message, their presence expires automatically after the TTL.

### Component 7: Broadcaster

Fan-out mutations to all clients in a room, across all coordinator nodes. Uses Redis pub/sub for single-region, NATS for multi-region.

---

## 11. Tech stack

### Why TypeScript/Bun — not Python or Rust — for the coordinator

Your bottleneck is network I/O (WebSocket connections), not CPU. Node/Bun handles tens of thousands of concurrent WebSocket connections natively. Python's GIL makes concurrent WebSockets painful. Rust is the right answer at 1M+ concurrent rooms, but it's months of extra development time with no benefit at your scale. Port the coordinator to Rust/Go later when you have actual load data to justify it.

### SDK

| Package | Purpose |
|---|---|
| TypeScript | Type-safe state shapes, excellent autocomplete for SDK consumers |
| Yjs | Battle-tested CRDT library, powers Notion and others |
| Zod | Runtime schema validation before ops hit the wire |
| Zustand / Valtio | Lightweight reactive state for the React hooks layer |

### Gateway + API server

| Package | Purpose |
|---|---|
| Bun | Fastest JS runtime, lower memory overhead than Node |
| Hono | Tiny type-safe HTTP framework, works great with Bun |
| uWebSockets.js | 10× faster WebSocket than Node's ws library |
| Jose | Standard JWT auth, works with any identity provider |
| Drizzle ORM | Type-safe SQL, no magic, excellent migrations |

### Coordination + messaging

| Package | Purpose |
|---|---|
| Redis / Valkey | Pub/sub across coordinator nodes, presence TTL |
| NATS JetStream | Durable message queue for op ordering at scale |
| Node.js / Bun (MVP) | Coordinator logic in TS first |
| Rust + Tokio (v2) | When you need 100k+ concurrent rooms per node |

### Storage

| Tool | Purpose |
|---|---|
| PostgreSQL | Event log, snapshots, metadata, rooms, API keys |
| Redis Streams | Write-ahead buffer — fast ack before Postgres write |
| S3 / Tigris | Cold event log archival, large snapshots |
| ClickHouse (v2) | Analytics queries over event log at billions of rows |

### Infrastructure

| Tool | Purpose |
|---|---|
| Docker + Compose | Local dev — all services in one command |
| Fly.io / Railway | Cheapest path to multi-region WebSocket servers |
| Prometheus + Grafana | Room metrics, op latency, connection counts |
| Vitest + Playwright | Unit tests for conflict logic, E2E for multi-tab sync |

---

## 12. Database schema

```sql
-- Full schema — packages/server/src/db/schema.sql

CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE rooms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id),
  external_id     TEXT NOT NULL,           -- the ID devs use: "workflow_123"
  current_version BIGINT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id, external_id)
);

-- Every mutation ever applied, hash-partitioned by room for query performance
CREATE TABLE room_events (
  id           UUID DEFAULT gen_random_uuid(),
  room_id      UUID REFERENCES rooms(id),
  user_id      TEXT NOT NULL,
  client_id    TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  version      BIGINT NOT NULL,
  event_type   TEXT NOT NULL,              -- "mutation", "presence", etc.
  patch        JSONB NOT NULL,             -- the actual change as operation array
  created_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (room_id, version)
) PARTITION BY HASH (room_id);

-- 8 partitions — tune this number based on your expected room count
CREATE TABLE room_events_0 PARTITION OF room_events FOR VALUES WITH (modulus 8, remainder 0);
CREATE TABLE room_events_1 PARTITION OF room_events FOR VALUES WITH (modulus 8, remainder 1);
CREATE TABLE room_events_2 PARTITION OF room_events FOR VALUES WITH (modulus 8, remainder 2);
CREATE TABLE room_events_3 PARTITION OF room_events FOR VALUES WITH (modulus 8, remainder 3);
CREATE TABLE room_events_4 PARTITION OF room_events FOR VALUES WITH (modulus 8, remainder 4);
CREATE TABLE room_events_5 PARTITION OF room_events FOR VALUES WITH (modulus 8, remainder 5);
CREATE TABLE room_events_6 PARTITION OF room_events FOR VALUES WITH (modulus 8, remainder 6);
CREATE TABLE room_events_7 PARTITION OF room_events FOR VALUES WITH (modulus 8, remainder 7);

-- Periodic snapshots so we don't replay from event 1
CREATE TABLE room_snapshots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID REFERENCES rooms(id),
  version    BIGINT NOT NULL,
  state      JSONB NOT NULL,               -- full room state at this version
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (room_id, version)
);

-- Room membership and permissions
CREATE TABLE room_members (
  room_id    UUID REFERENCES rooms(id),
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'editor', -- viewer | editor | admin
  joined_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

-- Indexes for the two most common query patterns
CREATE INDEX ON room_events (room_id, version);
CREATE INDEX ON room_snapshots (room_id, version DESC);
```

---

## 13. Wire protocol

### Client sends a mutation

```json
{
  "type": "mutation",
  "roomId": "workflow_123",
  "clientId": "client_1",
  "baseVersion": 100,
  "operationId": "op_abc",
  "operations": [
    {
      "op": "update",
      "path": "nodes.node_1.x",
      "value": 200
    },
    {
      "op": "update",
      "path": "nodes.node_1.y",
      "value": 100
    }
  ]
}
```

Note: operations are per-field (not per-object) so conflict strategies can apply at the field level.

### Server acknowledges

```json
{
  "type": "mutation_ack",
  "operationId": "op_abc",
  "serverVersion": 101,
  "status": "accepted",
  "transformedOps": [...]
}
```

The `transformedOps` field is how the server tells the client how its operations were transformed (rebased) if the client was behind. The client applies these to its local pending queue.

### Server broadcasts to all others in the room

```json
{
  "type": "mutation_broadcast",
  "roomId": "workflow_123",
  "serverVersion": 101,
  "userId": "user_1",
  "operations": [
    {
      "op": "update",
      "path": "nodes.node_1.x",
      "value": 200
    }
  ]
}
```

### Client sends presence

```json
{
  "type": "presence",
  "data": {
    "cursor": { "x": 200, "y": 400 },
    "selectedNodeId": "node_1",
    "status": "editing"
  }
}
```

### Server broadcasts presence

```json
{
  "type": "presence_broadcast",
  "userId": "user_1",
  "clientId": "client_1",
  "data": {
    "cursor": { "x": 200, "y": 400 },
    "selectedNodeId": "node_1"
  },
  "ts": 1747390800000
}
```

### Room init (sent to a newly joined client)

```json
{
  "type": "room_init",
  "version": 1842,
  "state": { "nodes": {}, "edges": {} },
  "connectedUsers": [
    { "userId": "user_2", "presence": { "cursor": { "x": 100, "y": 200 } } }
  ]
}
```

---

## 14. Starter implementation

### Monorepo structure

```
collab-engine/
├── packages/
│   ├── server/          ← coordinator + gateway (Bun + uWS)
│   ├── sdk/             ← @collab/client (TypeScript)
│   └── react/           ← @collab/react (hooks)
├── apps/
│   └── demo/            ← workflow builder demo (Next.js)
├── docker-compose.yml
└── package.json         ← workspace root
```

### docker-compose.yml — spin up everything locally

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: collab
      POSTGRES_USER: collab
      POSTGRES_PASSWORD: collab
    ports: ["5432:5432"]
    volumes: ["pg_data:/var/lib/postgresql/data"]

  redis:
    image: valkey/valkey:7-alpine
    ports: ["6379:6379"]

  server:
    build: ./packages/server
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://collab:collab@postgres:5432/collab
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev_secret_change_in_prod
    depends_on: [postgres, redis]

volumes:
  pg_data:
```

### Server entry point (packages/server/src/index.ts)

```typescript
import { App, WebSocket } from "uWebSockets.js";
import { createClient } from "redis";
import { RoomCoordinator } from "./coordinator";
import { verifyToken } from "./auth";
import { db } from "./db";

// Each connected client gets this attached to the WebSocket
interface ClientData {
  userId: string;
  clientId: string;
  roomId: string;
}

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const coordinator = new RoomCoordinator(db, redis);

const app = App();

app.ws<ClientData>("/:roomExternalId", {
  // Validate auth before upgrading HTTP → WebSocket
  upgrade: async (res, req, context) => {
    const token = req.getHeader("authorization").replace("Bearer ", "");
    const roomExternalId = req.getParameter(0);

    try {
      const payload = await verifyToken(token);

      res.upgrade(
        {
          userId: payload.sub,
          clientId: crypto.randomUUID(),
          roomId: roomExternalId,
        },
        req.getHeader("sec-websocket-key"),
        req.getHeader("sec-websocket-protocol"),
        req.getHeader("sec-websocket-extensions"),
        context
      );
    } catch {
      res.writeStatus("401").end("Unauthorized");
    }
  },

  open: async (ws) => {
    const { userId, clientId, roomId } = ws.getUserData();

    // Load room state: latest snapshot + events since snapshot
    const roomState = await coordinator.loadRoom(roomId);

    // Subscribe this socket to the room's Redis pub/sub channel
    ws.subscribe(roomId);

    // Send current state to the joining client
    ws.send(JSON.stringify({
      type: "room_init",
      version: roomState.version,
      state: roomState.state,
      connectedUsers: roomState.connectedUsers,
    }));

    // Tell everyone else this user joined
    coordinator.onClientJoin(roomId, userId, clientId);
  },

  message: async (ws, message, isBinary) => {
    const { userId, clientId, roomId } = ws.getUserData();
    const msg = JSON.parse(Buffer.from(message).toString());

    if (msg.type === "mutation") {
      await handleMutation(ws, msg, userId, clientId, roomId);
    } else if (msg.type === "presence") {
      await handlePresence(ws, msg, userId, clientId, roomId);
    }
  },

  close: (ws) => {
    const { userId, clientId, roomId } = ws.getUserData();
    coordinator.onClientLeave(roomId, userId, clientId);
  },
});

async function handleMutation(ws, msg, userId, clientId, roomId) {
  const { operationId, baseVersion, operations } = msg;

  // Coordinator does the hard work:
  // 1. Check if baseVersion is stale, transform ops if needed
  // 2. Apply conflict resolution per field
  // 3. Increment room version
  // 4. Write to event store
  // 5. Return server-assigned version + transformed ops
  const result = await coordinator.applyMutation({
    roomId,
    userId,
    clientId,
    operationId,
    baseVersion,
    operations,
  });

  if (result.status === "accepted") {
    // Ack the original sender
    ws.send(JSON.stringify({
      type: "mutation_ack",
      operationId,
      serverVersion: result.serverVersion,
      transformedOps: result.transformedOperations,
      status: "accepted",
    }));

    // Broadcast to everyone else in the room via Redis pub/sub
    // This reaches clients connected to OTHER server nodes too
    await redis.publish(roomId, JSON.stringify({
      type: "mutation_broadcast",
      serverVersion: result.serverVersion,
      operations: result.transformedOperations,
      userId,
    }));
  } else {
    ws.send(JSON.stringify({
      type: "mutation_ack",
      operationId,
      status: "rejected",
      reason: result.reason,
    }));
  }
}

async function handlePresence(ws, msg, userId, clientId, roomId) {
  // Presence is fire-and-forget — no ack, no storage
  // Just publish to Redis so other nodes fan it out
  await redis.publish(`presence:${roomId}`, JSON.stringify({
    type: "presence_broadcast",
    userId,
    clientId,
    data: msg.data,
    ts: Date.now(),
  }));
}

app.listen(3000, () => console.log("Coordinator running on :3000"));
```

### Room Coordinator (packages/server/src/coordinator.ts)

```typescript
import * as Y from "yjs";

interface Operation {
  op: "insert" | "update" | "delete";
  path: string;   // dot-notation: "nodes.node_1.x"
  value?: unknown;
}

interface CollectionConfig {
  fields?: Record<string, {
    strategy: "lww" | "crdt-text" | "custom";
    resolver?: (current: unknown, incoming: unknown, meta: ConflictMeta) => unknown;
  }>;
  conflictResolver?: (current: unknown, incoming: unknown) => unknown;
}

interface ConflictMeta {
  currentVersion: number;
  incomingVersion: number;
  userId: string;
  timestamp: number;
}

export class RoomCoordinator {
  // In-memory room state cache — evicted when room goes idle
  private roomCache = new Map<string, {
    version: number;
    state: Record<string, unknown>;
    ydoc: Y.Doc;
    lastAccess: number;
  }>();

  // Developer-defined collection schemas
  private collectionConfigs = new Map<string, CollectionConfig>();

  constructor(private db, private redis) {}

  defineCollection(name: string, config: CollectionConfig) {
    this.collectionConfigs.set(name, config);
  }

  async loadRoom(roomExternalId: string) {
    // Check in-memory cache first
    if (this.roomCache.has(roomExternalId)) {
      const cached = this.roomCache.get(roomExternalId)!;
      cached.lastAccess = Date.now();
      return { version: cached.version, state: cached.state, connectedUsers: [] };
    }

    // Load latest snapshot from DB
    const snapshot = await this.db.query(
      `SELECT version, state FROM room_snapshots
       WHERE room_id = (SELECT id FROM rooms WHERE external_id = $1)
       ORDER BY version DESC LIMIT 1`,
      [roomExternalId]
    );

    let state = snapshot?.state ?? {};
    let fromVersion = snapshot?.version ?? 0;

    // Replay events since snapshot to rebuild current state
    const events = await this.db.query(
      `SELECT version, patch FROM room_events
       WHERE room_id = (SELECT id FROM rooms WHERE external_id = $1)
         AND version > $2
       ORDER BY version ASC`,
      [roomExternalId, fromVersion]
    );

    const ydoc = new Y.Doc();
    for (const event of events) {
      state = this.applyPatch(state, event.patch, ydoc);
      fromVersion = event.version;
    }

    this.roomCache.set(roomExternalId, {
      version: fromVersion,
      state,
      ydoc,
      lastAccess: Date.now(),
    });

    return { version: fromVersion, state, connectedUsers: [] };
  }

  async applyMutation(params: {
    roomId: string;
    userId: string;
    clientId: string;
    operationId: string;
    baseVersion: number;
    operations: Operation[];
  }) {
    const { roomId, userId, baseVersion, operations, operationId } = params;
    const room = this.roomCache.get(roomId);
    if (!room) return { status: "rejected", reason: "room_not_loaded" };

    // If client is behind, transform their ops against what happened since
    // For LWW fields this is a no-op. For CRDT fields, Yjs handles it automatically.
    const transformedOps = baseVersion < room.version
      ? this.transformOperations(operations, baseVersion, room.version, room.state)
      : operations;

    // Apply each operation with the per-field conflict strategy
    let newState = { ...room.state };
    for (const op of transformedOps) {
      newState = this.applyOperation(newState, op, room.ydoc, {
        currentVersion: room.version,
        incomingVersion: baseVersion,
        userId,
        timestamp: Date.now(),
      });
    }

    const serverVersion = room.version + 1;

    // Write to event store
    await this.db.query(
      `INSERT INTO room_events (room_id, user_id, client_id, operation_id, version, event_type, patch)
       VALUES ((SELECT id FROM rooms WHERE external_id = $1), $2, $3, $4, $5, 'mutation', $6)`,
      [roomId, userId, params.clientId, operationId, serverVersion, JSON.stringify(transformedOps)]
    );

    // Update cache
    room.version = serverVersion;
    room.state = newState;
    room.lastAccess = Date.now();

    // Trigger snapshot every 100 events
    if (serverVersion % 100 === 0) {
      this.saveSnapshot(roomId, serverVersion, newState).catch(console.error);
    }

    return {
      status: "accepted",
      serverVersion,
      transformedOperations: transformedOps,
    };
  }

  private applyOperation(
    state: Record<string, unknown>,
    op: Operation,
    ydoc: Y.Doc,
    meta: ConflictMeta
  ): Record<string, unknown> {
    const pathParts = op.path.split(".");
    const collection = pathParts[0];   // e.g. "nodes"
    const config = this.collectionConfigs.get(collection);

    if (op.op === "update" && config?.fields) {
      const fieldName = pathParts[pathParts.length - 1];  // e.g. "x"
      const fieldConfig = config.fields[fieldName];

      if (fieldConfig?.strategy === "crdt-text") {
        // Delegate to Yjs — it handles concurrent text edits automatically
        const ytext = ydoc.getText(op.path);
        Y.applyUpdate(ydoc, op.value as Uint8Array);
        return this.setPath(state, op.path, ytext.toString());
      }

      if (fieldConfig?.strategy === "custom" && fieldConfig.resolver) {
        const current = this.getPath(state, op.path);
        const resolved = fieldConfig.resolver(current, op.value, meta);
        return this.setPath(state, op.path, resolved);
      }
    }

    // Default: Last Write Wins
    if (op.op === "update" || op.op === "insert") {
      return this.setPath(state, op.path, op.value);
    }
    if (op.op === "delete") {
      return this.deletePath(state, op.path);
    }

    return state;
  }

  private transformOperations(
    ops: Operation[],
    baseVersion: number,
    currentVersion: number,
    currentState: Record<string, unknown>
  ): Operation[] {
    // For LWW: ops are fine as-is (latest timestamp wins)
    // For CRDT: Yjs handles transformation internally via applyUpdate
    // For custom: the resolver receives both current and incoming values
    // MVP: pass through — per-field strategy handles each case
    return ops;
  }

  private async saveSnapshot(roomId: string, version: number, state: unknown) {
    await this.db.query(
      `INSERT INTO room_snapshots (room_id, version, state)
       VALUES ((SELECT id FROM rooms WHERE external_id = $1), $2, $3)
       ON CONFLICT (room_id, version) DO NOTHING`,
      [roomId, version, JSON.stringify(state)]
    );
  }

  // Deep path helpers for dot-notation paths
  private getPath(obj: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce((acc: any, key) => acc?.[key], obj);
  }

  private setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
    const keys = path.split(".");
    const result = JSON.parse(JSON.stringify(obj));
    let curr: any = result;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!curr[keys[i]]) curr[keys[i]] = {};
      curr = curr[keys[i]];
    }
    curr[keys[keys.length - 1]] = value;
    return result;
  }

  private deletePath(obj: Record<string, unknown>, path: string): Record<string, unknown> {
    const keys = path.split(".");
    const result = JSON.parse(JSON.stringify(obj));
    let curr: any = result;
    for (let i = 0; i < keys.length - 1; i++) curr = curr?.[keys[i]];
    delete curr?.[keys[keys.length - 1]];
    return result;
  }

  private applyPatch(state: Record<string, unknown>, patch: Operation[], ydoc: Y.Doc): Record<string, unknown> {
    let s = state;
    for (const op of patch) {
      s = this.applyOperation(s, op, ydoc, { currentVersion: 0, incomingVersion: 0, userId: "", timestamp: 0 });
    }
    return s;
  }

  onClientJoin(roomId: string, userId: string, clientId: string) {
    this.redis.publish(roomId, JSON.stringify({
      type: "user_joined", userId, clientId
    }));
  }

  onClientLeave(roomId: string, userId: string, clientId: string) {
    this.redis.publish(roomId, JSON.stringify({
      type: "user_left", userId, clientId
    }));
    // Save snapshot on room idle (last user leaving)
    this.redis.get(`room:connections:${roomId}`).then((count: string | null) => {
      if (!count || parseInt(count) <= 1) {
        const room = this.roomCache.get(roomId);
        if (room) {
          this.saveSnapshot(roomId, room.version, room.state).catch(console.error);
        }
      }
    });
  }
}
```

### SDK core (packages/sdk/src/client.ts)

```typescript
import { z } from "zod";

export interface CollabClientOptions {
  serverUrl: string;
  authToken: string;
}

export interface RoomOptions {
  schema?: z.ZodType;  // Optional: validate state shape on mutations
}

type MessageHandler = (msg: unknown) => void;

export class CollabClient {
  constructor(private options: CollabClientOptions) {}

  room(roomId: string, opts?: RoomOptions): CollabRoom {
    return new CollabRoom(roomId, this.options, opts);
  }
}

export class CollabRoom {
  private ws: WebSocket | null = null;
  private version = 0;
  private state: Record<string, unknown> = {};

  // Operations sent but not yet acked by server — for optimistic rollback
  private pendingOps = new Map<string, {
    operations: unknown[];
    previousState: Record<string, unknown>;
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }>();

  private handlers = new Map<string, Set<MessageHandler>>();

  constructor(
    private roomId: string,
    private clientOptions: CollabClientOptions,
    private opts?: RoomOptions
  ) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(
        `${this.clientOptions.serverUrl}/${this.roomId}`,
        { headers: { Authorization: `Bearer ${this.clientOptions.authToken}` } }
      );

      this.ws.onopen = () => console.log(`Connected to room ${this.roomId}`);

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === "room_init") {
          this.version = msg.version;
          this.state = msg.state;
          this.emit("state_change", this.state);
          resolve();
        }

        if (msg.type === "mutation_ack") {
          const pending = this.pendingOps.get(msg.operationId);
          if (pending) {
            this.pendingOps.delete(msg.operationId);
            if (msg.status === "accepted") {
              this.version = msg.serverVersion;
              pending.resolve(msg);
            } else {
              // Roll back the optimistic update
              this.state = pending.previousState;
              this.emit("state_change", this.state);
              pending.reject(new Error(msg.reason));
            }
          }
        }

        if (msg.type === "mutation_broadcast") {
          // Another user's change arrived — apply it locally
          this.version = msg.serverVersion;
          this.applyOperationsLocally(msg.operations);
          this.emit("state_change", this.state);
        }

        if (msg.type === "presence_broadcast") {
          this.emit("presence_change", msg);
        }

        if (msg.type === "user_joined" || msg.type === "user_left") {
          this.emit("users_change", msg);
        }
      };

      this.ws.onerror = reject;
    });
  }

  // Collection API — what developers call
  get state_api() {
    const room = this;
    return {
      collection(name: string) {
        return {
          insert(id: string, data: Record<string, unknown>) {
            return room.mutate([{ op: "insert", path: `${name}.${id}`, value: data }]);
          },
          update(id: string, data: Partial<Record<string, unknown>>) {
            // Split into per-field operations so conflict strategies apply field-by-field
            const ops = Object.entries(data).map(([field, value]) => ({
              op: "update" as const,
              path: `${name}.${id}.${field}`,
              value,
            }));
            return room.mutate(ops);
          },
          delete(id: string) {
            return room.mutate([{ op: "delete", path: `${name}.${id}` }]);
          },
        };
      },
    };
  }

  presence = {
    update: (data: Record<string, unknown>, options?: { throttle?: number }) => {
      // Throttling is handled by the SDK before hitting the wire
      this.ws?.send(JSON.stringify({ type: "presence", data }));
    },
    onChange: (handler: MessageHandler) => {
      this.on("presence_change", handler);
    },
    lock: async (path: string) => {
      // Send a lock request — server applies custom mutex resolver
      const operationId = crypto.randomUUID();
      await this.mutate([{ op: "update", path, value: "__lock__" }]);
      return {
        acquired: true,
        release: () => this.mutate([{ op: "update", path, value: null }]),
      };
    },
  };

  private async mutate(operations: unknown[]): Promise<unknown> {
    const operationId = crypto.randomUUID();

    // Validate against schema if provided
    if (this.opts?.schema) {
      try {
        this.opts.schema.parse(this.state);
      } catch (err) {
        throw new Error(`Schema validation failed: ${err}`);
      }
    }

    // Snapshot state before optimistic update (for rollback)
    const previousState = JSON.parse(JSON.stringify(this.state));

    // Optimistic update — apply locally immediately so UI feels instant
    this.applyOperationsLocally(operations as any);
    this.emit("state_change", this.state);

    return new Promise((resolve, reject) => {
      this.pendingOps.set(operationId, { operations, previousState, resolve, reject });

      this.ws?.send(JSON.stringify({
        type: "mutation",
        operationId,
        baseVersion: this.version,
        operations,
      }));

      // Timeout after 10s — reject and rollback
      setTimeout(() => {
        if (this.pendingOps.has(operationId)) {
          const pending = this.pendingOps.get(operationId)!;
          this.pendingOps.delete(operationId);
          this.state = pending.previousState;
          this.emit("state_change", this.state);
          reject(new Error("Mutation timed out"));
        }
      }, 10_000);
    });
  }

  private applyOperationsLocally(operations: Array<{op: string; path: string; value?: unknown}>) {
    for (const op of operations) {
      const pathParts = op.path.split(".");
      let obj: any = this.state;
      for (let i = 0; i < pathParts.length - 1; i++) {
        if (!obj[pathParts[i]]) obj[pathParts[i]] = {};
        obj = obj[pathParts[i]];
      }
      const lastKey = pathParts[pathParts.length - 1];
      if (op.op === "delete") delete obj[lastKey];
      else obj[lastKey] = op.value;
    }
  }

  getState() { return this.state; }
  getVersion() { return this.version; }

  on(event: string, handler: MessageHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  private emit(event: string, data: unknown) {
    this.handlers.get(event)?.forEach(h => h(data));
  }

  disconnect() { this.ws?.close(); }
}
```

### React hook (packages/react/src/useRoom.ts)

```typescript
import { useState, useEffect, useCallback, useRef } from "react";
import { CollabRoom, CollabClient } from "@collab/sdk";

interface UseRoomResult<S> {
  state: S;
  version: number;
  connected: boolean;
  users: string[];
  cursors: Record<string, { x: number; y: number }>;
  insert: (collection: string, id: string, data: Partial<S>) => Promise<void>;
  update: (collection: string, id: string, data: Partial<S>) => Promise<void>;
  remove: (collection: string, id: string) => Promise<void>;
  updatePresence: (data: Record<string, unknown>) => void;
}

export function useRoom<S = Record<string, unknown>>(
  client: CollabClient,
  roomId: string
): UseRoomResult<S> {
  const roomRef = useRef<CollabRoom | null>(null);
  const [state, setState] = useState<S>({} as S);
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState<string[]>([]);
  const [cursors, setCursors] = useState<Record<string, {x: number; y: number}>>({});

  useEffect(() => {
    const room = client.room(roomId);
    roomRef.current = room;

    room.connect().then(() => setConnected(true));

    const unsubState = room.on("state_change", (newState) => {
      setState(newState as S);
      setVersion(room.getVersion());
    });

    const unsubPresence = room.on("presence_change", (msg: any) => {
      if (msg.data?.cursor) {
        setCursors(prev => ({ ...prev, [msg.userId]: msg.data.cursor }));
      }
    });

    const unsubUsers = room.on("users_change", (msg: any) => {
      setUsers(prev =>
        msg.type === "user_joined"
          ? [...prev, msg.userId]
          : prev.filter(u => u !== msg.userId)
      );
    });

    return () => {
      unsubState();
      unsubPresence();
      unsubUsers();
      room.disconnect();
    };
  }, [client, roomId]);

  const insert = useCallback(async (collection: string, id: string, data: any) => {
    await roomRef.current?.state_api.collection(collection).insert(id, data);
  }, []);

  const update = useCallback(async (collection: string, id: string, data: any) => {
    await roomRef.current?.state_api.collection(collection).update(id, data);
  }, []);

  const remove = useCallback(async (collection: string, id: string) => {
    await roomRef.current?.state_api.collection(collection).delete(id);
  }, []);

  const updatePresence = useCallback((data: Record<string, unknown>) => {
    roomRef.current?.presence.update(data);
  }, []);

  return { state, version, connected, users, cursors, insert, update, remove, updatePresence };
}
```

### Custom conflict rules — developer-facing API examples

```typescript
// State-machine resolver: tasks can only move status forward
function statusResolver(current: string, incoming: string, meta: ConflictMeta) {
  const order = ["todo", "in_progress", "review", "done"];
  const currentRank = order.indexOf(current);
  const incomingRank = order.indexOf(incoming);

  // Never allow moving a task backward if it was already moved forward concurrently
  if (incomingRank < currentRank) return current;
  return incoming;
}

// Mutex lock resolver: only the lock owner can release the lock
function lockResolver(current: string | null, incoming: string | null, meta: ConflictMeta) {
  // If locked by someone else, reject the incoming change
  if (current !== null && current !== meta.userId) return current;
  return incoming;
}

// Layer order resolver: deterministic tiebreak for concurrent reorders
function layerOrderResolver(current: string[], incoming: string[], meta: ConflictMeta) {
  // Higher version wins; if same version, sort by userId as tiebreak
  if (meta.incomingVersion > meta.currentVersion) return incoming;
  if (meta.incomingVersion === meta.currentVersion) {
    return meta.userId > "midpoint" ? incoming : current; // deterministic
  }
  return current;
}

// Register all collection schemas
coordinator.defineCollection("tasks", {
  fields: {
    title:       { strategy: "crdt-text" },
    status:      { strategy: "custom", resolver: statusResolver },
    assignee:    { strategy: "lww" },
    priority:    { strategy: "lww" },
    description: { strategy: "crdt-text" },
  }
});

coordinator.defineCollection("nodes", {
  fields: {
    x:         { strategy: "lww" },
    y:         { strategy: "lww" },
    label:     { strategy: "crdt-text" },
    config:    { strategy: "lww" },
    locked_by: { strategy: "custom", resolver: lockResolver },
  }
});

coordinator.defineCollection("board", {
  fields: {
    layers: { strategy: "custom", resolver: layerOrderResolver },
  }
});
```

### Demo app — workflow builder canvas (apps/demo/src/WorkflowCanvas.tsx)

```tsx
import { useRoom } from "@collab/react";
import { client } from "./collabClient";

interface Node {
  id: string;
  x: number;
  y: number;
  label: string;
}

interface WorkflowState {
  nodes: Record<string, Node>;
  edges: Record<string, { source: string; target: string }>;
}

export function WorkflowCanvas() {
  const {
    state,
    users,
    cursors,
    insert,
    update,
    remove,
    updatePresence,
    connected,
  } = useRoom<WorkflowState>(client, "workflow_123");

  const nodes = Object.values(state.nodes ?? {});

  const handleNodeMove = async (id: string, x: number, y: number) => {
    // Field-level update — server applies LWW for x and y independently
    await update("nodes", id, { x, y });
    updatePresence({ cursor: { x, y }, selectedNodeId: id });
  };

  const addNode = async () => {
    const id = crypto.randomUUID();
    await insert("nodes", id, {
      id,
      x: Math.random() * 600,
      y: Math.random() * 400,
      label: "New node",
    });
  };

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100vh" }}
      onMouseMove={e => updatePresence({ cursor: { x: e.clientX, y: e.clientY } })}
    >
      {/* Connection status */}
      <div style={{ position: "absolute", top: 8, left: 8, fontSize: 12 }}>
        {connected ? `Connected · ${users.length + 1} users` : "Connecting..."}
      </div>

      {/* Other users' live cursors */}
      {Object.entries(cursors).map(([userId, pos]) => (
        <div key={userId} style={{
          position: "absolute",
          left: pos.x,
          top: pos.y,
          pointerEvents: "none",
          fontSize: 11,
          color: "#7F77DD",
        }}>
          ▲ {userId.slice(0, 6)}
        </div>
      ))}

      {/* Canvas nodes */}
      {nodes.map(node => (
        <div
          key={node.id}
          draggable
          onDragEnd={e => handleNodeMove(node.id, e.clientX, e.clientY)}
          style={{
            position: "absolute",
            left: node.x,
            top: node.y,
            padding: "8px 14px",
            background: "white",
            border: "1px solid #ccc",
            borderRadius: 8,
            cursor: "grab",
            fontSize: 13,
          }}
        >
          {node.label}
        </div>
      ))}

      <button
        onClick={addNode}
        style={{ position: "absolute", bottom: 20, right: 20 }}
      >
        + Add node
      </button>
    </div>
  );
}
```

### Build order

Follow this exact sequence. Each step proves the previous one before adding complexity:

1. `docker-compose up` — get Postgres + Redis running
2. Apply the SQL schema (`schema.sql`)
3. Build `packages/server` — get a single WebSocket endpoint accepting connections and broadcasting mutations between two browser tabs
4. Build `packages/sdk` — implement `connect()`, `state_api.collection().update()`, `presence.update()`
5. Build the demo app (`apps/demo`) — prove two browser tabs sync correctly with live cursors and node movement
6. Add `packages/react` with `useRoom` hook
7. Add event persistence — write to `room_events` on every mutation
8. Add snapshot trigger — save snapshot every 100 events and on room idle
9. Test reconnect — close tab, reopen, verify state is fully restored
10. Add offline queue — buffer mutations when disconnected, replay on reconnect
11. Add schema validation with Zod
12. Add permission enforcement on the server

---

## 15. Product decisions — what NOT to build first

### Avoid in v1

- Full document editor (start with graph/canvas — harder, more unique)
- Database replacement
- Mobile SDK
- Peer-to-peer sync
- Enterprise SSO
- CRDT from scratch (use Yjs)
- Video/audio collaboration
- Full offline-first engine
- Vector clocks and multi-region active/active

### Build first

- WebSocket rooms
- JSON state sync with field-level conflict strategies
- Graph/canvas objects (nodes + edges)
- Presence with throttling
- Persistence (event log + snapshots)
- Replay timeline
- TypeScript SDK + React hooks

### Why canvas/graph first, not documents

Documents look simpler but text editing via CRDT requires the most nuanced merge logic. Canvas/graph state is actually simpler to get right (positions are LWW, labels can be CRDT) and produces a more compelling demo — you can see collaboration happening in real time on a visual canvas in a way that is immediately impressive.

---

## 16. Business case

Building realtime collaboration properly is painful. Your product saves developers from:

- WebSocket infrastructure
- Reconnection logic
- State conflict resolution
- Presence systems
- Event history
- Collaborative debugging
- Scaling rooms
- Persistence design
- Sync protocol design

The benefit is exact: **"Add multiplayer collaboration to your app in days instead of months."**

Developers pay to avoid this. The infrastructure problem is well-understood and consistently underestimated — every team that tries to build it themselves discovers new edge cases every week. Your product handles all of them by design.

---

## 17. Target customers

Start with developers building:

- Workflow builders (n8n-style)
- Diagramming tools (Lucidchart-style)
- Whiteboards (Miro-style)
- Internal tools (Retool-style)
- AI canvas products (LangFlow/Dify-style)
- Collaborative dashboards
- No-code builders
- Visual editors

This is a specific wedge. These are all products where collaboration is a feature, not the whole product — developers have strong motivation to use a library rather than build it themselves.

---

## 18. Open-source self-hosting model

Oculus is free, open-source, and self-hosted. The core project should focus on:

- Docker-first local and production deployments
- Postgres-backed durability
- Optional Redis/NATS infrastructure for larger installations
- Bring-your-own auth and role context
- Migration, backup, restore, and observability docs
- Community support and clear extension points

Hosted accounts, paid tiers, billing, and Oculus-issued API keys are out of scope for the core project. Apps built on Oculus may add their own product-specific auth, tenancy, and billing outside the engine.

---

## 19. Roadmap

### Phase 1 — Local prototype
Build a demo with WebSocket server, React canvas, two browser tabs syncing, live cursors, node movement, and event log.

**Goal:** Prove realtime sync works end-to-end.

### Phase 2 — Persistent rooms
Add Postgres, room snapshots, event persistence, and reconnect state recovery.

**Goal:** Reload room and preserve full state.

### Phase 3 — Universal SDK
Build `@oculus/sdk`, framework wrappers, and a universal operation model for objects, fields, text, ordered lists, locks, and tombstones.

**Goal:** External developer can integrate it in their own app.

### Phase 4 — CRDT text and mixed conflict strategies
Add Yjs-backed `crdt-text`, field-level strategies, ordered list/tree operations, and custom resolvers.

**Goal:** Support documents, node editors, whiteboards, and Figma-like design tools from the same engine.

### Phase 5 — Replay
Build event timeline, state replay, session playback, diff view between two versions.

**Goal:** Make debugging and history a product differentiator. Make the replay UI so useful that developers use it as their primary debugging tool.

### Phase 5.5 — Webhooks + integrations
Add webhook subscriptions for room events: `node.created`, `room.empty`, `session.ended`. Let developers connect their rooms to Zapier, Slack, and other tools.

**Goal:** Make the platform composable with other products.

### Phase 6 — Permissions
Add room roles (viewer, editor, admin), field-level permission rules, server-side enforcement.

**Goal:** Make it usable in real production apps with real user roles.

### Phase 7 — Offline support
Add local operation queue, reconnect merge, conflict handling for queued ops, version reconciliation.

**Goal:** Make it resilient for mobile and poor-connection users.

### Phase 8 — Self-hosted scale-out
Add production Docker Compose guidance, migrations, backups, readiness checks, Redis/NATS fan-out, and operational docs.

**Goal:** Make Oculus straightforward to run and operate outside a hosted control plane.

### Phase 9 — Multi-region
Add vector clocks or hybrid logical clocks, active/active multi-region rooms, region-aware event storage.

**Goal:** Sub-100ms latency for users on any continent.

---

## 20. Demo app spec

Build a polished demo called **Collaborative Workflow Builder**.

Features to demonstrate:
- Drag nodes across canvas
- Connect nodes with edges
- Edit node labels inline
- See other users' cursors in real time
- See selected node indicators per user
- Undo/redo
- Event history panel (scrollable list of every mutation)
- Replay button (scrub through timeline and watch session replay)
- Connection status indicator
- Offline mode indicator + reconnect

This demo becomes your marketing. It immediately explains what the product does without any text description — someone watching it understands in 10 seconds that they can have this in their app without building it.

Deploy it publicly. Link it from the docs homepage. Let developers join the same shared room and experience it together.
