<script lang="ts">
  import { X } from "lucide-svelte";
  import Button from "../button/Button.svelte";

  let {
    open = false,
    title,
    description,
    children,
    onclose
  }: {
    open?: boolean;
    title: string;
    description?: string;
    children?: import("svelte").Snippet;
    onclose?: () => void;
  } = $props();
</script>

{#if open}
  <div class="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="presentation">
    <section class="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
      <header class="flex items-start justify-between gap-4">
        <div>
          <h2 class="m-0 text-lg font-semibold text-slate-950 dark:text-slate-50">{title}</h2>
          {#if description}
            <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>
          {/if}
        </div>
        <Button variant="ghost" size="icon" aria-label="Close dialog" onclick={onclose}>
          <X size={16} />
        </Button>
      </header>
      <div class="mt-4">
        {@render children?.()}
      </div>
    </section>
  </div>
{/if}
