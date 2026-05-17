<script lang="ts">
  import { Sparkles, StickyNote } from "lucide-svelte";
  import type { Point, Rect } from "../canvas/geometry";
  import type { ResizeHandle } from "../canvas/useResize";
  import type { WhiteboardShape } from "./whiteboard-model";
  import WhiteboardObject from "./WhiteboardObject.svelte";

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

  type CommentPin = {
    id: string;
    body: string;
    x?: number;
    y?: number;
  };

  let {
    shapes,
    comments = [],
    selected,
    drag: _drag,
    resize,
    drawing,
    previewState,
    onStartDrag,
    onStartResize,
    onRename
  }: {
    shapes: WhiteboardShape[];
    comments?: CommentPin[];
    selected: { kind: "shape"; id: string } | null;
    drag: DragState | null;
    resize: ResizeState | null;
    drawing: { points: Point[]; color: string } | null;
    previewState: boolean;
    onStartDrag: (event: PointerEvent, id: string, x: number, y: number) => void;
    onStartResize: (event: PointerEvent, id: string, handle: ResizeHandle, rect: Rect) => void;
    onRename: (id: string, field: "text", value: string) => void;
  } = $props();

  const stickies = $derived(shapes.filter((shape) => shape.type === "sticky"));
  const strokes = $derived(shapes.filter((shape) => shape.type === "freehand"));
  const rectangles = $derived(shapes.filter((shape) => shape.type === "rectangle"));
  const ellipses = $derived(shapes.filter((shape) => shape.type === "ellipse"));
  const charts = $derived(shapes.filter((shape) => shape.type === "chart"));

  function draftRect(
    id: string,
    fallback: { x: number; y: number; width?: number; height?: number },
    defaults: { width: number; height: number }
  ): Rect {
    if (resize?.collection === "shapes" && resize.id === id) return resize.currentRect;
    return {
      x: fallback.x,
      y: fallback.y,
      width: fallback.width ?? defaults.width,
      height: fallback.height ?? defaults.height
    };
  }

  function isSelected(id: string): boolean {
    return selected?.kind === "shape" && selected.id === id;
  }

  function strokePath(points: Point[] = []): string {
    if (points.length === 0) return "";
    const [first, ...rest] = points;
    return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
  }
</script>

<div class="whiteboard-stage">
  {#each strokes as stroke (stroke.id)}
    <svg
      class="freehand-layer"
      data-testid="freehand-stroke"
      style={`color: ${stroke.color ?? "#2563eb"}`}
    >
      <path d={strokePath(stroke.points)} />
    </svg>
  {/each}
  {#if drawing}
    <svg class="freehand-layer drawing-preview" style={`color: ${drawing.color}`}>
      <path d={strokePath(drawing.points)} />
    </svg>
  {/if}

  {#each rectangles as shape (shape.id)}
    <WhiteboardObject
      {shape}
      rect={draftRect(shape.id, shape, { width: 150, height: 92 })}
      selected={isSelected(shape.id)}
      {previewState}
      {onStartDrag}
      {onStartResize}
      {onRename}
    />
  {/each}

  {#each ellipses as shape (shape.id)}
    <WhiteboardObject
      {shape}
      rect={draftRect(shape.id, shape, { width: 150, height: 92 })}
      selected={isSelected(shape.id)}
      {previewState}
      {onStartDrag}
      {onStartResize}
      {onRename}
    />
  {/each}

  {#each charts as shape (shape.id)}
    <WhiteboardObject
      {shape}
      rect={draftRect(shape.id, shape, { width: 210, height: 126 })}
      selected={isSelected(shape.id)}
      {previewState}
      {onStartDrag}
      {onStartResize}
      {onRename}
    />
  {/each}

  {#each stickies as shape (shape.id)}
    <WhiteboardObject
      {shape}
      rect={draftRect(shape.id, shape, { width: 168, height: 104 })}
      selected={isSelected(shape.id)}
      {previewState}
      {onStartDrag}
      {onStartResize}
      {onRename}
    />
  {/each}

  {#each comments.slice(0, 8) as comment (comment.id)}
    <div class="comment-pin" style={`left: ${comment.x ?? 320}px; top: ${comment.y ?? 120}px`}>
      <Sparkles size={13} />
      <span>{comment.body}</span>
    </div>
  {/each}

  {#if shapes.length === 0}
    <div class="empty-state">
      <StickyNote size={26} />
      <strong>Start whiteboarding</strong>
      <span>Use pencil, stickies, shapes or a chart. Everything is collaborative room state.</span>
    </div>
  {/if}
</div>
