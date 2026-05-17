import type { Operation } from "@oculus/sdk";
import type { Point } from "../canvas/geometry";

export type WhiteboardTool = "select" | "pencil";

export type WhiteboardShapeType = "sticky" | "freehand" | "rectangle" | "ellipse" | "chart" | "text" | "arrow";

export type WhiteboardShape = {
  id: string;
  environment: "whiteboard";
  type: WhiteboardShapeType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  color?: string;
  points?: Point[];
  values?: number[];
};

export function setWhiteboardShape(shape: WhiteboardShape): Operation {
  return { op: "set", path: `shapes.${shape.id}`, value: shape };
}

export function moveWhiteboardShape(id: string, point: Point): Operation[] {
  return [
    { op: "set", path: `shapes.${id}.x`, value: point.x },
    { op: "set", path: `shapes.${id}.y`, value: point.y }
  ];
}

export function resizeWhiteboardShape(id: string, width: number, height: number): Operation[] {
  return [
    { op: "set", path: `shapes.${id}.width`, value: width },
    { op: "set", path: `shapes.${id}.height`, value: height }
  ];
}
