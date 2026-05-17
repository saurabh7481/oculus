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
    resize = null,
    selectedEdgeId,
    onSelectEdge
  }: {
    edges: WorkflowEdge[];
    nodes: WorkflowNode[];
    drag: DragState | null;
    linkDrag: { sourceId: string; x: number; y: number } | null;
    resize?: ResizeState | null;
    selectedEdgeId: string | null;
    onSelectEdge: (id: string) => void;
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
      {@const sp = draftPosition(source.id, source)}
      {@const tp = draftPosition(target.id, target)}
      {@const x1 = sp.x + 156}
      {@const y1 = sp.y + 34}
      {@const x2 = tp.x}
      {@const y2 = tp.y + 34}
      {@const mx = (x1 + x2) / 2}
      {@const my = (y1 + y2) / 2}
      <g data-testid="workflow-edge" onclick={() => onSelectEdge(edge.id)} style="cursor: pointer">
        <!-- visible line -->
        <line
          class={selectedEdgeId === edge.id ? "selected" : ""}
          {x1} {y1} {x2} {y2}
        />
        <!-- wide transparent hit target -->
        <line
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="transparent"
          stroke-width="12"
          style="pointer-events: stroke; cursor: pointer"
          onclick={() => onSelectEdge(edge.id)}
        />
        <!-- label text -->
        {#if edge.label}
          <text data-testid="edge-label-text" x={mx} y={my - 6} text-anchor="middle" class="edge-label">
            {edge.label}
          </text>
        {/if}
      </g>
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
