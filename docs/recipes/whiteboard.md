# Whiteboard Recipe

This recipe targets Excalidraw/Miro-style collaborative whiteboards: shapes, sticky notes, connectors, freehand strokes, live cursors, selections, layers, comments, replay, and offline-safe editing.

## Product Requirements

A credible whiteboard environment needs:

- Multiple users editing shapes at the same time.
- Live cursor, viewport, selected object, and active tool awareness.
- Shapes, sticky notes, text boxes, connectors, frames, and freehand strokes.
- Ordered layers for z-index.
- Multi-select move, resize, duplicate, delete, and group.
- Comments or annotations pinned to board coordinates or objects.
- Undo/redo for the current user's recent edits.
- Replayable history with human-readable event labels.
- Offline queueing that does not resurrect deleted objects.

## Recommended State Shape

```ts
type WhiteboardState = {
  shapes: Record<string, WhiteboardShape>;
  connectors: Record<string, WhiteboardConnector>;
  layers: string[];
  comments: Record<string, WhiteboardComment>;
};

type WhiteboardShape = {
  id: string;
  type: "rectangle" | "ellipse" | "sticky" | "text" | "frame" | "freehand";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  text?: string;
  points?: Array<{ x: number; y: number }>;
  style: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  };
  lockedBy?: string | null;
};

type WhiteboardConnector = {
  id: string;
  fromShapeId: string;
  toShapeId: string;
  label?: string;
};

type WhiteboardComment = {
  id: string;
  targetId?: string;
  x?: number;
  y?: number;
  body: string;
  resolved: boolean;
};
```

## Oculus Support Today

| Need | Support | Status |
|---|---|---|
| Shape create/update/delete | `room.collection("shapes")` | Done |
| Sticky note and text editing | `collection.text(id, "text")` with CRDT text | Done |
| Layer order | `room.list("layers").move(...)` | Done |
| Connectors | `room.collection("connectors")` | Partial |
| Freehand strokes | `room.shapes().freehand(...)` | Done |
| Live cursors | `room.awareness.updateCursor(...)` | Done |
| Viewport awareness | `room.awareness.updateViewport(...)` | Done |
| Selection awareness | `room.awareness.updateSelection(...)` | Done |
| Multi-object moves | `room.transaction(...)` | Done |
| Comments | `room.comments(...)` | Done |
| Undo/redo | `room.undo()` and `room.redo()` | Done |
| Transaction labels | `MutationMetadata.label` | Done |
| Asset references | `room.assets(...)` metadata records | Done |

## Missing P0 Capabilities

- Playwright coverage for whiteboard-specific transactions, undo/redo, and awareness.
- A demo environment that exercises shapes, sticky notes, layers, and multi-select moves.

## Missing P1 Capabilities

- Playwright coverage for comments, assets, shapes, and freehand strokes.
- A polished whiteboard demo environment that uses these helpers directly.

## Preferred SDK Shape

```ts
const board = client.room<WhiteboardState>("board_123");
const shapes = board.collection<WhiteboardShape>("shapes");

await board.transaction("Move selected shapes", async (tx) => {
  tx.change(shapes, "shape_1", { x: 120, y: 180 });
  tx.change(shapes, "shape_2", { x: 240, y: 180 });
});

board.awareness.updateSelection(["shape_1", "shape_2"]);
board.awareness.updateViewport({ x: 0, y: 0, zoom: 1.25 });

await board.undo();
```

This is now the recommended P0 SDK shape for whiteboard-style edits.

## Implementation Notes

Whiteboards should not require special engine operations for every shape type. Shapes, connectors, comments, and layers can stay as normal collections and lists. The missing engine layer is intent: grouping low-level field changes into transaction events that can be replayed, inspected, and undone.
