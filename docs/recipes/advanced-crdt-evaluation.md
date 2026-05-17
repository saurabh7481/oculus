# Advanced CRDT Map And Array Evaluation

Oculus currently supports CRDT-backed text fields through Yjs. The next question is whether to expose CRDT maps and arrays for rich nested document, whiteboard, and design-canvas state.

## Current Position

Do not add public CRDT map/array APIs yet.

The existing field-level operation model covers most canvas and workflow state clearly:

- Object records use `collection`.
- Field changes use `set`.
- Text fields use `text` with CRDT support.
- Layer order uses `list`.
- Hierarchy uses `tree`.
- Multi-object intent uses `transaction`.

Adding map/array CRDTs too early would make the beginner path harder to teach and could leak engine internals into app code.

## Where CRDT Maps/Arrays May Help

Evaluate advanced CRDT structures when apps need:

- Concurrent editing inside rich nested documents.
- Deep component property maps with many simultaneous editors.
- Collaborative arrays where index-based moves are too conflict-prone.
- Embedded rich text blocks with nested annotations.
- Local-first editing where peers may merge without a central server.

## Risks

- Harder SDK mental model.
- More complex persistence and replay sidecar state.
- More difficult diff output because CRDT updates do not naturally map to app-language intent.
- More surface area for app developers to misuse.

## Recommended Evaluation Path

1. Build richer whiteboard/design/workflow demos using current primitives.
2. Document any specific conflict that current primitives cannot solve cleanly.
3. Prototype internal Yjs map/array support behind `room.apply(...)`.
4. Keep high-level helpers domain-neutral.
5. Only expose public helpers if at least two recipe environments need them.

## Decision For This Milestone

Advanced CRDT maps/arrays remain `Deferred for implementation` and `P1 for evaluation`. The engine should first prove comments, assets, schema validation, transactions, undo/redo, awareness, replay, and performance guidance.
