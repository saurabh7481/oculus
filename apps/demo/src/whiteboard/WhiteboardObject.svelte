<script lang="ts">
  import ResizeHandles from "../canvas/ResizeHandles.svelte";
  import type { Rect } from "../canvas/geometry";
  import type { ResizeHandle } from "../canvas/useResize";
  import type { WhiteboardShape } from "./whiteboard-model";

  let {
    shape,
    rect,
    selected,
    previewState,
    onStartDrag,
    onStartResize,
    onRename
  }: {
    shape: WhiteboardShape;
    rect: Rect;
    selected: boolean;
    previewState: boolean;
    onStartDrag: (event: PointerEvent, id: string, x: number, y: number) => void;
    onStartResize: (event: PointerEvent, id: string, handle: ResizeHandle, rect: Rect) => void;
    onRename: (id: string, field: "text", value: string) => void;
  } = $props();

  const selectedClass = $derived(selected ? "selected" : "");
</script>

{#if shape.type === "rectangle"}
  <div
    data-object
    data-testid="whiteboard-rectangle"
    data-x={Math.round(rect.x)}
    role="button"
    tabindex="0"
    class={`shape-card rectangle ${selectedClass}`}
    style={`left: ${rect.x}px; top: ${rect.y}px; width: ${rect.width}px; height: ${rect.height}px; background: ${shape.color ?? "#e0e7ff"}`}
    onpointerdown={(event) => onStartDrag(event, shape.id, rect.x, rect.y)}
  >
    <span>{shape.text}</span>
    {#if selected}
      <ResizeHandles onResizeStart={(handle, event) => onStartResize(event, shape.id, handle, rect)} />
    {/if}
  </div>
{:else if shape.type === "ellipse"}
  <div
    data-object
    data-testid="whiteboard-ellipse"
    data-x={Math.round(rect.x)}
    role="button"
    tabindex="0"
    class={`shape-card ellipse ${selectedClass}`}
    style={`left: ${rect.x}px; top: ${rect.y}px; width: ${rect.width}px; height: ${rect.height}px; background: ${shape.color ?? "#dcfce7"}`}
    onpointerdown={(event) => onStartDrag(event, shape.id, rect.x, rect.y)}
  >
    <span>{shape.text}</span>
    {#if selected}
      <ResizeHandles onResizeStart={(handle, event) => onStartResize(event, shape.id, handle, rect)} />
    {/if}
  </div>
{:else if shape.type === "chart"}
  <article
    data-object
    data-testid="whiteboard-chart"
    data-x={Math.round(rect.x)}
    class={`chart-card ${selectedClass}`}
    style={`left: ${rect.x}px; top: ${rect.y}px; width: ${rect.width}px; height: ${rect.height}px`}
    onpointerdown={(event) => onStartDrag(event, shape.id, rect.x, rect.y)}
  >
    <strong>{shape.text}</strong>
    <div class="bars">
      {#each shape.values ?? [] as value}
        <i style={`height: ${value}%`}></i>
      {/each}
    </div>
    {#if selected}
      <ResizeHandles onResizeStart={(handle, event) => onStartResize(event, shape.id, handle, rect)} />
    {/if}
  </article>
{:else if shape.type === "sticky"}
  <article
    data-object
    data-testid="whiteboard-sticky"
    data-x={Math.round(rect.x)}
    class={`sticky ${selectedClass}`}
    style={`left: ${rect.x}px; top: ${rect.y}px; width: ${rect.width}px; min-height: ${rect.height}px; background: ${shape.color ?? "#fef3c7"}`}
    onpointerdown={(event) => onStartDrag(event, shape.id, rect.x, rect.y)}
  >
    <span>Sticky</span>
    <textarea
      value={shape.text}
      disabled={previewState}
      oninput={(event) => onRename(shape.id, "text", event.currentTarget.value)}
    ></textarea>
    {#if selected}
      <ResizeHandles onResizeStart={(handle, event) => onStartResize(event, shape.id, handle, rect)} />
    {/if}
  </article>
{/if}
