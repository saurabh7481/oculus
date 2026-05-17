<script lang="ts">
  import { GitBranch, PenLine, Sparkles } from "lucide-svelte";
  import Button from "../ui/button/Button.svelte";

  let {
    onCreate
  }: {
    onCreate: (kind: "whiteboard" | "workflow") => void;
  } = $props();
</script>

<main class="min-h-screen bg-slate-950 text-white">
  <section class="mx-auto grid min-h-screen max-w-6xl content-center gap-10 px-6 py-12">
    <div class="max-w-3xl">
      <div class="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-sm font-semibold text-blue-200">
        <Sparkles size={15} />
        Universal collaboration engine
      </div>
      <h1 class="m-0 text-5xl font-black tracking-tight sm:text-6xl">Oculus Studio</h1>
      <p class="mt-4 max-w-2xl text-lg leading-7 text-slate-300">
        Create a collaborative room for a real whiteboard or workflow builder, share the link, and build together in the same live space.
      </p>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <article class="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl">
        <PenLine class="mb-5 text-blue-300" size={32} />
        <h2 class="m-0 text-2xl font-bold">Whiteboard</h2>
        <p class="mt-2 min-h-14 text-slate-400">Sketch, add shapes, write stickies, create charts and collaborate with room presence.</p>
        <Button class="mt-6 w-full" variant="primary" onclick={() => onCreate("whiteboard")}>
          New whiteboard
        </Button>
      </article>

      <article class="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl">
        <GitBranch class="mb-5 text-blue-300" size={32} />
        <h2 class="m-0 text-2xl font-bold">Workflow Builder</h2>
        <p class="mt-2 min-h-14 text-slate-400">Create process nodes, connect them by dragging handles, and share a live process room.</p>
        <Button class="mt-6 w-full" variant="primary" onclick={() => onCreate("workflow")}>
          New workflow
        </Button>
      </article>
    </div>
  </section>
</main>
