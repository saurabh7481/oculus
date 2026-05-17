import postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  migratePostgresEventStore,
  PostgresEventStore
} from "../src/postgres-store";

const testUrl = process.env.OCULUS_POSTGRES_TEST_URL;

describe.skipIf(!testUrl)("PostgresEventStore", () => {
  it("persists initial state, events, and versioned snapshots", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const store = new PostgresEventStore(sql);
    const roomId = `store_${crypto.randomUUID()}`;

    try {
      await migratePostgresEventStore(sql);
      await store.saveInitialState(roomId, { nodes: {} });
      await store.saveInitialState(roomId, { nodes: { ignored: true } });
      await store.appendEvent({
        roomId,
        userId: "u1",
        clientId: "c1",
        operationId: "op_1",
        version: 1,
        operations: [
          {
            op: "insert",
            path: "nodes.node_1",
            value: { id: "node_1", x: 10, y: 20, label: "Start" }
          }
        ],
        timestamp: 1_700_000_000_001
      });
      await store.appendEvent({
        roomId,
        userId: "u2",
        clientId: "c2",
        operationId: "op_2",
        version: 2,
        operations: [{ op: "update", path: "nodes.node_1.x", value: 40 }],
        timestamp: 1_700_000_000_002
      });
      await store.saveSnapshot(roomId, 1, {
        nodes: {
          node_1: { id: "node_1", x: 10, y: 20, label: "Start" }
        }
      });
      await store.saveSnapshot(roomId, 2, {
        nodes: {
          node_1: { id: "node_1", x: 40, y: 20, label: "Start" }
        }
      });
      await store.saveCrdtTextStates(
        roomId,
        1,
        new Map([["nodes.node_1.label", [1, 2, 3]]])
      );
      await store.saveCrdtTextStates(
        roomId,
        2,
        new Map([["nodes.node_1.label", [4, 5, 6]]])
      );

      expect(await store.loadInitialState(roomId)).toEqual({ nodes: {} });
      expect(await store.getEvents(roomId, 1)).toMatchObject([
        {
          roomId,
          userId: "u2",
          clientId: "c2",
          operationId: "op_2",
          version: 2,
          operations: [{ op: "update", path: "nodes.node_1.x", value: 40 }]
        }
      ]);
      expect(await store.getLatestSnapshot(roomId, 1)).toEqual({
        version: 1,
        state: {
          nodes: {
            node_1: { id: "node_1", x: 10, y: 20, label: "Start" }
          }
        }
      });
      expect(await store.getLatestSnapshot(roomId)).toEqual({
        version: 2,
        state: {
          nodes: {
            node_1: { id: "node_1", x: 40, y: 20, label: "Start" }
          }
        }
      });
      expect(await store.getCrdtTextStates(roomId, 1)).toEqual(
        new Map([["nodes.node_1.label", [1, 2, 3]]])
      );
      expect(await store.getCrdtTextStates(roomId)).toEqual(
        new Map([["nodes.node_1.label", [4, 5, 6]]])
      );
    } finally {
      await sql`delete from room_crdt_text_states where room_id = ${roomId}`;
      await sql`delete from room_snapshots where room_id = ${roomId}`;
      await sql`delete from room_events where room_id = ${roomId}`;
      await sql`delete from rooms where id = ${roomId}`;
      await sql.end();
    }
  });
});
