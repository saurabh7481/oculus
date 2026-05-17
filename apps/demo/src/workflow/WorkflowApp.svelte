<script lang="ts">
  import { GitBranch } from "lucide-svelte";
  import type { Point, Rect } from "../canvas/geometry";
  import type { ResizeHandle } from "../canvas/useResize";
  import type { WorkflowEdge, WorkflowNode as WorkflowNodeModel } from "./workflow-model";
  import WorkflowEdgeLayer from "./WorkflowEdgeLayer.svelte";
  import WorkflowNode from "./WorkflowNode.svelte";

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
    nodes,
    edges,
    selected,
    drag,
    resize,
    linkDrag,
    previewState,
    selectedEdgeId,
    onStartDrag,
    onStartResize,
    onRename,
    onStartLink,
    onFocusLabel,
    onSelectEdge
  }: {
    nodes: WorkflowNodeModel[];
    edges: WorkflowEdge[];
    selected: { kind: "node"; id: string } | null;
    drag: DragState | null;
    resize: ResizeState | null;
    linkDrag: { sourceId: string; x: number; y: number } | null;
    previewState: boolean;
    selectedEdgeId: string | null;
    onStartDrag: (event: PointerEvent, id: string, x: number, y: number) => void;
    onStartResize: (event: PointerEvent, id: string, handle: ResizeHandle, rect: Rect) => void;
    onRename: (id: string, field: "label", value: string) => void;
    onStartLink: (event: PointerEvent, sourceId: string) => void;
    onFocusLabel: (id: string) => void;
    onSelectEdge: (id: string) => void;
  } = $props();

  function draftRect(
    id: string,
    fallback: { x: number; y: number; width?: number; height?: number },
    defaults: { width: number; height: number }
  ): Rect {
    if (resize?.collection === "nodes" && resize.id === id) return resize.currentRect;
    return {
      x: fallback.x,
      y: fallback.y,
      width: fallback.width ?? defaults.width,
      height: fallback.height ?? defaults.height
    };
  }

  function isSelected(id: string): boolean {
    return selected?.kind === "node" && selected.id === id;
  }
</script>

<div class="workflow-stage" data-testid="workflow-board">
  <WorkflowEdgeLayer {edges} {nodes} {drag} {linkDrag} {resize} {selectedEdgeId} {onSelectEdge} />
  {#each nodes as node (node.id)}
    <WorkflowNode
      {node}
      rect={draftRect(node.id, node, { width: 166, height: 68 })}
      selected={isSelected(node.id)}
      {previewState}
      {onStartDrag}
      {onStartResize}
      {onRename}
      {onStartLink}
      {onFocusLabel}
    />
  {/each}
  {#if nodes.length === 0}
    <div class="empty-state">
      <GitBranch size={26} />
      <strong>Build a process</strong>
      <span>Add nodes, drag handles to connect them, and delete nodes when the flow changes.</span>
    </div>
  {/if}
</div>
