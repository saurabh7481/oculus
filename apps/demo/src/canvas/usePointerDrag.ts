import type { Point } from "./geometry";

export type DragDraft = {
  id: string;
  start: Point;
  current: Point;
  offset: Point;
};

export function startDrag(id: string, pointer: Point, objectPosition: Point): DragDraft {
  return {
    id,
    start: objectPosition,
    current: objectPosition,
    offset: {
      x: pointer.x - objectPosition.x,
      y: pointer.y - objectPosition.y
    }
  };
}

export function updateDrag(draft: DragDraft, pointer: Point): DragDraft {
  return {
    ...draft,
    current: {
      x: pointer.x - draft.offset.x,
      y: pointer.y - draft.offset.y
    }
  };
}

export function dragDelta(draft: DragDraft): Point {
  return {
    x: draft.current.x - draft.start.x,
    y: draft.current.y - draft.start.y
  };
}
