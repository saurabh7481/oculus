<script lang="ts">
  import Circle from "lucide-svelte/icons/circle";
  import Database from "lucide-svelte/icons/database";
  import Link2 from "lucide-svelte/icons/link-2";
  import MousePointer2 from "lucide-svelte/icons/mouse-pointer-2";
  import Plus from "lucide-svelte/icons/plus";
  import RotateCcw from "lucide-svelte/icons/rotate-ccw";
  import Trash2 from "lucide-svelte/icons/trash-2";
  import Wifi from "lucide-svelte/icons/wifi";
  import WifiOff from "lucide-svelte/icons/wifi-off";
  import { onMount } from "svelte";
  import { createOculusRoomStore } from "@oculus/svelte";
  import { client, serverUrl, userColor, userId, userName } from "./collab";

  type WorkflowNode = {
    id: string;
    x: number;
    y: number;
    label: string;
    color?: string;
  };

  type WorkflowEdge = {
    id: string;
    source: string;
    target: string;
  };

  type WorkflowState = {
    nodes?: Record<string, WorkflowNode>;
    edges?: Record<string, WorkflowEdge>;
  };

  type StorageInfo = {
    backend: "memory" | "postgres";
    eventCount: number;
    latestSnapshotVersion: number | null;
    loadedVersion: number;
  };

  const roomId = "workflow_123";
  const room = createOculusRoomStore<WorkflowState>(client, roomId);
  const { state, version, connected, connectionStatus, queuedOperations, syncing, users, cursors, events } = room;

  let dragging: string | null = null;
  let linkMode = false;
  let connectFrom: string | null = null;
  let previewVersion: number | null = null;
  let previewState: WorkflowState | null = null;
  let storageInfo: StorageInfo | null = null;
  let storageError: string | null = null;

  $: visibleState = previewState ?? $state;
  $: nodes = Object.values(visibleState.nodes ?? {});
  $: edges = Object.values(visibleState.edges ?? {});
  $: collaborators = $users.filter((user) => user.userId !== userId);
  $: snapshotLabel =
    storageInfo?.latestSnapshotVersion === null || storageInfo?.latestSnapshotVersion === undefined
      ? "pending"
      : `v${storageInfo.latestSnapshotVersion}`;
  $: statusLabel =
    $connectionStatus === "connected"
      ? "Connected"
      : $connectionStatus === "connecting"
        ? "Connecting"
        : $connectionStatus === "reconnecting"
          ? "Reconnecting"
          : $connectionStatus === "syncing"
            ? "Syncing queued work"
            : "Offline queueing";
  $: statusDetail =
    $queuedOperations > 0
      ? `${$queuedOperations} queued ${$queuedOperations === 1 ? "change" : "changes"}`
      : $syncing
        ? "Finishing sync"
        : $connected
          ? "Live"
          : "Changes stay local";
  $: if ($version >= 0) {
    void refreshStorageInfo();
  }

  onMount(() => {
    void refreshStorageInfo();
  });

  async function addNode() {
    const id = `node_${crypto.randomUUID().slice(0, 8)}`;
    await room.insert("nodes", id, {
      id,
      x: 180 + Math.round(Math.random() * 440),
      y: 130 + Math.round(Math.random() * 260),
      label: "New step",
      color: userColor
    });
  }

  async function moveNode(id: string, x: number, y: number) {
    await room.update("nodes", id, { x: Math.max(20, x), y: Math.max(80, y) });
    room.updatePresence({ cursor: { x, y }, selectedNodeId: id, name: userName, color: userColor });
  }

  async function connectNode(target: string) {
    if (!linkMode) return;
    if (!connectFrom) {
      connectFrom = target;
      room.updatePresence({ selectedNodeId: target, name: userName, color: userColor });
      return;
    }

    if (connectFrom !== target) {
      const id = `edge_${crypto.randomUUID().slice(0, 8)}`;
      await room.insert("edges", id, { id, source: connectFrom, target });
    }

    connectFrom = null;
    linkMode = false;
  }

  async function showReplay(targetVersion: number) {
    previewVersion = targetVersion;
    previewState = await room.replayAt(targetVersion);
  }

  function clearReplay() {
    previewVersion = null;
    previewState = null;
  }

  async function refreshStorageInfo() {
    try {
      const response = await fetch(`${serverUrl}/rooms/${encodeURIComponent(roomId)}/storage`);
      if (!response.ok) throw new Error(`storage request failed with ${response.status}`);
      storageInfo = (await response.json()) as StorageInfo;
      storageError = null;
    } catch (error) {
      storageInfo = null;
      storageError = error instanceof Error ? error.message : "Unable to load storage status";
    }
  }

  function updatePointerPresence(event: MouseEvent) {
    room.updatePresence(
      {
        cursor: { x: event.clientX, y: event.clientY },
        name: userName,
        color: userColor
      },
      { throttle: 35 }
    );
  }

  function handlePointerUp(event: PointerEvent, node: WorkflowNode) {
    if (!dragging || previewState) return;
    dragging = null;
    const board = (event.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (board) void moveNode(node.id, event.clientX - board.left - 76, event.clientY - board.top - 28);
  }
</script>

<svelte:window on:mousemove={updatePointerPresence} />

<main class="shell">
  <section class="canvas">
    <header class="toolbar">
      <div>
        <p class="eyebrow">Oculus SDK demo</p>
        <h1>Collaborative Workflow Builder</h1>
      </div>
      <div class="actions">
        <span class={`status ${$connectionStatus}`}>
          {#if $connectionStatus === "connected"}
            <Wifi size={15} />
          {:else if $connectionStatus === "connecting" || $connectionStatus === "reconnecting" || $connectionStatus === "syncing"}
            <RotateCcw size={15} />
          {:else}
            <WifiOff size={15} />
          {/if}
          <span>
            {statusLabel}
            <small>{statusDetail}</small>
          </span>
        </span>
        <button on:click={addNode}>
          <Plus size={16} />
          Add node
        </button>
        <button
          class:active={linkMode}
          on:click={() => {
            linkMode = !linkMode;
            connectFrom = null;
          }}
        >
          <Link2 size={16} />
          {linkMode ? (connectFrom ? "Pick target" : "Pick source") : "Link nodes"}
        </button>
      </div>
    </header>

    {#if previewVersion !== null}
      <div class="replay-banner">
        <RotateCcw size={15} />
        Viewing replay at v{previewVersion}
        <button on:click={clearReplay}>Return live</button>
      </div>
    {/if}

    <div class="board">
      <svg class="edges">
        {#each edges as edge (edge.id)}
          {@const source = visibleState.nodes?.[edge.source]}
          {@const target = visibleState.nodes?.[edge.target]}
          {#if source && target}
            <line x1={source.x + 76} y1={source.y + 29} x2={target.x + 76} y2={target.y + 29} />
          {/if}
        {/each}
      </svg>

      {#each nodes as node (node.id)}
        <div
          class:selected={connectFrom === node.id}
          class="node"
          role="button"
          tabindex="0"
          style={`left: ${node.x}px; top: ${node.y}px; border-color: ${node.color ?? "#2563eb"}`}
          on:pointerdown={(event) => {
            if (previewState) return;
            dragging = node.id;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          on:pointerup={(event) => handlePointerUp(event, node)}
          on:click={() => {
            if (!previewState && linkMode) void connectNode(node.id);
          }}
          on:keydown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !previewState && linkMode) {
              void connectNode(node.id);
            }
          }}
        >
          <span style={`background: ${node.color ?? "#2563eb"}`}></span>
          <input
            value={node.label}
            disabled={Boolean(previewState)}
            on:input={(event) =>
              void room.update("nodes", node.id, {
                label: (event.currentTarget as HTMLInputElement).value
              })}
            on:focus={() =>
              room.updatePresence({
                selectedNodeId: node.id,
                editing: `nodes.${node.id}.label`,
                name: userName,
                color: userColor
              })}
          />
          <button aria-label={`Delete ${node.label}`} on:click={() => void room.remove("nodes", node.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      {/each}

      {#each Object.entries($cursors) as [clientId, cursor] (clientId)}
        <div
          class="cursor"
          style={`left: ${cursor.x}px; top: ${cursor.y}px; color: ${cursor.color ?? "#2563eb"}`}
        >
          <MousePointer2 size={18} fill="currentColor" />
          <span>{cursor.name ?? "Collaborator"}</span>
        </div>
      {/each}
    </div>
  </section>

  <aside class="sidebar">
    <section>
      <p class="eyebrow">Room</p>
      <h2>{roomId}</h2>
      <div class="metric">
        <span>Version</span>
        <strong>{$version}</strong>
      </div>
      <div class="metric">
        <span>Sync</span>
        <strong>{statusLabel}</strong>
      </div>
      <div class="metric">
        <span>Queued</span>
        <strong>{$queuedOperations}</strong>
      </div>
      <div class="metric">
        <span>Users</span>
        <strong>{Math.max($users.length, 1)}</strong>
      </div>
      <div class="storage-card">
        <div>
          <Database size={16} />
          <strong>{storageInfo?.backend === "postgres" ? "Postgres" : "Memory"}</strong>
        </div>
        {#if storageError}
          <span class="storage-error">{storageError}</span>
        {:else}
          <span>{storageInfo?.eventCount ?? $events.length} durable events</span>
          <span>Snapshot {snapshotLabel}</span>
        {/if}
      </div>
    </section>

    <section>
      <p class="eyebrow">Collaborators</p>
      <ul class="people">
        <li>
          <Circle size={10} fill={userColor} color={userColor} />
          {userName} <span>you</span>
        </li>
        {#each collaborators as collaborator (collaborator.clientId)}
          <li>
            <Circle size={10} fill="#0f766e" color="#0f766e" />
            {collaborator.userId}
          </li>
        {/each}
      </ul>
    </section>

    <section class="history">
      <p class="eyebrow">Event history</p>
      {#if $events.length === 0}
        <p class="empty">Move a node or edit a label to create the first event.</p>
      {:else}
        {#each [...$events].reverse() as event (event.operationId)}
          <button on:click={() => void showReplay(event.version)}>
            <span>v{event.version}</span>
            <strong>{event.operations.map((operation) => operation.path).join(", ")}</strong>
            <small>{event.userId}</small>
          </button>
        {/each}
      {/if}
    </section>
  </aside>
</main>
