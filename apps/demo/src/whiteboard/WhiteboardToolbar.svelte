<script lang="ts">
  import { BarChart3, Circle, MousePointer2, PenLine, RectangleHorizontal, StickyNote, Trash2 } from "lucide-svelte";
  import type { WhiteboardTool } from "./whiteboard-model";

  let {
    tool,
    selected,
    onToolChange,
    onAddSticky,
    onAddShape,
    onDeleteSelected
  }: {
    tool: WhiteboardTool;
    selected: boolean;
    onToolChange: (tool: WhiteboardTool) => void;
    onAddSticky: () => void;
    onAddShape: (type: "rectangle" | "ellipse" | "chart") => void;
    onDeleteSelected: () => void;
  } = $props();
</script>

<button class:primary={tool === "select"} onclick={() => onToolChange("select")}>
  <MousePointer2 size={16} /> Select
</button>
<button class:primary={tool === "pencil"} onclick={() => onToolChange("pencil")}>
  <PenLine size={16} /> Pencil
</button>
<button onclick={onAddSticky}><StickyNote size={16} /> Add sticky</button>
<button onclick={() => onAddShape("rectangle")}><RectangleHorizontal size={16} /> Rectangle</button>
<button onclick={() => onAddShape("ellipse")}><Circle size={16} /> Ellipse</button>
<button onclick={() => onAddShape("chart")}><BarChart3 size={16} /> Chart</button>
<button class="danger" disabled={!selected} onclick={onDeleteSelected}><Trash2 size={16} /> Delete selected</button>
