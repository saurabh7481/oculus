import { describe, expect, it } from "vitest";
import {
  applyOperations,
  createCollectionOperations,
  type Operation
} from "../src/index";

describe("SDK operation helpers", () => {
  it("splits collection updates into field-level operations", () => {
    expect(createCollectionOperations("nodes", "node_1", "update", { x: 20, y: 40 })).toEqual([
      { op: "update", path: "nodes.node_1.x", value: 20 },
      { op: "update", path: "nodes.node_1.y", value: 40 }
    ]);
  });

  it("applies insert, update, and delete operations immutably", () => {
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
});
