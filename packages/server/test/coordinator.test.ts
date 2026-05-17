import { describe, expect, it } from "vitest";
import {
  type EventStore,
  MemoryEventStore,
  RoomCoordinator,
  type RoomEvent,
  type Operation
} from "../src/coordinator";
import { z } from "zod";

const createCoordinator = () => {
  const store = new MemoryEventStore();
  const coordinator = new RoomCoordinator(store);

  coordinator.defineCollection("tasks", {
    fields: {
      status: {
        strategy: "custom",
        resolver: (current, incoming) => {
          const order = ["todo", "in_progress", "review", "done"];
          const currentRank = order.indexOf(String(current ?? "todo"));
          const incomingRank = order.indexOf(String(incoming ?? "todo"));
          return incomingRank >= currentRank ? incoming : current;
        }
      }
    }
  });

  coordinator.defineCollection("nodes", {
    fields: {
      label: { strategy: "crdt-text" }
    }
  });

  return { coordinator, store };
};

describe("RoomCoordinator", () => {
  it("applies field-level mutations, increments versions, and stores an event log", async () => {
    const { coordinator, store } = createCoordinator();
    await coordinator.loadRoom("workflow_123", {
      nodes: {}
    });

    const insert = await coordinator.applyMutation({
      roomId: "workflow_123",
      userId: "u1",
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [
        {
          op: "insert",
          path: "nodes.node_1",
          value: { id: "node_1", x: 100, y: 120, label: "Start" }
        }
      ]
    });

    const update = await coordinator.applyMutation({
      roomId: "workflow_123",
      userId: "u2",
      clientId: "c2",
      operationId: "op_2",
      baseVersion: 1,
      operations: [
        { op: "update", path: "nodes.node_1.x", value: 220 },
        { op: "update", path: "nodes.node_1.y", value: 180 }
      ]
    });

    expect(insert).toMatchObject({ status: "accepted", serverVersion: 1 });
    expect(update).toMatchObject({ status: "accepted", serverVersion: 2 });
    expect(coordinator.getRoomState("workflow_123")).toEqual({
      nodes: {
        node_1: { id: "node_1", x: 220, y: 180, label: "Start" }
      }
    });
    expect(await store.getEvents("workflow_123", 0)).toHaveLength(2);
  });

  it("stores transaction metadata with room events", async () => {
    const { coordinator, store } = createCoordinator();
    await coordinator.loadRoom("metadata_room", { nodes: {} });

    await coordinator.applyMutation({
      roomId: "metadata_room",
      userId: "u1",
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      metadata: {
        label: "Move selected nodes",
        kind: "move",
        targetIds: ["node_1", "node_2"],
        inverseOperations: [
          { op: "set", path: "nodes.node_1.x", value: 10 },
          { op: "set", path: "nodes.node_2.x", value: 20 }
        ]
      },
      operations: [
        { op: "set", path: "nodes.node_1.x", value: 110 },
        { op: "set", path: "nodes.node_2.x", value: 220 }
      ]
    });

    expect(await store.getEvents("metadata_room")).toMatchObject([
      {
        operationId: "op_1",
        metadata: {
          label: "Move selected nodes",
          kind: "move",
          targetIds: ["node_1", "node_2"]
        }
      }
    ]);
  });

  it("serializes concurrent mutations so versions stay unique and ordered", async () => {
    const { coordinator, store } = createCoordinator();
    await coordinator.loadRoom("concurrent_room", { nodes: {} });

    const results = await Promise.all([
      coordinator.applyMutation({
        roomId: "concurrent_room",
        userId: "u1",
        clientId: "c1",
        operationId: "op_1",
        baseVersion: 0,
        operations: [
          {
            op: "insert",
            path: "nodes.node_1",
            value: { id: "node_1", x: 10, y: 20, label: "Start" }
          }
        ]
      }),
      coordinator.applyMutation({
        roomId: "concurrent_room",
        userId: "u2",
        clientId: "c2",
        operationId: "op_2",
        baseVersion: 0,
        operations: [
          {
            op: "insert",
            path: "nodes.node_2",
            value: { id: "node_2", x: 30, y: 40, label: "Next" }
          }
        ]
      })
    ]);

    expect(results).toMatchObject([
      { status: "accepted", serverVersion: 1 },
      { status: "accepted", serverVersion: 2 }
    ]);
    expect((await store.getEvents("concurrent_room")).map((event) => event.version)).toEqual([1, 2]);
    expect(coordinator.getRoomState("concurrent_room")).toEqual({
      nodes: {
        node_1: { id: "node_1", x: 10, y: 20, label: "Start" },
        node_2: { id: "node_2", x: 30, y: 40, label: "Next" }
      }
    });
  });

  it("rejects a mutation without changing state when event persistence fails", async () => {
    class FailingAppendStore extends MemoryEventStore implements EventStore {
      async appendEvent(_event: RoomEvent): Promise<void> {
        throw new Error("database unavailable");
      }
    }

    const coordinator = new RoomCoordinator(new FailingAppendStore());
    await coordinator.loadRoom("failure_room", { nodes: {} });

    await expect(
      coordinator.applyMutation({
        roomId: "failure_room",
        userId: "u1",
        clientId: "c1",
        operationId: "op_1",
        baseVersion: 0,
        operations: [
          {
            op: "insert",
            path: "nodes.node_1",
            value: { id: "node_1", x: 10, y: 20, label: "Start" }
          }
        ]
      })
    ).resolves.toEqual({ status: "rejected", reason: "event_persist_failed" });

    expect(coordinator.getRoomVersion("failure_room")).toBe(0);
    expect(coordinator.getRoomState("failure_room")).toEqual({ nodes: {} });
  });

  it("rejects unauthorized operations before changing state or storing events", async () => {
    const { coordinator, store } = createCoordinator();
    coordinator.definePermissions([
      { path: "nodes.*.x", operations: ["set", "update"], roles: ["editor", "admin"] },
      { path: "nodes.*.label", operations: ["set", "update", "text"], roles: ["viewer", "editor", "admin"] },
      { path: "edges.*", roles: ["admin"] }
    ]);
    await coordinator.loadRoom("permission_room", {
      nodes: {
        node_1: { id: "node_1", x: 100, label: "Start" }
      },
      edges: {}
    });

    const result = await coordinator.applyMutation({
      roomId: "permission_room",
      userId: "viewer_1",
      roles: ["viewer"],
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [{ op: "set", path: "nodes.node_1.x", value: 240 }]
    });

    expect(result).toEqual({
      status: "rejected",
      reason: "permission_denied:nodes.node_1.x"
    });
    expect(coordinator.getRoomVersion("permission_room")).toBe(0);
    expect(coordinator.getRoomState("permission_room")).toEqual({
      nodes: {
        node_1: { id: "node_1", x: 100, label: "Start" }
      },
      edges: {}
    });
    expect(await store.getEvents("permission_room")).toEqual([]);
  });

  it("allows operations when a caller role matches a permission rule", async () => {
    const { coordinator } = createCoordinator();
    coordinator.definePermissions([
      { path: "nodes.*.x", operations: ["set", "update"], roles: ["editor", "admin"] },
      { path: "nodes.*.label", operations: ["set", "update", "text"], roles: ["viewer", "editor", "admin"] }
    ]);
    await coordinator.loadRoom("permission_allow_room", {
      nodes: {
        node_1: { id: "node_1", x: 100, label: "Start" }
      }
    });

    const result = await coordinator.applyMutation({
      roomId: "permission_allow_room",
      userId: "editor_1",
      roles: ["editor"],
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [
        { op: "set", path: "nodes.node_1.x", value: 240 },
        { op: "text", path: "nodes.node_1.label", value: { index: 5, insert: " here" } }
      ]
    });

    expect(result).toMatchObject({ status: "accepted", serverVersion: 1 });
    expect(coordinator.getRoomState("permission_allow_room")).toEqual({
      nodes: {
        node_1: { id: "node_1", x: 240, label: "Start here" }
      }
    });
  });

  it("rejects an entire batch when any operation is unauthorized", async () => {
    const { coordinator } = createCoordinator();
    coordinator.definePermissions([
      { path: "nodes.*.label", operations: ["set", "update", "text"], roles: ["viewer", "editor", "admin"] },
      { path: "edges.*", roles: ["admin"] }
    ]);
    await coordinator.loadRoom("permission_batch_room", {
      nodes: {
        node_1: { id: "node_1", label: "Start" }
      },
      edges: {}
    });

    const result = await coordinator.applyMutation({
      roomId: "permission_batch_room",
      userId: "viewer_1",
      roles: ["viewer"],
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [
        { op: "text", path: "nodes.node_1.label", value: { index: 5, insert: " here" } },
        { op: "set", path: "edges.edge_1", value: { id: "edge_1", source: "node_1", target: "node_2" } }
      ]
    });

    expect(result).toEqual({ status: "rejected", reason: "permission_denied:edges.edge_1" });
    expect(coordinator.getRoomVersion("permission_batch_room")).toBe(0);
    expect(coordinator.getRoomState("permission_batch_room")).toEqual({
      nodes: {
        node_1: { id: "node_1", label: "Start" }
      },
      edges: {}
    });
  });

  it("applies reusable room configuration with collections, permissions, and edge validation", async () => {
    const store = new MemoryEventStore();
    const coordinator = new RoomCoordinator(store);
    coordinator.defineRoom("workflow_room", {
      collections: {
        nodes: {
          fields: {
            label: { strategy: "crdt-text" }
          }
        }
      },
      permissions: [
        { path: "nodes.*", operations: ["set"], roles: ["editor"] },
        { path: "edges.*", operations: ["set"], roles: ["editor"] }
      ],
      edgeValidators: [
        {
          edgeCollection: "edges",
          nodeCollection: "nodes",
          sourceNodeField: "sourceNodeId",
          targetNodeField: "targetNodeId",
          sourcePortField: "sourcePortId",
          targetPortField: "targetPortId"
        }
      ]
    });
    await coordinator.loadRoom("workflow_room", {
      nodes: {
        http: {
          id: "http",
          label: "HTTP",
          ports: { outputs: [{ id: "response" }], inputs: [] }
        },
        ai: {
          id: "ai",
          label: "AI",
          ports: { inputs: [{ id: "prompt" }], outputs: [] }
        }
      },
      edges: {}
    });

    await expect(
      coordinator.applyMutation({
        roomId: "workflow_room",
        userId: "u1",
        roles: ["viewer"],
        clientId: "c1",
        operationId: "op_1",
        baseVersion: 0,
        operations: [{ op: "set", path: "nodes.http.label", value: "Blocked" }]
      })
    ).resolves.toEqual({ status: "rejected", reason: "permission_denied:nodes.http.label" });

    await expect(
      coordinator.applyMutation({
        roomId: "workflow_room",
        userId: "u1",
        roles: ["editor"],
        clientId: "c1",
        operationId: "op_2",
        baseVersion: 0,
        operations: [
          {
            op: "set",
            path: "edges.edge_1",
            value: {
              id: "edge_1",
              sourceNodeId: "http",
              sourcePortId: "missing",
              targetNodeId: "ai",
              targetPortId: "prompt"
            }
          }
        ]
      })
    ).resolves.toEqual({
      status: "rejected",
      reason: "validation_failed:edges.edge_1.source_port_missing"
    });

    await expect(
      coordinator.applyMutation({
        roomId: "workflow_room",
        userId: "u1",
        roles: ["editor"],
        clientId: "c1",
        operationId: "op_3",
        baseVersion: 0,
        operations: [
          {
            op: "set",
            path: "edges.edge_1",
            value: {
              id: "edge_1",
              sourceNodeId: "http",
              sourcePortId: "response",
              targetNodeId: "ai",
              targetPortId: "prompt"
            }
          }
        ]
      })
    ).resolves.toMatchObject({ status: "accepted", serverVersion: 1 });

    await expect(
      coordinator.applyMutation({
        roomId: "workflow_room",
        userId: "u1",
        roles: ["editor"],
        clientId: "c1",
        operationId: "op_4",
        baseVersion: 1,
        operations: [
          {
            op: "set",
            path: "nodes.logger",
            value: {
              id: "logger",
              label: "Logger",
              ports: { inputs: [{ id: "input" }], outputs: [] }
            }
          },
          {
            op: "set",
            path: "edges.edge_2",
            value: {
              id: "edge_2",
              sourceNodeId: "http",
              sourcePortId: "response",
              targetNodeId: "logger",
              targetPortId: "input"
            }
          }
        ]
      })
    ).resolves.toMatchObject({ status: "accepted", serverVersion: 2 });
  });

  it("rejects mutations that fail server-side room schema validation", async () => {
    const { coordinator, store } = createCoordinator();
    coordinator.defineRoom("schema_room", {
      schema: z.object({
        nodes: z.record(z.object({
          id: z.string(),
          x: z.number(),
          y: z.number(),
          label: z.string()
        }))
      })
    });
    await coordinator.loadRoom("schema_room", { nodes: {} });

    await expect(
      coordinator.applyMutation({
        roomId: "schema_room",
        userId: "u1",
        clientId: "c1",
        operationId: "op_1",
        baseVersion: 0,
        operations: [
          {
            op: "set",
            path: "nodes.node_1",
            value: { id: "node_1", x: 10, y: 20, label: "Start" }
          }
        ]
      })
    ).resolves.toMatchObject({ status: "accepted", serverVersion: 1 });

    await expect(
      coordinator.applyMutation({
        roomId: "schema_room",
        userId: "u1",
        clientId: "c1",
        operationId: "op_2",
        baseVersion: 1,
        operations: [{ op: "set", path: "nodes.node_1.x", value: "invalid" }]
      })
    ).resolves.toEqual({
      status: "rejected",
      reason: "schema_validation_failed"
    });
    expect(coordinator.getRoomState("schema_room")).toEqual({
      nodes: {
        node_1: { id: "node_1", x: 10, y: 20, label: "Start" }
      }
    });
    expect(await store.getEvents("schema_room")).toHaveLength(1);
  });

  it("supports room-local permission rules without locking down unrelated rooms", async () => {
    const { coordinator } = createCoordinator();
    coordinator.definePermissions("locked_room", [
      { path: "nodes.*.x", operations: ["set", "update"], roles: ["admin"] }
    ]);
    await coordinator.loadRoom("locked_room", {
      nodes: { node_1: { id: "node_1", x: 100 } }
    });
    await coordinator.loadRoom("open_room", {
      nodes: { node_1: { id: "node_1", x: 100 } }
    });

    await expect(
      coordinator.applyMutation({
        roomId: "locked_room",
        userId: "viewer_1",
        roles: ["viewer"],
        clientId: "c1",
        operationId: "op_1",
        baseVersion: 0,
        operations: [{ op: "set", path: "nodes.node_1.x", value: 200 }]
      })
    ).resolves.toEqual({ status: "rejected", reason: "permission_denied:nodes.node_1.x" });

    await expect(
      coordinator.applyMutation({
        roomId: "open_room",
        userId: "viewer_1",
        roles: ["viewer"],
        clientId: "c1",
        operationId: "op_2",
        baseVersion: 0,
        operations: [{ op: "set", path: "nodes.node_1.x", value: 200 }]
      })
    ).resolves.toMatchObject({ status: "accepted", serverVersion: 1 });
  });

  it("uses custom field resolvers for stale concurrent updates", async () => {
    const { coordinator } = createCoordinator();
    await coordinator.loadRoom("project_123", {
      tasks: {
        task_1: { id: "task_1", title: "Ship demo", status: "review" }
      }
    });

    const result = await coordinator.applyMutation({
      roomId: "project_123",
      userId: "u1",
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [
        { op: "update", path: "tasks.task_1.status", value: "in_progress" }
      ]
    });

    expect(result).toMatchObject({
      status: "accepted",
      transformedOperations: [
        { op: "update", path: "tasks.task_1.status", value: "in_progress" }
      ]
    });
    expect(coordinator.getRoomState("project_123")).toEqual({
      tasks: {
        task_1: { id: "task_1", title: "Ship demo", status: "review" }
      }
    });
  });

  it("applies universal set, text, list move, and lock operations", async () => {
    const { coordinator } = createCoordinator();
    await coordinator.loadRoom("universal_room", {
      nodes: {
        node_1: { id: "node_1", label: "Start", lockedBy: null }
      },
      layers: ["background", "node_1", "foreground"]
    });

    const result = await coordinator.applyMutation({
      roomId: "universal_room",
      userId: "u1",
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [
        { op: "set", path: "nodes.node_1.x", value: 42 },
        { op: "text", path: "nodes.node_1.label", value: { index: 5, insert: " here" } },
        { op: "list-move", path: "layers", value: { from: 2, to: 0 } },
        { op: "lock", path: "nodes.node_1.lockedBy", value: { owner: "user_1" } }
      ]
    });

    expect(result).toMatchObject({ status: "accepted", serverVersion: 1 });
    expect(coordinator.getRoomState("universal_room")).toEqual({
      nodes: {
        node_1: { id: "node_1", label: "Start here", lockedBy: "user_1", x: 42 }
      },
      layers: ["foreground", "background", "node_1"]
    });
  });

  it("applies tombstone deletes and ignores stale child updates", async () => {
    const { coordinator } = createCoordinator();
    await coordinator.loadRoom("tombstone_room", {
      nodes: {
        node_1: { id: "node_1", label: "Start" }
      }
    });

    await coordinator.applyMutation({
      roomId: "tombstone_room",
      userId: "u1",
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [
        {
          op: "tombstone-delete",
          path: "nodes.node_1",
          value: { deletedBy: "u1", deletedAt: 123 }
        }
      ]
    });
    await coordinator.applyMutation({
      roomId: "tombstone_room",
      userId: "u2",
      clientId: "c2",
      operationId: "op_2",
      baseVersion: 0,
      operations: [{ op: "set", path: "nodes.node_1.label", value: "Stale update" }]
    });

    expect(coordinator.getRoomState("tombstone_room")).toEqual({
      nodes: {
        node_1: {
          id: "node_1",
          label: "Start",
          __deleted: true,
          __deletedAt: 123,
          __deletedBy: "u1"
        }
      }
    });
  });

  it("moves nodes between ordered tree parents", async () => {
    const { coordinator } = createCoordinator();
    await coordinator.loadRoom("tree_room", {
      tree: {
        root: { id: "root", children: ["node_1", "group"] },
        group: { id: "group", parentId: "root", children: [] },
        node_1: { id: "node_1", parentId: "root", children: [] }
      }
    });

    await coordinator.applyMutation({
      roomId: "tree_room",
      userId: "u1",
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [
        {
          op: "tree-move",
          path: "tree",
          value: { id: "node_1", fromParentId: "root", toParentId: "group", toIndex: 0 }
        }
      ]
    });

    expect(coordinator.getRoomState("tree_room")).toEqual({
      tree: {
        root: { id: "root", children: ["group"] },
        group: { id: "group", parentId: "root", children: ["node_1"] },
        node_1: { id: "node_1", parentId: "group", children: [] }
      }
    });
  });

  it("releases a lock when the lock owner is null", async () => {
    const { coordinator } = createCoordinator();
    await coordinator.loadRoom("lock_room", {
      nodes: {
        node_1: { id: "node_1", lockedBy: "user_1" }
      }
    });

    await coordinator.applyMutation({
      roomId: "lock_room",
      userId: "u1",
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [{ op: "lock", path: "nodes.node_1.lockedBy", value: { owner: null } }]
    });

    expect(coordinator.getRoomState("lock_room")).toEqual({
      nodes: {
        node_1: { id: "node_1", lockedBy: null }
      }
    });
  });

  it("applies crdt-text fields through text operations", async () => {
    const { coordinator } = createCoordinator();
    await coordinator.loadRoom("crdt_room", {
      nodes: {
        node_1: { id: "node_1", label: "Start" }
      }
    });

    await coordinator.applyMutation({
      roomId: "crdt_room",
      userId: "u1",
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [{ op: "text", path: "nodes.node_1.label", value: { index: 5, insert: " here" } }]
    });
    await coordinator.applyMutation({
      roomId: "crdt_room",
      userId: "u2",
      clientId: "c2",
      operationId: "op_2",
      baseVersion: 1,
      operations: [{ op: "text", path: "nodes.node_1.label", value: { index: 6, delete: 4, insert: "there" } }]
    });

    expect(coordinator.getRoomState("crdt_room")).toEqual({
      nodes: {
        node_1: { id: "node_1", label: "Start there" }
      }
    });
  });

  it("hydrates crdt-text fields from materialized snapshots before applying newer text events", async () => {
    const store = new MemoryEventStore();
    await store.saveInitialState("crdt_snapshot_room", {
      nodes: {
        node_1: { id: "node_1", label: "Start" }
      }
    });
    await store.saveSnapshot("crdt_snapshot_room", 1, {
      nodes: {
        node_1: { id: "node_1", label: "Start here" }
      }
    });
    await store.appendEvent({
      roomId: "crdt_snapshot_room",
      userId: "u2",
      clientId: "c2",
      operationId: "op_2",
      version: 2,
      operations: [{ op: "text", path: "nodes.node_1.label", value: { index: 6, delete: 4, insert: "there" } }],
      timestamp: Date.now()
    });

    const coordinator = new RoomCoordinator(store);
    coordinator.defineCollection("nodes", {
      fields: {
        label: { strategy: "crdt-text" }
      }
    });

    const loaded = await coordinator.loadRoom("crdt_snapshot_room");

    expect(loaded.state).toEqual({
      nodes: {
        node_1: { id: "node_1", label: "Start there" }
      }
    });
    expect(await coordinator.replayAt("crdt_snapshot_room", 2)).toEqual({
      nodes: {
        node_1: { id: "node_1", label: "Start there" }
      }
    });
  });

  it("persists crdt-text sidecar state with snapshots", async () => {
    const { coordinator, store } = createCoordinator();
    await coordinator.loadRoom("crdt_sidecar_room", {
      nodes: {
        node_1: { id: "node_1", label: "Start" }
      }
    });

    await coordinator.applyMutation({
      roomId: "crdt_sidecar_room",
      userId: "u1",
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [{ op: "text", path: "nodes.node_1.label", value: { index: 5, insert: " here" } }]
    });
    coordinator.onClientJoin("crdt_sidecar_room", "u1", "c1");
    await coordinator.onClientLeave("crdt_sidecar_room", "c1");

    const sidecars = await store.getCrdtTextStates("crdt_sidecar_room", 1);

    expect(sidecars.get("nodes.node_1.label")?.length).toBeGreaterThan(0);
  });

  it("replays room state at a requested version", async () => {
    const { coordinator } = createCoordinator();
    await coordinator.loadRoom("replay_room", { nodes: {} });

    const ops: Operation[][] = [
      [
        {
          op: "insert",
          path: "nodes.node_1",
          value: { id: "node_1", x: 10, y: 20, label: "Start" }
        }
      ],
      [{ op: "update", path: "nodes.node_1.x", value: 30 }],
      [{ op: "delete", path: "nodes.node_1" }]
    ];

    for (const [index, operations] of ops.entries()) {
      await coordinator.applyMutation({
        roomId: "replay_room",
        userId: `u${index}`,
        clientId: `c${index}`,
        operationId: `op_${index}`,
        baseVersion: index,
        operations
      });
    }

    expect(await coordinator.replayAt("replay_room", 2)).toEqual({
      nodes: {
        node_1: { id: "node_1", x: 30, y: 20, label: "Start" }
      }
    });
    expect(await coordinator.replayAt("replay_room", 3)).toEqual({
      nodes: {}
    });
  });

  it("diffs room state between replay versions with event details", async () => {
    const { coordinator } = createCoordinator();
    await coordinator.loadRoom("diff_room", { nodes: {} });

    await coordinator.applyMutation({
      roomId: "diff_room",
      userId: "u1",
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [
        {
          op: "insert",
          path: "nodes.node_1",
          value: { id: "node_1", x: 10, y: 20, label: "Start" }
        }
      ]
    });
    await coordinator.applyMutation({
      roomId: "diff_room",
      userId: "u2",
      clientId: "c2",
      operationId: "op_2",
      baseVersion: 1,
      operations: [{ op: "update", path: "nodes.node_1.x", value: 30 }]
    });
    await coordinator.applyMutation({
      roomId: "diff_room",
      userId: "u3",
      clientId: "c3",
      operationId: "op_3",
      baseVersion: 2,
      operations: [{ op: "text", path: "nodes.node_1.label", value: { index: 5, insert: " here" } }]
    });

    const diff = await coordinator.diffVersions("diff_room", 1, 3);

    expect(diff).toMatchObject({
      roomId: "diff_room",
      fromVersion: 1,
      toVersion: 3,
      changedPaths: ["nodes.node_1.label", "nodes.node_1.x"],
      events: [
        { version: 2, userId: "u2", operationId: "op_2" },
        { version: 3, userId: "u3", operationId: "op_3" }
      ],
      changes: [
        { path: "nodes.node_1.label", before: "Start", after: "Start here", kind: "changed" },
        { path: "nodes.node_1.x", before: 10, after: 30, kind: "changed" }
      ]
    });
  });

  it("compacts snapshots using the configured interval and retention", async () => {
    const store = new MemoryEventStore();
    const coordinator = new RoomCoordinator(store, {
      snapshotInterval: 2,
      snapshotRetention: 1
    });
    await coordinator.loadRoom("compact_policy_room", { nodes: {} });

    for (let version = 0; version < 4; version++) {
      await coordinator.applyMutation({
        roomId: "compact_policy_room",
        userId: "u1",
        clientId: "c1",
        operationId: `op_${version + 1}`,
        baseVersion: version,
        operations: [{ op: "set", path: "nodes.node_1.x", value: version + 1 }]
      });
    }

    expect(await store.getLatestSnapshot("compact_policy_room", 4)).toMatchObject({ version: 4 });
    expect(await store.getLatestSnapshot("compact_policy_room", 2)).toBeUndefined();
  });

  it("evicts idle rooms after saving their latest snapshot", async () => {
    const store = new MemoryEventStore();
    const coordinator = new RoomCoordinator(store, { idleRoomTtlMs: 10 });
    await coordinator.loadRoom("idle_room", { nodes: {} });
    await coordinator.applyMutation({
      roomId: "idle_room",
      userId: "u1",
      clientId: "c1",
      operationId: "op_1",
      baseVersion: 0,
      operations: [{ op: "set", path: "nodes.node_1", value: { id: "node_1", x: 1 } }]
    });

    coordinator.onClientJoin("idle_room", "u1", "c1");
    await coordinator.onClientLeave("idle_room", "c1");

    const evicted = await coordinator.collectIdleRooms(Date.now() + 11);

    expect(evicted).toEqual(["idle_room"]);
    expect(coordinator.getLoadedRoomIds()).toEqual([]);
    expect(coordinator.getRoomState("idle_room")).toBeUndefined();
    expect(await store.getLatestSnapshot("idle_room")).toMatchObject({ version: 1 });
  });

  it("loads a room from the latest durable snapshot and replays newer events", async () => {
    const store = new MemoryEventStore();
    await store.saveInitialState("durable_room", { nodes: {} });
    await store.saveSnapshot("durable_room", 2, {
      nodes: {
        node_1: { id: "node_1", x: 30, y: 20, label: "Start" }
      }
    });
    await store.appendEvent({
      roomId: "durable_room",
      userId: "u3",
      clientId: "c3",
      operationId: "op_3",
      version: 3,
      operations: [{ op: "update", path: "nodes.node_1.y", value: 90 }],
      timestamp: Date.now()
    });

    const coordinator = new RoomCoordinator(store);
    const loaded = await coordinator.loadRoom("durable_room", { nodes: {} });

    expect(loaded.version).toBe(3);
    expect(loaded.state).toEqual({
      nodes: {
        node_1: { id: "node_1", x: 30, y: 90, label: "Start" }
      }
    });
  });

  it("replays from the nearest snapshot before the target version", async () => {
    const store = new MemoryEventStore();
    await store.saveInitialState("compacted_room", { nodes: {} });
    await store.saveSnapshot("compacted_room", 2, {
      nodes: {
        node_1: { id: "node_1", x: 30, y: 20, label: "Start" }
      }
    });
    await store.appendEvent({
      roomId: "compacted_room",
      userId: "u3",
      clientId: "c3",
      operationId: "op_3",
      version: 3,
      operations: [{ op: "update", path: "nodes.node_1.label", value: "Updated" }],
      timestamp: Date.now()
    });

    const coordinator = new RoomCoordinator(store);

    expect(await coordinator.replayAt("compacted_room", 2)).toEqual({
      nodes: {
        node_1: { id: "node_1", x: 30, y: 20, label: "Start" }
      }
    });
    expect(await coordinator.replayAt("compacted_room", 3)).toEqual({
      nodes: {
        node_1: { id: "node_1", x: 30, y: 20, label: "Updated" }
      }
    });
  });
});
