<script lang="ts">
  let {
    label,
    children
  }: {
    label: string;
    children?: import("svelte").Snippet;
  } = $props();
</script>

<span class="group relative inline-flex">
  {@render children?.()}
  <span
    class="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-xs font-medium text-white shadow-lg group-hover:block"
  >
    {label}
  </span>
</span>
