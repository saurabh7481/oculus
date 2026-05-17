import * as Y from "yjs";
import type { TextOperationValue } from "./coordinator";

export type CrdtTextResult = {
  text: string;
  encodedState: number[];
};

export function applyCrdtTextOperation(
  current: unknown,
  operation: TextOperationValue,
  encodedState?: number[]
): CrdtTextResult {
  const doc = new Y.Doc();
  const text = doc.getText("value");

  if (encodedState?.length) {
    Y.applyUpdate(doc, Uint8Array.from(encodedState));
  } else if (typeof current === "string" && current.length > 0) {
    text.insert(0, current);
  }

  if (operation.yjsUpdate?.length) {
    Y.applyUpdate(doc, Uint8Array.from(operation.yjsUpdate));
    return {
      text: text.toString(),
      encodedState: Array.from(Y.encodeStateAsUpdate(doc))
    };
  }

  const existing = text.toString();
  const index = clampInteger(operation.index ?? existing.length, 0, existing.length);
  const deleteCount = clampInteger(operation.delete ?? 0, 0, existing.length - index);

  doc.transact(() => {
    if (deleteCount > 0) text.delete(index, deleteCount);
    if (operation.insert) text.insert(index, operation.insert);
  });

  return {
    text: text.toString(),
    encodedState: Array.from(Y.encodeStateAsUpdate(doc))
  };
}

export function encodeCrdtTextState(value: unknown): number[] {
  const doc = new Y.Doc();
  const text = doc.getText("value");
  if (typeof value === "string" && value.length > 0) {
    text.insert(0, value);
  }
  return Array.from(Y.encodeStateAsUpdate(doc));
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
