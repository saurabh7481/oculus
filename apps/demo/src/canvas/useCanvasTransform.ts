import type { Point, Rect, Size } from "./geometry";

export type CanvasTransform = { x: number; y: number; scale: number };

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Compute the new transform when zooming centered on a screen-space origin point.
 * The origin is given relative to the canvas surface top-left corner.
 */
export function zoomTransform(
  transform: CanvasTransform,
  delta: number,
  origin: Point
): CanvasTransform {
  const factor = delta > 0 ? 1.1 : 1 / 1.1;
  const newScale = clampScale(transform.scale * factor);
  const ratio = newScale / transform.scale;
  return {
    x: origin.x - (origin.x - transform.x) * ratio,
    y: origin.y - (origin.y - transform.y) * ratio,
    scale: newScale
  };
}

export function panTransform(transform: CanvasTransform, delta: Point): CanvasTransform {
  return { ...transform, x: transform.x + delta.x, y: transform.y + delta.y };
}

export function resetTransform(): CanvasTransform {
  return { x: 0, y: 0, scale: 1 };
}

export function fitToScreenTransform(bounds: Rect, viewport: Size): CanvasTransform {
  const scaleX = viewport.width / bounds.width;
  const scaleY = viewport.height / bounds.height;
  const scale = Math.min(1, scaleX, scaleY) * 0.9;
  return {
    x: (viewport.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (viewport.height - bounds.height * scale) / 2 - bounds.y * scale,
    scale
  };
}

export function createCanvasTransform() {
  let transform: CanvasTransform = resetTransform();

  return {
    get transform(): CanvasTransform {
      return transform;
    },
    zoom(delta: number, origin: Point): CanvasTransform {
      transform = zoomTransform(transform, delta, origin);
      return transform;
    },
    pan(delta: Point): CanvasTransform {
      transform = panTransform(transform, delta);
      return transform;
    },
    reset(): CanvasTransform {
      transform = resetTransform();
      return transform;
    },
    fitToScreen(bounds: Rect, viewport: Size): CanvasTransform {
      transform = fitToScreenTransform(bounds, viewport);
      return transform;
    }
  };
}
