<script lang="ts">
  import {
    Activity,
    BarChart3,
    Braces,
    ChevronLeft,
    ChevronRight,
    Circle,
    Code2,
    Database,
    FileImage,
    GitBranch,
    Layers3,
    Link2,
    Moon,
    MousePointer2,
    PenLine,
    RectangleHorizontal,
    RotateCcw,
    StickyNote,
    Sun,
    Trash2,
    Undo2,
    Wifi,
    WifiOff
  } from "lucide-svelte";
  import { onMount } from "svelte";
  import { createOculusRoomStore } from "@oculus/svelte";
  import type { Operation, ReplayDiff, RoomEvent } from "@oculus/sdk";
  import { client, serverUrl, userColor, userId, userName } from "../collab";
  import ResizeHandles from "../canvas/ResizeHandles.svelte";
  import { resizeFromHandle, type ResizeHandle } from "../canvas/useResize";
  import type { Rect } from "../canvas/geometry";
  import Dialog from "../ui/dialog/Dialog.svelte";
  import WhiteboardApp from "../whiteboard/WhiteboardApp.svelte";
  import WhiteboardToolbar from "../whiteboard/WhiteboardToolbar.svelte";
  import type { WhiteboardShape, WhiteboardTool } from "../whiteboard/whiteboard-model";
  import WorkflowApp from "../workflow/WorkflowApp.svelte";
  import WorkflowToolbar from "../workflow/WorkflowToolbar.svelte";
  import type { WorkflowEdge, WorkflowNode } from "../workflow/workflow-model";

  type Environment = "whiteboard" | "design" | "workflow";
  type SelectableKind = "shape" | "frame" | "node";
  type CollectionName = "shapes" | "frames" | "nodes";

  type Point = { x: number; y: number };

  type DesignFrame = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    name: string;
    kind: "frame" | "component" | "asset";
    color: string;
  };

  type AssetReference = {
    id: string;
    kind: "image" | "file" | "other";
    url: string;
    width?: number;
    height?: number;
    metadata?: Record<string, unknown>;
  };

  type CommentRecord = {
    id: string;
    targetId?: string;
    body: string;
    authorId: string;
    x?: number;
    y?: number;
    resolved: boolean;
    createdAt: number;
    updatedAt: number;
  };

  type StudioState = {
    shapes?: Record<string, WhiteboardShape>;
    frames?: Record<string, DesignFrame>;
    nodes?: Record<string, WorkflowNode>;
    edges?: Record<string, WorkflowEdge>;
    assets?: Record<string, AssetReference>;
    comments?: Record<string, CommentRecord>;
  };

  type StorageInfo = {
    backend: "memory" | "postgres";
    eventCount: number;
    latestSnapshotVersion: number | null;
    loadedVersion: number;
  };

  export let roomId: string;
  export let initialEnvironment: Environment = "whiteboard";

  const room = createOculusRoomStore<StudioState>(client, roomId);
  const { state, version, connected, connectionStatus, queuedOperations, syncing, users, cursors, events } = room;

  const environments: Array<{ id: Environment; name: string; label: string; description: string }> = [
    {
      id: "whiteboard",
      name: "Whiteboard",
      label: "usable ideation canvas",
      description: "Draw with pencil, place stickies, create shapes and build quick charts."
    },
    {
      id: "workflow",
      name: "Workflow Builder",
      label: "process graph editor",
      description: "Create nodes, drag to connect them, reposition steps and delete mistakes."
    }
  ];

  let activeEnvironment: Environment = initialEnvironment;
  let whiteboardTool: WhiteboardTool = "select";
  let darkMode = false;
  let navCollapsed = false;
  let inspectorCollapsed = false;
  let shareDialogOpen = false;
  let selected: { kind: SelectableKind; id: string } | null = null;
  let drag:
    | {
        collection: CollectionName;
        id: string;
        offsetX: number;
        offsetY: number;
        x: number;
        y: number;
      }
    | null = null;
  let drawing: { points: Point[]; color: string } | null = null;
  let linkDrag: { sourceId: string; x: number; y: number } | null = null;
  let resize:
    | {
        collection: CollectionName;
        id: string;
        handle: ResizeHandle;
        startPointer: Point;
        startRect: Rect;
        currentRect: Rect;
      }
    | null = null;
  let previewVersion: number | null = null;
  let previewState: StudioState | null = null;
  let selectedDiff: ReplayDiff<StudioState> | null = null;
  let replayError: string | null = null;
  let storageInfo: StorageInfo | null = null;
  let storageError: string | null = null;

  $: activeMeta = environments.find((environment) => environment.id === activeEnvironment) ?? environments[0];
  $: visibleState = previewState ?? $state;
  $: whiteboardShapes = Object.values(visibleState.shapes ?? {}).filter(
    (shape) => shape.environment === "whiteboard"
  );
  $: stickies = whiteboardShapes.filter((shape) => shape.type === "sticky");
  $: strokes = whiteboardShapes.filter((shape) => shape.type === "freehand");
  $: rectangles = whiteboardShapes.filter((shape) => shape.type === "rectangle");
  $: ellipses = whiteboardShapes.filter((shape) => shape.type === "ellipse");
  $: charts = whiteboardShapes.filter((shape) => shape.type === "chart");
  $: frames = Object.values(visibleState.frames ?? {});
  $: nodes = Object.values(visibleState.nodes ?? {});
  $: edges = Object.values(visibleState.edges ?? {});
  $: comments = Object.values(visibleState.comments ?? {});
  $: assets = Object.values(visibleState.assets ?? {});
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
  $: if ($version >= 0) void refreshStorageInfo();

  onMount(() => {
    darkMode = localStorage.getItem("oculus_demo_theme") === "dark";
    navCollapsed = localStorage.getItem("oculus_demo_nav_collapsed") === "true";
    inspectorCollapsed = localStorage.getItem("oculus_demo_inspector_collapsed") === "true";
    void refreshStorageInfo();
  });

  function uid(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }

  function setEnvironment(environment: Environment) {
    activeEnvironment = environment;
    selected = null;
    whiteboardTool = "select";
    room.updatePresence({ environment, name: userName, color: userColor }, { throttle: 0 });
  }

  function setDarkMode(next: boolean) {
    darkMode = next;
    localStorage.setItem("oculus_demo_theme", next ? "dark" : "light");
  }

  function setNavCollapsed(next: boolean) {
    navCollapsed = next;
    localStorage.setItem("oculus_demo_nav_collapsed", String(next));
  }

  function setInspectorCollapsed(next: boolean) {
    inspectorCollapsed = next;
    localStorage.setItem("oculus_demo_inspector_collapsed", String(next));
  }

  async function copyShareLink() {
    await navigator.clipboard?.writeText(window.location.href);
  }

  function now(): number {
    return Date.now();
  }

  function collectionFor(kind: SelectableKind): CollectionName {
    if (kind === "shape") return "shapes";
    if (kind === "frame") return "frames";
    return "nodes";
  }

  function draftPosition(collection: CollectionName, id: string, fallback: Point): Point {
    if (drag?.collection === collection && drag.id === id) return { x: drag.x, y: drag.y };
    if (resize?.collection === collection && resize.id === id) return { x: resize.currentRect.x, y: resize.currentRect.y };
    return fallback;
  }

  function draftRect(
    collection: CollectionName,
    id: string,
    fallback: Point & { width?: number; height?: number },
    defaults: { width: number; height: number }
  ): Rect {
    if (resize?.collection === collection && resize.id === id) return resize.currentRect;
    return {
      x: fallback.x,
      y: fallback.y,
      width: fallback.width ?? defaults.width,
      height: fallback.height ?? defaults.height
    };
  }

  function canvasPoint(event: PointerEvent | MouseEvent): Point {
    const rect = document.querySelector<HTMLElement>("[data-testid='studio-canvas']")?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function isFormTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement;
  }

  function select(kind: SelectableKind, id: string) {
    selected = { kind, id };
    room.updateSelection([id]);
  }

  function startDrag(event: PointerEvent, collection: CollectionName, kind: SelectableKind, id: string, x: number, y: number) {
    if (previewState || isFormTarget(event.target)) return;
    const point = canvasPoint(event);
    select(kind, id);
    drag = {
      collection,
      id,
      offsetX: point.x - x,
      offsetY: point.y - y,
      x,
      y
    };
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent) {
    updatePointerPresence(event);
    if (drawing) {
      drawing = { ...drawing, points: [...drawing.points, canvasPoint(event)] };
      return;
    }
    if (resize) {
      const point = canvasPoint(event);
      const delta = {
        x: point.x - resize.startPointer.x,
        y: point.y - resize.startPointer.y
      };
      resize = {
        ...resize,
        currentRect: resizeFromHandle(resize.startRect, resize.handle, delta)
      };
      return;
    }
    if (linkDrag) {
      linkDrag = { ...linkDrag, ...canvasPoint(event) };
      return;
    }
    if (!drag) return;
    const point = canvasPoint(event);
    drag = {
      ...drag,
      x: Math.max(16, Math.round(point.x - drag.offsetX)),
      y: Math.max(16, Math.round(point.y - drag.offsetY))
    };
  }

  function handlePointerUp(event: PointerEvent) {
    if (drawing) {
      void commitDrawing();
      return;
    }
    if (linkDrag) {
      void finishLink(event);
      return;
    }
    if (resize) {
      void commitResize();
      return;
    }
    if (!drag) return;
    const current = drag;
    drag = null;
    void room.transaction(
      `Move ${current.collection.slice(0, -1)}`,
      [
        { op: "set", path: `${current.collection}.${current.id}.x`, value: current.x },
        { op: "set", path: `${current.collection}.${current.id}.y`, value: current.y }
      ],
      { kind: "move", targetIds: [current.id] }
    );
  }

  function startResize(
    event: PointerEvent,
    collection: CollectionName,
    kind: SelectableKind,
    id: string,
    handle: ResizeHandle,
    rect: Rect
  ) {
    if (previewState) return;
    select(kind, id);
    resize = {
      collection,
      id,
      handle,
      startPointer: canvasPoint(event),
      startRect: rect,
      currentRect: rect
    };
    event.preventDefault();
    event.stopPropagation();
  }

  async function commitResize() {
    const current = resize;
    resize = null;
    if (!current) return;
    await room.transaction(
      `Resize ${current.collection.slice(0, -1)}`,
      [
        { op: "set", path: `${current.collection}.${current.id}.x`, value: Math.round(current.currentRect.x) },
        { op: "set", path: `${current.collection}.${current.id}.y`, value: Math.round(current.currentRect.y) },
        { op: "set", path: `${current.collection}.${current.id}.width`, value: Math.round(current.currentRect.width) },
        { op: "set", path: `${current.collection}.${current.id}.height`, value: Math.round(current.currentRect.height) }
      ],
      { kind: "resize", targetIds: [current.id] }
    );
  }

  async function addSticky() {
    const id = uid("sticky");
    const commentId = uid("comment");
    const createdAt = now();
    await room.transaction(
      "Add whiteboard sticky",
      [
        {
          op: "set",
          path: `shapes.${id}`,
          value: {
            id,
            environment: "whiteboard",
            type: "sticky",
            x: 96 + (stickies.length % 4) * 190,
            y: 92 + Math.floor(stickies.length / 4) * 132,
            width: 168,
            height: 104,
            text: "Map the idea",
            color: "#fef3c7"
          }
        },
        {
          op: "set",
          path: `comments.${commentId}`,
          value: {
            id: commentId,
            targetId: id,
            body: "Pinned comment",
            authorId: userId,
            x: 280,
            y: 102,
            resolved: false,
            createdAt,
            updatedAt: createdAt
          }
        }
      ],
      { kind: "whiteboard", targetIds: [id] }
    );
    select("shape", id);
  }

  async function addWhiteboardShape(type: "rectangle" | "ellipse" | "chart") {
    const id = uid(type);
    const value: WhiteboardShape = {
      id,
      environment: "whiteboard",
      type,
      x: 120 + (whiteboardShapes.length % 4) * 180,
      y: 250 + Math.floor(whiteboardShapes.length / 4) * 130,
      width: type === "chart" ? 210 : 150,
      height: type === "chart" ? 126 : 92,
      color: type === "ellipse" ? "#dcfce7" : type === "chart" ? "#dbeafe" : "#e0e7ff",
      text: type === "chart" ? "Q3 pipeline" : type
    };
    if (type === "chart") value.values = [42, 76, 54, 92, 68];
    await room.transaction("Add whiteboard shape", [{ op: "set", path: `shapes.${id}`, value }], {
      kind: "whiteboard",
      targetIds: [id]
    });
    select("shape", id);
  }

  function startDrawing(event: PointerEvent) {
    if (activeEnvironment !== "whiteboard" || whiteboardTool !== "pencil" || previewState) return;
    if ((event.target as HTMLElement).closest("[data-object]")) return;
    drawing = { color: userColor, points: [canvasPoint(event)] };
    selected = null;
    event.preventDefault();
  }

  async function commitDrawing() {
    const nextDrawing = drawing;
    drawing = null;
    if (!nextDrawing || nextDrawing.points.length < 2) return;
    const id = uid("stroke");
    await room.transaction(
      "Draw freehand stroke",
      [
        {
          op: "set",
          path: `shapes.${id}`,
          value: {
            id,
            environment: "whiteboard",
            type: "freehand",
            x: 0,
            y: 0,
            color: nextDrawing.color,
            points: nextDrawing.points
          }
        }
      ],
      { kind: "whiteboard", targetIds: [id] }
    );
  }

  async function addFrame(kind: "frame" | "component" | "asset" = "frame") {
    const id = uid(kind);
    const assetId = kind === "asset" ? uid("asset") : null;
    const frame: DesignFrame = {
      id,
      x: 92 + (frames.length % 3) * 224,
      y: 88 + Math.floor(frames.length / 3) * 168,
      width: kind === "component" ? 164 : 188,
      height: kind === "component" ? 96 : 132,
      name: kind === "asset" ? "Hero image" : kind === "component" ? "CTA component" : "Mobile screen",
      kind,
      color: kind === "component" ? "#ede9fe" : kind === "asset" ? "#fef3c7" : "#dbeafe"
    };
    const operations: Operation[] = [{ op: "set", path: `frames.${id}`, value: frame }];
    if (assetId) {
      operations.push({
        op: "set",
        path: `assets.${assetId}`,
        value: {
          id: assetId,
          kind: "image",
          url: "oculus://assets/hero-image.png",
          width: 1440,
          height: 960,
          metadata: { frameId: id, alt: "Design canvas asset reference" }
        }
      });
    }
    await room.transaction("Add design item", operations, { kind: "design", targetIds: [id] });
    select("frame", id);
  }

  async function addNode(kind: WorkflowNode["kind"] = "action") {
    const id = uid("node");
    await room.transaction(
      "Add workflow node",
      [
        {
          op: "set",
          path: `nodes.${id}`,
          value: {
            id,
            x: 96 + (nodes.length % 4) * 184,
            y: 104 + Math.floor(nodes.length / 4) * 132,
            label: kind === "trigger" ? "Trigger" : kind === "decision" ? "Decision" : "New step",
            kind,
            color: kind === "decision" ? "#9333ea" : userColor
          }
        }
      ],
      { kind: "workflow", targetIds: [id] }
    );
    select("node", id);
  }

  async function connectLatestNodes() {
    if (nodes.length < 2) return;
    const source = nodes[nodes.length - 2];
    const target = nodes[nodes.length - 1];
    if (!source || !target) return;
    await connectNodes(source.id, target.id);
  }

  function startLink(event: PointerEvent, sourceId: string) {
    if (previewState) return;
    linkDrag = { sourceId, ...canvasPoint(event) };
    select("node", sourceId);
    event.preventDefault();
    event.stopPropagation();
  }

  async function finishLink(event: PointerEvent) {
    const current = linkDrag;
    linkDrag = null;
    if (!current) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-node-id]");
    const targetId = target?.dataset.nodeId;
    if (!targetId || targetId === current.sourceId) return;
    await connectNodes(current.sourceId, targetId);
  }

  async function connectNodes(source: string, target: string) {
    const exists = edges.some((edge) => edge.source === source && edge.target === target);
    if (exists) return;
    const id = uid("edge");
    await room.transaction(
      "Connect workflow nodes",
      [{ op: "set", path: `edges.${id}`, value: { id, source, target } }],
      { kind: "workflow", targetIds: [source, target] }
    );
  }

  async function deleteSelected() {
    if (!selected) return;
    const target = selected;
    selected = null;
    if (target.kind === "node") {
      const operations: Operation[] = [{ op: "delete", path: `nodes.${target.id}` }];
      for (const edge of edges) {
        if (edge.source === target.id || edge.target === target.id) operations.push({ op: "delete", path: `edges.${edge.id}` });
      }
      await room.transaction("Delete workflow node", operations, { kind: "delete", targetIds: [target.id] });
      return;
    }
    await room.transaction(
      `Delete ${target.kind}`,
      [{ op: "delete", path: `${collectionFor(target.kind)}.${target.id}` }],
      { kind: "delete", targetIds: [target.id] }
    );
  }

  async function rename(collection: CollectionName, id: string, field: "text" | "name" | "label", value: string) {
    await room.update(collection, id, { [field]: value });
  }

  async function showReplay(targetVersion: number) {
    try {
      previewVersion = targetVersion;
      replayError = null;
      const fromVersion = Math.max(0, targetVersion - 1);
      const [stateAtVersion, diff] = await Promise.all([
        room.replayAt(targetVersion),
        room.diffVersions(fromVersion, targetVersion)
      ]);
      previewState = stateAtVersion;
      selectedDiff = diff;
    } catch (error) {
      replayError = error instanceof Error ? error.message : "Unable to load replay";
    }
  }

  function clearReplay() {
    previewVersion = null;
    previewState = null;
    selectedDiff = null;
    replayError = null;
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
        environment: activeEnvironment,
        name: userName,
        color: userColor
      },
      { throttle: 35 }
    );
  }

  function strokePath(points: Point[] = []): string {
    if (points.length === 0) return "";
    const [first, ...rest] = points;
    return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
  }

  function selectedClass(kind: SelectableKind, id: string): string {
    return selected?.kind === kind && selected.id === id ? "selected" : "";
  }

  function eventSummary(event: RoomEvent): string {
    return event.metadata?.label ?? event.operations.map(operationSummary).join(", ");
  }

  function operationSummary(operation: Operation): string {
    if (operation.op === "text") return `text ${operation.path}`;
    if (operation.op === "list-move") return `move ${operation.path}`;
    if (operation.op === "tree-move") return `tree ${operation.value.id}`;
    if (operation.op === "tombstone-delete") return `remove ${operation.path}`;
    return `${operation.op} ${operation.path}`;
  }

  function formatTimestamp(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(timestamp);
  }

  function formatDiffValue(value: unknown): string {
    if (value === undefined) return "undefined";
    if (typeof value === "string") return `"${value}"`;
    return JSON.stringify(value);
  }
</script>

<svelte:window on:pointermove={handlePointerMove} on:pointerup={handlePointerUp} />

<main
  class="studio-shell"
  class:dark={darkMode}
  class:nav-collapsed={navCollapsed}
  class:inspector-collapsed={inspectorCollapsed}
  data-testid="studio-shell"
>
  <aside class="nav-panel" class:collapsed={navCollapsed} data-testid="nav-panel">
    <div class="brand-row">
      <div class="brand-lockup">
        <div class="brand-mark">O</div>
        {#if !navCollapsed}
          <div>
            <p>Oculus</p>
            <h1>Oculus Studio</h1>
          </div>
        {/if}
      </div>
      <button
        class="icon-button inverted"
        aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
        on:click={() => setNavCollapsed(!navCollapsed)}
      >
        {#if navCollapsed}<ChevronRight size={16} />{:else}<ChevronLeft size={16} />{/if}
      </button>
    </div>

    <section class="nav-section">
      <p class="eyebrow">Environments</p>
      <div class="environment-list">
        {#each environments as environment (environment.id)}
          <button class:active={activeEnvironment === environment.id} on:click={() => setEnvironment(environment.id)}>
            {#if environment.id === "whiteboard"}
              <PenLine size={17} />
            {:else if environment.id === "design"}
              <Layers3 size={17} />
            {:else}
              <GitBranch size={17} />
            {/if}
            {#if !navCollapsed}
              <span>
                {environment.name}
                <small>{environment.label}</small>
              </span>
            {/if}
          </button>
        {/each}
      </div>
    </section>

    {#if !navCollapsed}
      <section class="nav-section proof-section">
        <p class="eyebrow">Engine proof</p>
        <ul class="proof-list">
          <li><Activity size={15} /> Optimistic shared state</li>
          <li><Undo2 size={15} /> Transactions with undo/redo</li>
          <li><MousePointer2 size={15} /> Typed awareness presence</li>
          <li><RotateCcw size={15} /> Replay debugger and diffs</li>
          <li><Database size={15} /> Snapshots and lifecycle</li>
          <li><Braces size={15} /> Schema-ready room contracts</li>
        </ul>
      </section>
    {/if}
  </aside>

  <section class="workbench">
    <header class="topbar">
      <div>
        <p class="eyebrow">{activeMeta.label}</p>
        <h2>{activeMeta.name}</h2>
        <span>{activeMeta.description}</span>
      </div>
      <div class="topbar-actions">
        <span class={`status-pill ${$connectionStatus}`} data-testid="connection-status">
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
        <button aria-label={darkMode ? "Light mode" : "Dark mode"} on:click={() => setDarkMode(!darkMode)}>
          {#if darkMode}<Sun size={16} /> Light mode{:else}<Moon size={16} /> Dark mode{/if}
        </button>
        <button on:click={() => (shareDialogOpen = true)}><Link2 size={16} /> Share</button>
        <button on:click={() => void room.undo()}><Undo2 size={16} /> Undo</button>
        <button on:click={() => void room.redo()}><RotateCcw size={16} /> Redo</button>
      </div>
    </header>

    <div class="command-bar">
      {#if activeEnvironment === "whiteboard"}
        <WhiteboardToolbar
          tool={whiteboardTool}
          selected={Boolean(selected)}
          onToolChange={(tool) => (whiteboardTool = tool)}
          onAddSticky={() => void addSticky()}
          onAddShape={(type) => void addWhiteboardShape(type)}
          onDeleteSelected={() => void deleteSelected()}
        />
      {:else if activeEnvironment === "design"}
        <button class="primary" on:click={() => addFrame("frame")}><RectangleHorizontal size={16} /> Add frame</button>
        <button on:click={() => addFrame("component")}><Layers3 size={16} /> Add component</button>
        <button on:click={() => addFrame("asset")}><FileImage size={16} /> Add asset</button>
        <button class="danger" disabled={!selected} on:click={deleteSelected}><Trash2 size={16} /> Delete selected</button>
      {:else}
        <WorkflowToolbar
          selected={Boolean(selected)}
          onAddNode={(kind) => void addNode(kind)}
          onConnectLatest={() => void connectLatestNodes()}
          onDeleteSelected={() => void deleteSelected()}
        />
      {/if}
      <span class="room-chip"><Code2 size={14} /> {roomId}</span>
    </div>

    {#if previewVersion !== null}
      <div class="replay-banner">
        <RotateCcw size={15} />
        Viewing replay at v{previewVersion}
        {#if selectedDiff}
          <span>{selectedDiff.changes.length} changed {selectedDiff.changes.length === 1 ? "path" : "paths"}</span>
        {/if}
        <button on:click={clearReplay}>Return live</button>
      </div>
    {/if}

    <div
      class={`canvas-surface ${activeEnvironment} ${whiteboardTool === "pencil" ? "drawing-mode" : ""}`}
      data-testid="studio-canvas"
      role="application"
      on:pointerdown={startDrawing}
    >
      {#if activeEnvironment === "whiteboard"}
        <WhiteboardApp
          shapes={whiteboardShapes}
          comments={comments.map((comment) => ({ id: comment.id, body: comment.body, x: comment.x, y: comment.y }))}
          selected={selected?.kind === "shape" ? { kind: "shape", id: selected.id } : null}
          {drag}
          {resize}
          {drawing}
          previewState={Boolean(previewState)}
          onStartDrag={(event, id, x, y) => startDrag(event, "shapes", "shape", id, x, y)}
          onStartResize={(event, id, handle, rect) => startResize(event, "shapes", "shape", id, handle, rect)}
          onRename={(id, field, value) => void rename("shapes", id, field, value)}
        />
      {:else if activeEnvironment === "design"}
        <div class="design-stage">
          <div class="ruler horizontal"></div>
          <div class="ruler vertical"></div>
          {#each frames as frame (frame.id)}
            {@const rect = draftRect("frames", frame.id, frame, { width: frame.width, height: frame.height })}
            <article
              data-object
              data-testid="design-frame"
              data-x={Math.round(rect.x)}
              class={`design-frame ${frame.kind} ${selectedClass("frame", frame.id)}`}
              style={`left: ${rect.x}px; top: ${rect.y}px; width: ${rect.width}px; height: ${rect.height}px; background: ${frame.color}`}
              on:pointerdown={(event) => startDrag(event, "frames", "frame", frame.id, rect.x, rect.y)}
            >
              <span>{frame.kind}</span>
              <input
                value={frame.name}
                disabled={Boolean(previewState)}
                on:input={(event) => void rename("frames", frame.id, "name", event.currentTarget.value)}
              />
              <div class="frame-lines"></div>
              {#if selected?.kind === "frame" && selected.id === frame.id}
                <ResizeHandles onResizeStart={(handle, event) => startResize(event, "frames", "frame", frame.id, handle, rect)} />
              {/if}
            </article>
          {/each}
          {#if frames.length === 0}
            <div class="empty-state">
              <RectangleHorizontal size={26} />
              <strong>Create a layout</strong>
              <span>Add frames, components and asset cards, then drag them into place.</span>
            </div>
          {/if}
        </div>
      {:else}
        <WorkflowApp
          {nodes}
          {edges}
          selected={selected?.kind === "node" ? { kind: "node", id: selected.id } : null}
          {drag}
          {resize}
          {linkDrag}
          previewState={Boolean(previewState)}
          onStartDrag={(event, id, x, y) => startDrag(event, "nodes", "node", id, x, y)}
          onStartResize={(event, id, handle, rect) => startResize(event, "nodes", "node", id, handle, rect)}
          onRename={(id, field, value) => void rename("nodes", id, field, value)}
          onStartLink={(event, sourceId) => startLink(event, sourceId)}
          onFocusLabel={(id) =>
            room.updatePresence({
              environment: activeEnvironment,
              editing: `nodes.${id}.label`,
              name: userName,
              color: userColor
            })}
        />
      {/if}

      {#each Object.entries($cursors) as [clientId, cursor] (clientId)}
        <div
          data-testid="collaborator-cursor"
          class="cursor"
          style={`left: ${cursor.x}px; top: ${cursor.y}px; color: ${cursor.color ?? "#2563eb"}`}
        >
          <MousePointer2 size={18} fill="currentColor" />
          <span>{cursor.name ?? "Collaborator"}</span>
        </div>
      {/each}
    </div>
  </section>

  <aside class="inspector" class:collapsed={inspectorCollapsed} data-testid="inspector-panel">
    <button
      class="icon-button inspector-toggle"
      aria-label={inspectorCollapsed ? "Expand inspector" : "Collapse inspector"}
      on:click={() => setInspectorCollapsed(!inspectorCollapsed)}
    >
      {#if inspectorCollapsed}<ChevronLeft size={16} />{:else}<ChevronRight size={16} />{/if}
    </button>

    {#if !inspectorCollapsed}
      <section>
        <p class="eyebrow">Live room</p>
        <div class="metrics-grid">
          <div><span>Version</span><strong>{$version}</strong></div>
          <div><span>Queued</span><strong>{$queuedOperations}</strong></div>
          <div><span>Users</span><strong>{Math.max($users.length, 1)}</strong></div>
          <div><span>Events</span><strong>{storageInfo?.eventCount ?? $events.length}</strong></div>
        </div>
        <div class="storage-card">
          <div>
            <Database size={16} />
            <strong>{storageInfo?.backend === "postgres" ? "Postgres" : "Memory"} persistence</strong>
          </div>
          {#if storageError}
            <span class="storage-error">{storageError}</span>
          {:else}
            <span>Snapshot {snapshotLabel}</span>
            <span>Loaded v{storageInfo?.loadedVersion ?? $version}</span>
          {/if}
        </div>
      </section>

      <section>
        <p class="eyebrow">Collaborators</p>
        <ul class="people">
          <li><Circle size={10} fill={userColor} color={userColor} /> {userName} <span>you</span></li>
          {#each collaborators as collaborator (collaborator.clientId)}
            <li><Circle size={10} fill="#0f766e" color="#0f766e" /> {collaborator.userId}</li>
          {/each}
        </ul>
      </section>

      <section>
        <p class="eyebrow">Capability ledger</p>
        <div class="ledger">
          <span><StickyNote size={14} /> {stickies.length} stickies</span>
          <span><PenLine size={14} /> {strokes.length} strokes</span>
          <span><RectangleHorizontal size={14} /> {rectangles.length + ellipses.length} shapes</span>
          <span><BarChart3 size={14} /> {charts.length} charts</span>
          <span><Layers3 size={14} /> {frames.length} design items</span>
          <span><GitBranch size={14} /> {nodes.length} nodes</span>
          <span><Link2 size={14} /> {edges.length} edges</span>
          <span><FileImage size={14} /> {assets.length} assets</span>
        </div>
      </section>

      <section class="history">
        <p class="eyebrow">Replay debugger</p>
        {#if replayError}
          <p class="storage-error">{replayError}</p>
        {/if}
        {#if selectedDiff}
          <div class="diff-panel" data-testid="replay-diff">
            <div>
              <strong>v{selectedDiff.fromVersion} -> v{selectedDiff.toVersion}</strong>
              <span>{selectedDiff.events.length} events replayed</span>
            </div>
            {#if selectedDiff.changes.length === 0}
              <p class="empty">No materialized state changes in this range.</p>
            {:else}
              <ul>
                {#each selectedDiff.changes as change (change.path)}
                  <li>
                    <strong>{change.path}</strong>
                    <small>{change.kind}: {formatDiffValue(change.before)} -> {formatDiffValue(change.after)}</small>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
        <div class="history-log" data-testid="history-log">
          {#if $events.length === 0}
            <p class="empty">Create or move an object to populate the event log.</p>
          {:else}
            {#each [...$events].reverse() as event (event.operationId)}
              <button data-testid="event-row" on:click={() => void showReplay(event.version)}>
                <span>v{event.version}</span>
                <strong>{eventSummary(event)}</strong>
                <small>{event.userId} at {formatTimestamp(event.timestamp)}</small>
              </button>
            {/each}
          {/if}
        </div>
      </section>
    {/if}
  </aside>
</main>

<Dialog
  open={shareDialogOpen}
  title="Share room"
  description="Anyone with this link can join the same collaborative room."
  onclose={() => (shareDialogOpen = false)}
>
  <div class="grid gap-3">
    <input class="share-link-input" readonly value={typeof window === "undefined" ? "" : window.location.href} />
    <button class="primary" on:click={copyShareLink}>Copy room link</button>
  </div>
</Dialog>
