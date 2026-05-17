import { afterEach, describe, expect, it } from "vitest";
import {
  applyOperations,
  type ConnectionStatus,
  createCollectionOperations,
  createClient,
  createListMoveOperation,
  createTombstoneDeleteOperation,
  createTreeMoveOperation,
  createTextOperation,
  createYjsTextOperation,
  type Operation
} from "../src/index";

const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
  FakeWebSocket.instances = [];
});

type WorkflowNode = {
  id: string;
  x: number;
  y: number;
  label: string;
  lockedBy?: string | null;
};

type WorkflowState = {
  nodes?: Record<string, WorkflowNode>;
  layers?: string[];
  tree?: Record<string, { id: string; parentId?: string | null; children: string[] }>;
  edges?: Record<string, { id: string; sourceNodeId: string; targetNodeId: string }>;
  comments?: Record<string, unknown>;
  assets?: Record<string, unknown>;
  shapes?: Record<string, unknown>;
};

describe("SDK operation helpers", () => {
  it("splits collection updates into field-level operations", () => {
    expect(createCollectionOperations("nodes", "node_1", "update", { x: 20, y: 40 })).toEqual([
      { op: "set", path: "nodes.node_1.x", value: 20 },
      { op: "set", path: "nodes.node_1.y", value: 40 }
    ]);
  });

  it("applies legacy insert, update, and delete operations immutably", () => {
    const initial = { nodes: {} };
    const operations: Operation[] = [
      {
        op: "insert",
        path: "nodes.node_1",
        value: { id: "node_1", x: 10, y: 10, label: "Start" }
      },
      { op: "update", path: "nodes.node_1.x", value: 99 },
      { op: "delete", path: "nodes.node_1.label" }
    ];

    expect(applyOperations(initial, operations)).toEqual({
      nodes: {
        node_1: { id: "node_1", x: 99, y: 10 }
      }
    });
    expect(initial).toEqual({ nodes: {} });
  });

  it("applies universal set, text, list move, and lock operations immutably", () => {
    const initial = {
      nodes: {
        node_1: { id: "node_1", label: "Start", lockedBy: null }
      },
      layers: ["background", "node_1", "foreground"]
    };

    const operations: Operation[] = [
      { op: "set", path: "nodes.node_1.x", value: 42 },
      { op: "text", path: "nodes.node_1.label", value: { index: 5, insert: " here" } },
      { op: "list-move", path: "layers", value: { from: 2, to: 0 } },
      { op: "lock", path: "nodes.node_1.lockedBy", value: { owner: "user_1" } }
    ];

    expect(applyOperations(initial, operations)).toEqual({
      nodes: {
        node_1: { id: "node_1", label: "Start here", lockedBy: "user_1", x: 42 }
      },
      layers: ["foreground", "background", "node_1"]
    });
    expect(initial).toEqual({
      nodes: {
        node_1: { id: "node_1", label: "Start", lockedBy: null }
      },
      layers: ["background", "node_1", "foreground"]
    });
  });

  it("creates text operations for collaborative text fields", () => {
    expect(createTextOperation("nodes.node_1.label", { index: 5, insert: " here" })).toEqual({
      op: "text",
      path: "nodes.node_1.label",
      value: { index: 5, insert: " here" }
    });
  });

  it("creates native Yjs text operations for advanced clients", () => {
    expect(createYjsTextOperation("docs.doc_1.body", [1, 2, 3])).toEqual({
      op: "text",
      path: "docs.doc_1.body",
      value: { yjsUpdate: [1, 2, 3] }
    });
  });

  it("creates ordered list, tree move, and tombstone delete operations", () => {
    expect(createListMoveOperation("layers", 3, 1)).toEqual({
      op: "list-move",
      path: "layers",
      value: { from: 3, to: 1 }
    });
    expect(createTreeMoveOperation("tree", "node_1", "root", "group", 0)).toEqual({
      op: "tree-move",
      path: "tree",
      value: { id: "node_1", fromParentId: "root", toParentId: "group", toIndex: 0 }
    });
    expect(createTombstoneDeleteOperation("nodes.node_1", { deletedBy: "u1", deletedAt: 123 })).toEqual({
      op: "tombstone-delete",
      path: "nodes.node_1",
      value: { deletedBy: "u1", deletedAt: 123 }
    });
  });

  it("applies tombstone deletes and ordered tree moves locally", () => {
    const initial = {
      nodes: {
        node_1: { id: "node_1", label: "Start" }
      },
      tree: {
        root: { id: "root", children: ["node_1", "group"] },
        group: { id: "group", parentId: "root", children: [] },
        node_1: { id: "node_1", parentId: "root", children: [] }
      }
    };

    expect(
      applyOperations(initial, [
        createTombstoneDeleteOperation("nodes.node_1", { deletedBy: "u1", deletedAt: 123 }),
        { op: "set", path: "nodes.node_1.label", value: "Stale update" },
        createTreeMoveOperation("tree", "node_1", "root", "group", 0)
      ])
    ).toEqual({
      nodes: {
        node_1: {
          id: "node_1",
          label: "Start",
          __deleted: true,
          __deletedAt: 123,
          __deletedBy: "u1"
        }
      },
      tree: {
        root: { id: "root", children: ["group"] },
        group: { id: "group", parentId: "root", children: ["node_1"] },
        node_1: { id: "node_1", parentId: "group", children: [] }
      }
    });
  });
});

describe("developer-friendly room API", () => {
  it("mutates collections, text fields, lists, and trees with readable helpers", async () => {
    const room = createClient({
      serverUrl: "http://localhost:3000",
      userId: "user_1"
    }).room<WorkflowState>("workflow_123");
    const nodes = room.collection<WorkflowNode>("nodes");

    await nodes.create("node_1", { id: "node_1", x: 120, y: 160, label: "Start", lockedBy: null });
    await nodes.change("node_1", { x: 220, y: 180 });
    await nodes.text("node_1", "label").insert(5, " here");
    await nodes.lock("node_1", "lockedBy");
    await room.apply([{ op: "set", path: "layers", value: ["background", "node_1", "foreground"] }]);
    await room.list("layers").move(2, 0);
    await room.apply([
      {
        op: "set",
        path: "tree",
        value: {
          root: { id: "root", children: ["node_1", "group"] },
          group: { id: "group", parentId: "root", children: [] },
          node_1: { id: "node_1", parentId: "root", children: [] }
        }
      }
    ]);
    await room.tree("tree").move("node_1", { from: "root", to: "group", at: 0 });

    expect(room.getState()).toEqual({
      nodes: {
        node_1: { id: "node_1", x: 220, y: 180, label: "Start here", lockedBy: "user_1" }
      },
      layers: ["foreground", "background", "node_1"],
      tree: {
        root: { id: "root", children: ["group"] },
        group: { id: "group", parentId: "root", children: ["node_1"] },
        node_1: { id: "node_1", parentId: "group", children: [] }
      }
    });
  });

  it("supports soft deletes without exposing tombstone operation details", async () => {
    const room = createClient({ serverUrl: "http://localhost:3000", userId: "user_1" }).room<WorkflowState>(
      "workflow_123"
    );
    const nodes = room.items<WorkflowNode>("nodes");

    await nodes.create("node_1", { id: "node_1", x: 120, y: 160, label: "Start" });
    await nodes.remove("node_1", { preserveHistory: true, deletedAt: 123 });
    await nodes.change("node_1", { label: "Stale update" });

    expect(room.getState()).toEqual({
      nodes: {
        node_1: {
          id: "node_1",
          x: 120,
          y: 160,
          label: "Start",
          __deleted: true,
          __deletedAt: 123,
          __deletedBy: "user_1"
        }
      }
    });
  });

  it("keeps text helpers type-safe for string fields", async () => {
    const room = createClient({ serverUrl: "http://localhost:3000" }).room<WorkflowState>("workflow_123");
    const nodes = room.collection<WorkflowNode>("nodes");

    await nodes.create("node_1", { id: "node_1", x: 120, y: 160, label: "Start" });
    await nodes.text("node_1", "label").replace("Renamed");

    // @ts-expect-error numeric fields cannot be edited with the text helper
    nodes.text("node_1", "x");

    expect(room.getState()).toEqual({
      nodes: {
        node_1: { id: "node_1", x: 120, y: 160, label: "Renamed" }
      }
    });
  });

  it("fetches replay diffs between room versions", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://localhost:3000/rooms/workflow_123/diff/1/3");
      return new Response(
        JSON.stringify({
          diff: {
            roomId: "workflow_123",
            fromVersion: 1,
            toVersion: 3,
            changedPaths: ["nodes.node_1.x"],
            changes: [{ path: "nodes.node_1.x", before: 10, after: 30, kind: "changed" }],
            events: []
          }
        })
      );
    }) as typeof fetch;
    const room = createClient({ serverUrl: "http://localhost:3000" }).room<WorkflowState>("workflow_123");

    await expect(room.diffVersions(1, 3)).resolves.toEqual({
      roomId: "workflow_123",
      fromVersion: 1,
      toVersion: 3,
      changedPaths: ["nodes.node_1.x"],
      changes: [{ path: "nodes.node_1.x", before: 10, after: 30, kind: "changed" }],
      events: []
    });
  });

  it("groups multi-object edits into labeled reversible transactions", async () => {
    const room = createClient({ serverUrl: "http://localhost:3000", userId: "user_1" }).room<WorkflowState>(
      "workflow_123"
    );
    const nodes = room.collection<WorkflowNode>("nodes");
    await nodes.create("node_1", { id: "node_1", x: 10, y: 10, label: "One" });
    await nodes.create("node_2", { id: "node_2", x: 20, y: 20, label: "Two" });

    await room.transaction("Move selected nodes", (tx) => {
      tx.collection<WorkflowNode>("nodes").change("node_1", { x: 110, y: 120 });
      tx.collection<WorkflowNode>("nodes").change("node_2", { x: 220, y: 240 });
    }, { kind: "move", targetIds: ["node_1", "node_2"] });

    expect(room.getState().nodes).toMatchObject({
      node_1: { x: 110, y: 120 },
      node_2: { x: 220, y: 240 }
    });
    expect(room.canUndo()).toBe(true);

    await room.undo();
    expect(room.getState().nodes).toMatchObject({
      node_1: { x: 10, y: 10 },
      node_2: { x: 20, y: 20 }
    });
    expect(room.canRedo()).toBe(true);

    await room.redo();
    expect(room.getState().nodes).toMatchObject({
      node_1: { x: 110, y: 120 },
      node_2: { x: 220, y: 240 }
    });
  });

  it("sends transaction metadata with connected mutations", async () => {
    installFakeWebSocket();
    const room = createClient({ serverUrl: "http://localhost:3000", userId: "user_1" }).room<WorkflowState>(
      "workflow_123"
    );
    const connected = room.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "room_init", version: 1, state: { nodes: {} }, connectedUsers: [] });
    await connected;

    const pending = room.transaction("Add node", [
      { op: "set", path: "nodes.node_1", value: { id: "node_1", x: 10, y: 20, label: "Start" } }
    ], { kind: "create", targetIds: ["node_1"] });
    await waitFor(() => socket.sent.length === 1);
    const message = JSON.parse(socket.sent[0]!) as {
      operationId: string;
      metadata?: { label?: string; kind?: string; targetIds?: string[]; inverseOperations?: Operation[] };
    };

    expect(message.metadata).toMatchObject({
      label: "Add node",
      kind: "create",
      targetIds: ["node_1"]
    });
    expect(message.metadata?.inverseOperations).toEqual([{ op: "delete", path: "nodes.node_1" }]);

    socket.message({
      type: "mutation_ack",
      operationId: message.operationId,
      serverVersion: 2,
      status: "accepted"
    });
    await pending;
  });

  it("provides typed awareness helpers over presence", async () => {
    installFakeWebSocket();
    const room = createClient({ serverUrl: "http://localhost:3000", userId: "user_1" }).room<WorkflowState>(
      "workflow_123"
    );
    const connected = room.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "room_init", version: 1, state: {}, connectedUsers: [] });
    await connected;

    room.awareness.updateCursor({ x: 12, y: 34 }, { name: "Ada", color: "#2563eb" });
    room.awareness.updateViewport({ x: 0, y: 0, zoom: 1.5, pageId: "page_1" });
    room.awareness.updateSelection(["node_1", "node_2"]);
    room.awareness.updateTool("connector");
    room.awareness.updateEditing("nodes.node_1.label");

    expect(socket.sent.map((raw) => JSON.parse(raw))).toEqual([
      {
        type: "presence",
        data: {
          cursor: { x: 12, y: 34 },
          name: "Ada",
          color: "#2563eb"
        }
      },
      {
        type: "presence",
        data: {
          viewport: { x: 0, y: 0, zoom: 1.5, pageId: "page_1" }
        }
      },
      { type: "presence", data: { selection: { ids: ["node_1", "node_2"] } } },
      { type: "presence", data: { tool: "connector" } },
      { type: "presence", data: { editing: "nodes.node_1.label" } }
    ]);
  });

  it("provides comments, asset references, and canvas shape helpers", async () => {
    const room = createClient({ serverUrl: "http://localhost:3000", userId: "ada" }).room<WorkflowState>(
      "canvas_123"
    );

    await room.comments("comments").create("comment_1", {
      targetId: "shape_1",
      body: "Check the CTA alignment"
    });
    await room.comments("comments").reply("comment_1", "comment_2", {
      body: "Aligned in the next pass"
    });
    await room.comments("comments").resolve("comment_1");

    await room.assets("assets").create("asset_1", {
      kind: "image",
      url: "https://assets.example/hero.png",
      width: 1200,
      height: 800,
      metadata: { alt: "Hero image" }
    });

    await room.shapes("shapes").create("shape_1", {
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      style: { fill: "#ffffff" }
    });
    await room.shapes("shapes").move("shape_1", 80, 90);
    await room.shapes("shapes").resize("shape_1", 240, 120);
    await room.shapes("shapes").freehand("stroke_1", {
      points: [{ x: 0, y: 0 }, { x: 4, y: 8 }],
      style: { stroke: "#111827", strokeWidth: 2 }
    });

    expect(room.getState()).toMatchObject({
      comments: {
        comment_1: {
          id: "comment_1",
          targetId: "shape_1",
          body: "Check the CTA alignment",
          resolved: true,
          authorId: "ada"
        },
        comment_2: {
          id: "comment_2",
          parentId: "comment_1",
          body: "Aligned in the next pass",
          resolved: false,
          authorId: "ada"
        }
      },
      assets: {
        asset_1: {
          id: "asset_1",
          kind: "image",
          url: "https://assets.example/hero.png",
          width: 1200,
          height: 800,
          metadata: { alt: "Hero image" }
        }
      },
      shapes: {
        shape_1: {
          id: "shape_1",
          type: "rectangle",
          x: 80,
          y: 90,
          width: 240,
          height: 120,
          style: { fill: "#ffffff" }
        },
        stroke_1: {
          id: "stroke_1",
          type: "freehand",
          points: [{ x: 0, y: 0 }, { x: 4, y: 8 }],
          style: { stroke: "#111827", strokeWidth: 2 }
        }
      }
    });
  });
});

describe("offline recovery and sync status", () => {
  it("tracks queued offline operations in public sync state", async () => {
    const room = createClient({ serverUrl: "http://localhost:3000", userId: "user_1" }).room<WorkflowState>(
      "workflow_123"
    );
    const seen: ConnectionStatus[] = [];
    room.on<{ status: ConnectionStatus }>("sync_state_change", (state) => seen.push(state.status));

    await room.collection<WorkflowNode>("nodes").create("node_1", {
      id: "node_1",
      x: 120,
      y: 160,
      label: "Queued"
    });

    expect(room.getSyncState()).toMatchObject({
      status: "offline",
      connected: false,
      queuedOperations: 1,
      pendingOperations: 0
    });
    expect(seen).toContain("offline");
  });

  it("rebases queued operations onto fresh room state before flushing after reconnect", async () => {
    installFakeWebSocket();
    const room = createClient({ serverUrl: "http://localhost:3000", userId: "user_1" }).room<WorkflowState>(
      "workflow_123",
      { reconnect: { minDelay: 1, maxDelay: 1, jitter: 0 } }
    );

    await room.collection<WorkflowNode>("nodes").create("offline_node", {
      id: "offline_node",
      x: 120,
      y: 160,
      label: "Offline"
    });

    const connected = room.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({
      type: "room_init",
      version: 10,
      state: {
        nodes: {
          server_node: { id: "server_node", x: 20, y: 30, label: "Server" }
        }
      },
      connectedUsers: []
    });

    await waitFor(() => socket.sent.length === 1);
    const mutation = JSON.parse(socket.sent[0]!) as { operationId: string; baseVersion: number };

    expect(mutation.baseVersion).toBe(10);
    expect(room.getSyncState()).toMatchObject({ status: "syncing", queuedOperations: 1 });
    expect(room.getState()).toEqual({
      nodes: {
        server_node: { id: "server_node", x: 20, y: 30, label: "Server" },
        offline_node: { id: "offline_node", x: 120, y: 160, label: "Offline" }
      }
    });

    socket.message({
      type: "mutation_ack",
      operationId: mutation.operationId,
      serverVersion: 11,
      status: "accepted"
    });

    await connected;

    expect(room.getSyncState()).toMatchObject({
      status: "connected",
      connected: true,
      queuedOperations: 0,
      pendingOperations: 0,
      version: 11
    });
  });

  it("moves to reconnecting after an unexpected socket close", async () => {
    installFakeWebSocket();
    const room = createClient({ serverUrl: "http://localhost:3000" }).room<WorkflowState>("workflow_123", {
      reconnect: { minDelay: 1, maxDelay: 1, jitter: 0 }
    });

    const connected = room.connect();
    const firstSocket = FakeWebSocket.instances[0]!;
    firstSocket.open();
    firstSocket.message({ type: "room_init", version: 1, state: {}, connectedUsers: [] });
    await connected;

    firstSocket.closeUnexpectedly();

    expect(room.getSyncState().status).toBe("reconnecting");
    await waitFor(() => FakeWebSocket.instances.length === 2);
  });

  it("sends caller-provided roles when connecting to a self-hosted server", async () => {
    installFakeWebSocket();
    const room = createClient({
      serverUrl: "http://localhost:3000",
      userId: "admin_1",
      roles: ["admin", "editor"]
    }).room<WorkflowState>("workflow_123");

    const connected = room.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ type: "room_init", version: 1, state: {}, connectedUsers: [] });
    await connected;

    const url = new URL(socket.url);
    expect(url.searchParams.get("userId")).toBe("admin_1");
    expect(url.searchParams.get("roles")).toBe("admin,editor");
  });
});

type FakeServerMessage =
  | { type: "room_init"; version: number; state: Record<string, unknown>; connectedUsers: unknown[] }
  | {
      type: "mutation_ack";
      operationId: string;
      serverVersion?: number;
      status: "accepted" | "rejected";
      reason?: string;
    };

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(message: FakeServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  closeUnexpectedly(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

function installFakeWebSocket(): void {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for condition");
}
