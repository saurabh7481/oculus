import { describe, expect, it } from "vitest";
import {
  applyOperations,
  createCollectionOperations,
  createClient,
  createListMoveOperation,
  createTombstoneDeleteOperation,
  createTreeMoveOperation,
  createTextOperation,
  createYjsTextOperation,
  type Operation
} from "../src/index";

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
});
