<script lang="ts">
  import type { Point, Rect } from "../canvas/geometry";
  import type { ResizeHandle } from "../canvas/useResize";
  import type { WorkflowEdge, WorkflowNode } from "./workflow-model";

  type CollectionName = "shapes" | "frames" | "nodes";

  type DragState = {
    collection: CollectionName;
    id: string;
    offsetX: number;
    offsetY: number;
    x: number;
    y: number;
  };

  type ResizeState = {
    collection: CollectionName;
    id: string;
    handle: ResizeHandle;
    startPointer: Point;
    startRect: Rect;
    currentRect: Rect;
  };

  let {
    edges,
    nodes,
    drag,
    linkDrag,
    resize = null
  }: {
    edges: WorkflowEdge[];
    nodes: WorkflowNode[];
    drag: DragState | null;
    linkDrag: { sourceId: string; x: number; y: number } | null;
    resize?: ResizeState | null;
  } = $props();

  const nodeById = $derived(new Map(nodes.map((node) => [node.id, node])));

  function draftPosition(id: string, fallback: Point): Point {
    if (drag?.collection === "nodes" && drag.id === id) return { x: drag.x, y: drag.y };
    if (resize?.collection === "nodes" && resize.id === id) return { x: resize.currentRect.x, y: resize.currentRect.y };
    return fallback;
  }
</script>

<svg class="edges">
  {#each edges as edge (edge.id)}
    {@const source = nodeById.get(edge.source)}
    {@const target = nodeById.get(edge.target)}
    {#if source && target}
      {@const sourcePosition = draftPosition(source.id, source)}
      {@const targetPosition = draftPosition(target.id, target)}
      <line
        data-testid="workflow-edge"
        x1={sourcePosition.x + 156}
        y1={sourcePosition.y + 34}
        x2={targetPosition.x}
        y2={targetPosition.y + 34}
      />
    {/if}
  {/each}
  {#if linkDrag}
    {@const source = nodeById.get(linkDrag.sourceId)}
    {#if source}
      {@const sourcePosition = draftPosition(source.id, source)}
      <line
        class="preview-edge"
        x1={sourcePosition.x + 156}
        y1={sourcePosition.y + 34}
        x2={linkDrag.x}
        y2={linkDrag.y}
      />
    {/if}
  {/if}
</svg>
