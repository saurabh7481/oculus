<script lang="ts">
  import { Link2, Zap, Play, GitBranch } from "lucide-svelte";
  import ResizeHandles from "../canvas/ResizeHandles.svelte";
  import type { Rect } from "../canvas/geometry";
  import type { ResizeHandle } from "../canvas/useResize";
  import type { WorkflowNode } from "./workflow-model";

  let {
    node,
    rect,
    selected,
    previewState,
    onStartDrag,
    onStartResize,
    onRename,
    onStartLink,
    onFocusLabel
  }: {
    node: WorkflowNode;
    rect: Rect;
    selected: boolean;
    previewState: boolean;
    onStartDrag: (event: PointerEvent, id: string, x: number, y: number) => void;
    onStartResize: (event: PointerEvent, id: string, handle: ResizeHandle, rect: Rect) => void;
    onRename: (id: string, field: "label", value: string) => void;
    onStartLink: (event: PointerEvent, sourceId: string) => void;
    onFocusLabel: (id: string) => void;
  } = $props();

  const selectedClass = $derived(selected ? "selected" : "");
</script>

<article
  data-object
  data-node-id={node.id}
  data-testid="workflow-node"
  data-x={Math.round(rect.x)}
  class={`workflow-node ${node.kind} ${selectedClass}`}
  style={`left: ${rect.x}px; top: ${rect.y}px; width: ${rect.width}px; min-height: ${rect.height}px; border-color: ${node.color ?? "#2563eb"}`}
  onpointerdown={(event) => onStartDrag(event, node.id, rect.x, rect.y)}
>
  <div class="node-content">
    <span class="node-icon">
      {#if node.kind === "trigger"}
        <Zap size={14} />
      {:else if node.kind === "decision"}
        <GitBranch size={14} />
      {:else}
        <Play size={14} />
      {/if}
    </span>
    <input
      data-testid="node-label"
      value={node.label}
      disabled={previewState}
      oninput={(event) => onRename(node.id, "label", event.currentTarget.value)}
      onfocus={() => onFocusLabel(node.id)}
    />
    <button
      class="connect-handle"
      aria-label={`Connect ${node.label}`}
      onpointerdown={(event) => onStartLink(event, node.id)}
    >
      <Link2 size={13} />
    </button>
    {#if selected}
      <ResizeHandles onResizeStart={(handle, event) => onStartResize(event, node.id, handle, rect)} />
    {/if}
  </div>
</article>
