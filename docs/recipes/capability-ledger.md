# Capability Ledger

This ledger tracks what Oculus needs for three engine-credibility environments: whiteboards, design canvases, and workflow builders.

## Summary

Oculus is already strong at realtime shared state, field-level updates, text fields, list order, tree moves, presence transport, permissions, replay, persistence, and offline recovery. It is not yet strong at expressing user intent across many low-level operations, reversing changes, typed awareness conventions, comments, assets, or workflow-specific constraints.

The recommended next implementation sequence is:

1. Expand Playwright coverage for transactions, undo/redo, awareness, comments, assets, shapes, schema validation, and edge validation.
2. Build the polished multi-environment demo so the engine capabilities are visible.
3. Revisit advanced CRDT maps/arrays only if richer demos reveal conflicts that current primitives cannot solve.

## Ledger

| Capability | Whiteboard | Design Canvas | Workflow Builder | Current Support | Status | Priority | Notes |
|---|---|---|---|---|---|---|---|
| Realtime room connection | Required | Required | Required | WebSocket room server and SDK room client | Done | P0 | Core room lifecycle is implemented. |
| Shared object collections | Required | Required | Required | `room.collection`, `create`, `change`, `remove` | Done | P0 | Works for shapes, nodes, edges, pages, comments, and metadata records. |
| Field-level object updates | Required | Required | Required | `set` operations and collection field patches | Done | P0 | Good base for positions, labels, metadata, and config. |
| Collaborative text fields | Required | Required | Useful | `text` operation with CRDT-backed server field strategy | Done | P0 | Strong for labels, sticky notes, titles, and node names. |
| Ordered lists/layers | Required | Required | Useful | `room.list(path).move(from, to)` | Done | P0 | Supports z-order, layer order, card order, and page tabs. |
| Tree hierarchy | Useful | Required | Useful | `room.tree(path).move(...)` | Done | P0 | Supports Figma-like layer trees and grouped structures. |
| Tombstone deletes | Required | Required | Required | `collection.remove(..., { preserveHistory: true })` | Done | P0 | Protects deleted records from stale offline child updates. |
| Optimistic updates and rollback | Required | Required | Required | SDK optimistic mutation flow with rollback on rejection | Done | P0 | Important for fluid canvas interactions. |
| Offline queue and reconnect | Required | Required | Required | SDK queue flush after fresh `room_init` | Done | P0 | Needs more Playwright coverage, but engine support exists. |
| Presence transport | Required | Required | Required | Arbitrary `presence.update(...)` payloads | Done | P0 | Transport exists and awareness helpers provide typed app vocabulary. |
| Cursor awareness | Required | Required | Useful | `room.awareness.updateCursor(...)` | Done | P0 | Cursor payloads now have a dedicated helper. |
| Viewport awareness | Required | Required | Useful | `room.awareness.updateViewport(...)` | Done | P0 | Supports x/y/zoom and optional page id. |
| Selection awareness | Required | Required | Required | `room.awareness.updateSelection(...)` | Done | P0 | Supports selected object ids. |
| Active tool awareness | Required | Required | Useful | `room.awareness.updateTool(...)` | Done | P1 | Useful for presentation-grade demos. |
| Presence throttling | Required | Required | Useful | `presence.update(data, { throttle })` | Done | P0 | Good enough for current stage. |
| Field locks | Useful | Required | Useful | `collection.lock` and low-level `presence.lock` | Done | P1 | Naming is slightly confusing because lock writes durable state. |
| Operation-level permissions | Useful | Required | Required | Server permission rules by path/op/role | Done | P0 | Needs demo recipes for common roles. |
| Event history | Required | Required | Required | `room.getEvents()` | Done | P0 | Raw events exist. |
| Replay at version | Useful | Required | Required | `room.replayAt(version)` | Done | P0 | Works from snapshots and events. |
| Replay diffs | Useful | Required | Required | `room.diffVersions(from, to)` | Done | P0 | Recently added. |
| Snapshot persistence | Required | Required | Required | Memory and Postgres event stores | Done | P0 | Durable with `DATABASE_URL`. |
| Snapshot compaction | Required | Required | Required | Configurable coordinator compaction and retention | Done | P0 | Recently added. |
| Idle room eviction | Required | Required | Required | `collectIdleRooms` lifecycle hook | Done | P1 | Hook exists; production scheduling/docs still needed. |
| Grouped transactions | Required | Required | Required | `room.transaction(...)` with event metadata | Done | P0 | Supports builder callback or operation array. |
| Transaction labels | Required | Required | Required | `MutationMetadata.label` stored with room events | Done | P0 | Event history can show app-language intent. |
| Transaction atomicity semantics | Required | Required | Required | Operation batch plus public transaction API | Done | P0 | Batches are accepted or rejected as one mutation. |
| Per-user undo/redo | Required | Required | Useful | `room.undo()`, `room.redo()` | Done | P0 | Client-scoped undo built from generated inverse operations. |
| Shared/global undo | Deferred | Deferred | Deferred | Not implemented | Deferred | P2 | Complex product semantics; defer. |
| Multi-object move/resize intent | Required | Required | Useful | `room.transaction(...)` groups many field updates | Done | P0 | Replay can show one labeled user intent. |
| Comments and annotations | Useful | Required | Useful | `room.comments(...)` | Done | P1 | Collection-backed helper for pins, object comments, and threads. |
| Asset references | Required | Required | Optional | `room.assets(...)` | Done | P1 | Metadata convention; storage remains bring-your-own. |
| Image/file binary storage | Useful | Required | Optional | Not provided | Deferred | P2 | Keep Oculus self-hosted and storage-agnostic for now. |
| Rich shape primitives | Required | Useful | Optional | `room.shapes(...)` | Done | P1 | Collection-backed helper for common canvas records. |
| Freehand stroke support | Required | Useful | No | `room.shapes().freehand(...)` | Done | P1 | Commit strokes in batches; see performance guide. |
| Connectors/edges | Required | Useful | Required | Demo has edges as collection | Partial | P0 | Need recipe schema and workflow validation helpers. |
| Ports and handles | Optional | Useful | Required | Can be modeled manually | Partial | P0 | Workflow recipe must define stable port ids. |
| Edge validation | Optional | Optional | Required | `defineRoom(..., { edgeValidators })` | Done | P0 | Validates source/target nodes and optional ports. |
| Node config forms | No | No | Required | Field updates cover config | Partial | P1 | Need schema examples and conflict guidance. |
| Schema validation | Useful | Useful | Required | SDK room schema and server `defineRoom({ schema })` | Done | P1 | Server rejects invalid next state before persistence. |
| Derived/ephemeral execution state | No | No | Required | Can be modeled manually | Partial | P1 | Need recipe guidance for durable config vs ephemeral run state. |
| Advanced CRDT maps/arrays | Useful | Required | Useful | Evaluation documented | Deferred | P1 | Keep out of public API until demos prove need. |
| Performance guidance for large rooms | Required | Required | Required | `performance.md` | Done | P1 | Covers batching, presence, freehand, snapshots, assets, and room size. |
| Server-side room configuration API | Required | Required | Required | `coordinator.defineRoom(...)` | Done | P0 | Groups collection strategies, permissions, and edge validators. |
| Playwright multi-environment coverage | Required | Required | Required | One workflow-ish e2e test exists | Partial | P1 | Expand after demo becomes switchable. |

## P0 Missing Or Partial Items

These are the immediate engine credibility gaps:

- Additional Playwright coverage for transactions, undo/redo, awareness, and workflow edge validation.
- Demo updates that actually showcase the new P0 APIs.

## P1 Missing Or Partial Items

These are important once the P0 engine story is strong:

- Expanded Playwright coverage for all recipe environments.
