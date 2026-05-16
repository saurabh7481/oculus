import { describe, expect, it } from "vitest";
import {
  MemoryEventStore,
  RoomCoordinator,
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
});
