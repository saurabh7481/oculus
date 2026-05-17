<script lang="ts">
  let {
    mode = "select",
    children,
    onpointerdown
  }: {
    mode?: "select" | "draw" | "connect";
    children?: import("svelte").Snippet;
    onpointerdown?: (event: PointerEvent) => void;
  } = $props();
</script>

<div
  class={`canvas-surface ${mode === "draw" ? "drawing-mode" : ""}`}
  data-testid="studio-canvas"
  role="application"
  on:pointerdown={onpointerdown}
>
  {@render children?.()}
</div>
