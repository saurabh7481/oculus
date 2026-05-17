# Large Room Performance Guide

This guide covers practical performance rules for whiteboards, design canvases, and workflow builders built on Oculus.

## Mutation Batching

Use `room.transaction(...)` for user actions that update many fields.

Good examples:

- Move 20 selected shapes.
- Resize a frame and update its children.
- Connect a workflow node and update graph order.
- Import several objects at once.

Avoid sending one mutation per object when one user action has one intent. A single transaction produces better replay history, fewer WebSocket messages, and one undo entry.

## Presence And Awareness

Presence is ephemeral and should be throttled.

- Cursor movement: 30-60 ms throttle is usually enough.
- Viewport updates: send on pan/zoom end or at a low frequency.
- Selection/tool/editing target: send immediately; these change less often.

Use awareness helpers for common payloads:

```ts
room.awareness.updateCursor({ x, y }, { name, color });
room.awareness.updateViewport({ x, y, zoom, pageId });
room.awareness.updateSelection(selectedIds);
room.awareness.updateTool(activeTool);
room.awareness.updateEditing(path);
```

## Freehand Strokes

Do not send a mutation for every pointer point.

Recommended flow:

1. Keep in-progress stroke points locally during pointer movement.
2. Broadcast lightweight cursor/active-tool awareness while drawing.
3. Commit the final stroke as one shape record with `room.shapes().freehand(...)`.
4. For very long strokes, chunk points into batches of 50-200 points.

## Snapshots And Replay

Long-lived rooms should use snapshot compaction. The coordinator supports:

- `snapshotInterval`: how often to snapshot by version count.
- `snapshotRetention`: how many latest snapshots to keep.
- `collectIdleRooms(...)`: save and evict idle room state from memory.

Replay and replay diffs load from the nearest snapshot and then apply newer events.

## Asset References

Store bytes outside Oculus and sync metadata only.

Good asset records include:

- stable `id`
- `kind`
- `url`
- dimensions, if known
- `mimeType`
- app metadata such as `alt`, `source`, or `checksum`

## Room Size Guidance

Oculus currently syncs full room state on `room_init`. For large canvases, keep these constraints in mind:

- Prefer compact records over deeply nested blobs.
- Use object collections keyed by id.
- Keep binary data out of room state.
- Use tombstones only when offline safety is needed; compact old deleted records at the app layer if history retention allows it.
- Use transactions for imports and multi-select edits.

## Future Work

Large production rooms will eventually need viewport-scoped loading, partial subscriptions, or sharded room state. Those are not part of the current engine surface.
