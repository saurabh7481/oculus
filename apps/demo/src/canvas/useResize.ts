import { resizeRect, type Point, type Rect } from "./geometry";

export type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

export function resizeFromHandle(rect: Rect, handle: ResizeHandle, delta: Point): Rect {
  const next: Partial<Rect> = {};

  if (handle.includes("e")) next.width = rect.width + delta.x;
  if (handle.includes("s")) next.height = rect.height + delta.y;
  if (handle.includes("w")) {
    next.x = rect.x + delta.x;
    next.width = rect.width - delta.x;
  }
  if (handle.includes("n")) {
    next.y = rect.y + delta.y;
    next.height = rect.height - delta.y;
  }

  return resizeRect(rect, next);
}
