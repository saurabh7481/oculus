# Collaboration Recipes

These recipes define what Oculus must support to be credible infrastructure for complex collaborative products.

The goal is not to make Oculus a whiteboard app, design tool, or workflow builder. The goal is to expose a small set of universal collaboration primitives that can power those environments without requiring app developers to understand raw operation paths, CRDT internals, or server merge strategies for common workflows.

## How To Read This Section

- `capability-ledger.md` is the scoreboard. It marks each engine capability as `Done`, `Partial`, `Missing`, or `Deferred`.
- `whiteboard.md` describes Excalidraw/Miro-style boards.
- `design-canvas.md` describes Figma-style design canvases.
- `workflow-builder.md` describes n8n/LangFlow-style node workflow builders.
- `performance.md` gives batching, presence, freehand, snapshot, and large-room guidance.
- `advanced-crdt-evaluation.md` records the current decision on Yjs maps/arrays.

## Status Labels

- `Done`: implemented, tested, and documented enough for app developers to use.
- `Partial`: possible with current primitives, but not ergonomic, typed, or fully documented.
- `Missing`: not implemented yet.
- `Deferred`: useful, but intentionally outside the next engine-credibility milestone.

## Priority Labels

- `P0`: required for engine credibility across the target environments.
- `P1`: important for serious apps and polished demos.
- `P2`: useful maturity work after the core engine story is solid.

## Current Direction

Oculus already has a credible base: realtime rooms, field operations, CRDT text fields, ordered lists, tree moves, presence, locks, permissions, event history, replay diffs, optimistic updates, offline queueing, durable storage, snapshots, compaction, and room lifecycle hooks.

The main gap is not raw sync. The next gap is presentation and proof: using the engine APIs in polished multi-environment demos and expanding Playwright coverage across those environments.
