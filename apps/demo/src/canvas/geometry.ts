export type Point = {
  x: number;
  y: number;
};

export type Size = {
  width: number;
  height: number;
};

export type Rect = Point & Size;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function snap(value: number, gridSize = 8): number {
  return Math.round(value / gridSize) * gridSize;
}

export function moveRect(rect: Rect, delta: Point, gridSize = 8): Rect {
  return {
    ...rect,
    x: snap(rect.x + delta.x, gridSize),
    y: snap(rect.y + delta.y, gridSize)
  };
}

export function resizeRect(rect: Rect, next: Partial<Rect>, minSize: Size = { width: 48, height: 40 }): Rect {
  return {
    x: next.x ?? rect.x,
    y: next.y ?? rect.y,
    width: Math.max(minSize.width, next.width ?? rect.width),
    height: Math.max(minSize.height, next.height ?? rect.height)
  };
}
