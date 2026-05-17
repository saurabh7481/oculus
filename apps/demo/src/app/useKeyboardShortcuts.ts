export type ShortcutHandlers = {
  onDelete(): void;
  onEscape(): void;
  onDuplicate(): void;
  onUndo(): void;
  onRedo(): void;
};

export function attachKeyboardShortcuts(handlers: ShortcutHandlers): () => void {
  function isTextInput(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.target instanceof HTMLButtonElement) return;

    const ctrlOrMeta = event.ctrlKey || event.metaKey;

    // Ctrl+Shift+Z / Cmd+Shift+Z → redo (allow even in text inputs)
    if (ctrlOrMeta && event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      handlers.onRedo();
      return;
    }

    // Ctrl+Z / Cmd+Z → undo (allow even in text inputs)
    if (ctrlOrMeta && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      handlers.onUndo();
      return;
    }

    // Ctrl+D / Cmd+D → duplicate (allow even in text inputs — no browser conflict)
    if (ctrlOrMeta && event.key.toLowerCase() === "d") {
      event.preventDefault();
      handlers.onDuplicate();
      return;
    }

    // Escape → deselect / exit pencil mode (allow even in text inputs)
    if (event.key === "Escape") {
      handlers.onEscape();
      return;
    }

    // Skip Delete/Backspace when editing text
    if (isTextInput(event.target)) return;

    // Delete or Backspace → delete selected
    if (event.key === "Delete" || event.key === "Backspace") {
      handlers.onDelete();
      return;
    }
  }

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}
