# Design Canvas Recipe

This recipe targets Figma-style collaborative design canvases: pages, frames, layers, groups, component-like objects, images, comments, locked edits, selection awareness, and precise replay history.

## Product Requirements

A credible design canvas environment needs:

- Pages and frames.
- Deep layer trees with parent/child ordering.
- Multi-select transforms across many objects.
- Text editing, renaming, and comments.
- Live cursors, selections, viewports, active tool, and editing target awareness.
- Object locks and role-based permissions.
- Asset references for images and imported media.
- Replay history that explains user intent instead of raw field paths.
- Undo/redo scoped to the current user's actions.
- Offline-safe deletes and deterministic reconnect behavior.

## Recommended State Shape

```ts
type DesignCanvasState = {
  pages: Record<string, DesignPage>;
  layers: Record<string, DesignNode>;
  tree: Record<string, DesignTreeNode>;
  zOrder: Record<string, string[]>;
  comments: Record<string, DesignComment>;
  assets: Record<string, AssetReference>;
};

type DesignNode = {
  id: string;
  pageId: string;
  type: "frame" | "group" | "rectangle" | "ellipse" | "text" | "image" | "component";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  name: string;
  text?: string;
  assetId?: string;
  style?: Record<string, unknown>;
  lockedBy?: string | null;
};

type DesignTreeNode = {
  id: string;
  parentId: string | null;
  children: string[];
};

type AssetReference = {
  id: string;
  kind: "image" | "font" | "file";
  url: string;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
};
```

## Oculus Support Today

| Need | Support | Status |
|---|---|---|
| Layer records | `room.collection("layers")` | Done |
| Text labels and content | CRDT text fields | Done |
| Tree hierarchy | `room.tree("tree").move(...)` | Done |
| Z-order | `room.list(...)` | Done |
| Object locks | `collection.lock(...)` | Done |
| Permissions | server path/op/role permission rules | Done |
| Replay and diffs | `replayAt`, `diffVersions` | Done |
| Offline-safe delete | tombstone delete | Done |
| Selection awareness | `room.awareness.updateSelection(...)` | Done |
| Viewport awareness | `room.awareness.updateViewport(...)` | Done |
| Multi-object transforms | `room.transaction(...)` | Done |
| Comments | `room.comments(...)` | Done |
| Asset references | `room.assets(...)` metadata records | Done |
| Undo/redo | `room.undo()` and `room.redo()` | Done |
| Transaction labels | `MutationMetadata.label` | Done |
| Rich nested CRDT structures | only text CRDT | Missing |

## Missing P0 Capabilities

- Playwright coverage for design-canvas transactions, undo/redo, layer trees, and awareness.
- A demo environment that exercises pages, frames, layer trees, grouping, and locks.

## Missing P1 Capabilities

- Playwright coverage for comments, asset references, schema validation, and large-canvas behavior.
- A polished design-canvas demo environment that uses these helpers directly.
- Future CRDT map/array implementation only if richer design demos prove current primitives are insufficient.

## Preferred SDK Shape

```ts
const canvas = client.room<DesignCanvasState>("design_123");
const layers = canvas.collection<DesignNode>("layers");

await canvas.transaction("Group selected layers", async (tx) => {
  tx.create(layers, "group_1", {
    id: "group_1",
    pageId: "page_1",
    type: "group",
    x: 100,
    y: 100,
    width: 400,
    height: 240,
    name: "Hero group"
  });
  tx.tree("tree").move("layer_1", { from: "page_1", to: "group_1", at: 0 });
  tx.tree("tree").move("layer_2", { from: "page_1", to: "group_1", at: 1 });
});

canvas.awareness.updateViewport({ pageId: "page_1", x: 0, y: 0, zoom: 0.75 });
canvas.awareness.updateSelection(["layer_1", "layer_2"]);
```

This is now the recommended P0 SDK shape for design-canvas edits.

## Implementation Notes

The existing tree and list primitives are a strong fit for design canvases. The next credibility step is not more tree mechanics; it is expressing high-level editing intent, undoing that intent, and documenting asset/comment conventions.
