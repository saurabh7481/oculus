import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyCrdtTextOperation } from "../src/crdt";

describe("CRDT text helpers", () => {
  it("applies text splices through a reusable Yjs document state", () => {
    const first = applyCrdtTextOperation("Start", {
      index: 5,
      insert: " here"
    });

    const second = applyCrdtTextOperation(
      first.text,
      {
        index: 6,
        delete: 4,
        insert: "there"
      },
      first.encodedState
    );

    expect(first.text).toBe("Start here");
    expect(first.encodedState.length).toBeGreaterThan(0);
    expect(second.text).toBe("Start there");
    expect(second.encodedState.length).toBeGreaterThan(0);
  });

  it("accepts native Yjs update payloads", () => {
    const doc = new Y.Doc();
    doc.getText("value").insert(0, "Native text");
    const yjsUpdate = Array.from(Y.encodeStateAsUpdate(doc));

    const result = applyCrdtTextOperation("", { yjsUpdate });

    expect(result.text).toBe("Native text");
    expect(result.encodedState.length).toBeGreaterThan(0);
  });
});
