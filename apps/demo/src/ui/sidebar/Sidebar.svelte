<script lang="ts">
  import { cn } from "../../lib/cn";

  let {
    collapsed = false,
    side = "left",
    class: className = "",
    children
  }: {
    collapsed?: boolean;
    side?: "left" | "right";
    class?: string;
    children?: import("svelte").Snippet;
  } = $props();
</script>

<aside
  class={cn(
    "min-h-0 min-w-0 overflow-hidden border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950",
    side === "left" ? "border-r" : "border-l",
    collapsed ? "w-14" : "w-72",
    className
  )}
>
  {@render children?.()}
</aside>
