import type { Operation } from "@oculus/sdk";
import type { Point } from "../canvas/geometry";

export type WorkflowNodeKind = "trigger" | "action" | "decision";

export type WorkflowNode = {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  label: string;
  kind: WorkflowNodeKind;
  color?: string;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
};

export function setWorkflowNode(node: WorkflowNode): Operation {
  return { op: "set", path: `nodes.${node.id}`, value: node };
}

export function moveWorkflowNode(id: string, point: Point): Operation[] {
  return [
    { op: "set", path: `nodes.${id}.x`, value: point.x },
    { op: "set", path: `nodes.${id}.y`, value: point.y }
  ];
}

export function setWorkflowEdge(edge: WorkflowEdge): Operation {
  return { op: "set", path: `edges.${edge.id}`, value: edge };
}

export function deleteWorkflowNodeWithEdges(id: string, edges: WorkflowEdge[]): Operation[] {
  return [
    { op: "delete", path: `nodes.${id}` },
    ...edges
      .filter((edge) => edge.source === id || edge.target === id)
      .map((edge): Operation => ({ op: "delete", path: `edges.${edge.id}` }))
  ];
}
