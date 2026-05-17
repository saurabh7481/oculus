import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SDK documentation guardrails", () => {
  it("documents SDK usage and requires updates when SDK APIs change", () => {
    const sdkDocs = readFileSync("docs/SDK.md", "utf8");
    const agentRules = readFileSync("AGENTS.md", "utf8");

    expect(sdkDocs).toContain("createClient");
    expect(sdkDocs).toContain("stateApi.collection");
    expect(sdkDocs).toContain("presence.update");
    expect(sdkDocs).toContain("replayAt");
    expect(sdkDocs).toContain("diffVersions");
    expect(sdkDocs).toContain("room.comments");
    expect(sdkDocs).toContain("room.assets");
    expect(sdkDocs).toContain("room.shapes");
    expect(sdkDocs).toContain("defineRoom");
    expect(agentRules).toContain("docs/SDK.md");
    expect(agentRules).toContain("SDK");
  });
});
