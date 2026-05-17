<script lang="ts">
  import { GitBranch, Link2, Plus, Sparkles, Trash2 } from "lucide-svelte";

  let {
    selected,
    onAddNode,
    onConnectLatest,
    onDeleteSelected
  }: {
    selected: boolean;
    onAddNode: (kind: "trigger" | "action" | "decision") => void;
    onConnectLatest: () => void;
    onDeleteSelected: () => void;
  } = $props();
</script>

<button class="primary" onclick={() => onAddNode("action")}><Plus size={16} /> Add node</button>
<button onclick={() => onAddNode("trigger")}><Sparkles size={16} /> Trigger</button>
<button onclick={() => onAddNode("decision")}><GitBranch size={16} /> Decision</button>
<button onclick={onConnectLatest}><Link2 size={16} /> Link latest</button>
<button class="danger" disabled={!selected} onclick={onDeleteSelected}><Trash2 size={16} /> Delete selected</button>
