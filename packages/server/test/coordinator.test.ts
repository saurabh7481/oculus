import { describe, expect, it } from "vitest";
import {
  type EventStore,
  MemoryEventStore,
  RoomCoordinator,
  type RoomEvent,
  type Operation
} from "../src/coordinator";

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
