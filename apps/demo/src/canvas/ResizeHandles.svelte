<script lang="ts">
  import type { ResizeHandle } from "./useResize";

  const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  let {
    onResizeStart
  }: {
    onResizeStart?: (handle: ResizeHandle, event: PointerEvent) => void;
  } = $props();
</script>

{#each handles as handle}
  <button
    class={`resize-handle ${handle}`}
    aria-label={`Resize ${handle}`}
    onpointerdown={(event) => onResizeStart?.(handle, event)}
  ></button>
{/each}
