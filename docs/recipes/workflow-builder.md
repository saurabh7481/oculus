# Workflow Builder Recipe

This recipe targets n8n/LangFlow-style collaborative workflow builders: nodes, ports, edges, configuration forms, validation, execution metadata, role-based permissions, replay, and offline-safe graph editing.

## Product Requirements

A credible workflow builder environment needs:

- Nodes with positions, labels, types, config, status, and ports.
- Edges between stable source and target ports.
- Edge validation to reject incompatible or duplicate connections.
- Node config form updates.
- Live cursors, selected node/edge awareness, and editing target awareness.
- Role-based permissions for editing, viewing, and running workflows.
- Replay history that explains intent: added node, moved node, connected edge, changed config.
- Undo/redo for graph edits.
- Offline queueing without resurrecting deleted nodes or edges.
- Optional execution state that is separate from durable workflow definition.

## Recommended State Shape

```ts
type WorkflowState = {
  nodes: Record<string, WorkflowNode>;
  edges: Record<string, WorkflowEdge>;
  order: string[];
  comments: Record<string, WorkflowComment>;
  runState?: WorkflowRunState;
};

type WorkflowNode = {
  id: string;
  type: string;
  x: number;
  y: number;
  label: string;
  config: Record<string, unknown>;
  ports: {
    inputs: WorkflowPort[];
    outputs: WorkflowPort[];
  };
  lockedBy?: string | null;
};

type WorkflowPort = {
  id: string;
  kind: "data" | "control" | "error";
  label: string;
  schema?: Record<string, unknown>;
};

type WorkflowEdge = {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
};

type WorkflowRunState = {
  status: "idle" | "running" | "failed" | "complete";
  nodeStatus: Record<string, "pending" | "running" | "failed" | "complete">;
};
```

## Oculus Support Today

| Need | Support | Status |
|---|---|---|
| Node create/update/delete | current demo and collection helpers | Done |
| Edge create/delete | collection helpers | Done |
| Node label text | CRDT text fields | Done |
| Node position updates | field-level `set` | Done |
| Ordered node/layer order | `room.list(...)` | Done |
| Offline-safe deletes | tombstone delete | Done |
| Role-based permissions | server permission rules | Done |
| Replay and diffs | `replayAt`, `diffVersions` | Done |
| Cursor awareness | `room.awareness.updateCursor(...)` | Done |
| Selected node/edge awareness | `room.awareness.updateSelection(...)` | Done |
| Config form updates | generic field updates | Partial |
| Edge validation | `defineRoom(..., { edgeValidators })` | Done |
| Transaction labels | `MutationMetadata.label` | Done |
| Undo/redo | `room.undo()` and `room.redo()` | Done |
| Server-side schema validation | `defineRoom(..., { schema })` | Done |
| Durable vs ephemeral run state guidance | not documented | Missing |

## Missing P0 Capabilities

- Playwright coverage for workflow transactions, undo/redo, awareness, permissions, and edge validation.
- A demo environment that exercises ports, validated edges, node config editing, and replay labels.

## Missing P1 Capabilities

- Recipe guidance for separating durable workflow definition from ephemeral execution state.
- Playwright coverage for comments, schema validation, reconnect, permissions, and replay in graph workflows.
- A polished workflow-builder demo environment that uses comments, validated config, and replay labels directly.

## Preferred SDK Shape

```ts
const workflow = client.room<WorkflowState>("workflow_123");
const nodes = workflow.collection<WorkflowNode>("nodes");
const edges = workflow.collection<WorkflowEdge>("edges");

await workflow.transaction("Connect HTTP node to AI node", async (tx) => {
  tx.validateEdge({
    sourceNodeId: "http_1",
    sourcePortId: "response",
    targetNodeId: "ai_1",
    targetPortId: "prompt"
  });
  tx.create(edges, "edge_1", {
    id: "edge_1",
    sourceNodeId: "http_1",
    sourcePortId: "response",
    targetNodeId: "ai_1",
    targetPortId: "prompt"
  });
});

workflow.awareness.updateSelection(["http_1"]);
workflow.awareness.updateEditing("nodes.http_1.config.url");
```

The transaction and awareness parts of this API now exist. `tx.validateEdge(...)` remains a recipe-level concept; current edge validation is configured server-side with `defineRoom(..., { edgeValidators })`.

## Implementation Notes

Workflow builders need stronger validation than whiteboards or design canvases. The engine should make room for server-side graph validation hooks while keeping basic graph state domain-neutral. Edge validation should likely start as a recipe-level helper, then become a server hook if multiple demos need it.
