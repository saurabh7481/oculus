# Usable Whiteboard And Workflow Apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Oculus demo into two actually usable collaborative apps: a whiteboard and a workflow builder with shareable rooms, polished UI, responsive layout, smooth canvas interactions, and reliable collaboration primitives.

**Architecture:** Keep the SDK and server generic; build app-specific behavior in `apps/demo/src/whiteboard`, `apps/demo/src/workflow`, and shared canvas primitives in `apps/demo/src/canvas`. The app shell owns routing, room creation, sharing, presence, replay, theme, and sidebars; each environment owns tools, object rendering, mutations, and selection behavior.

**Tech Stack:** Bun, TypeScript, Svelte 5, Vite, Tailwind CSS v4, shadcn-style owned Svelte components, Playwright, Vitest, Oculus SDK/Svelte store.

---

## File Structure

Current foundation files:

- `apps/demo/src/App.svelte`: top-level route switch. `/` shows room launcher; `/whiteboard/:roomId` and `/workflow/:roomId` join rooms.
- `apps/demo/src/app/AppShell.svelte`: temporary integrated shell holding existing whiteboard/workflow behavior while extraction proceeds.
- `apps/demo/src/app/RoomHome.svelte`: room launcher.
- `apps/demo/src/ui/*`: shadcn-style owned UI primitives.
- `apps/demo/src/canvas/*`: shared geometry, drag, resize and stage primitives.
- `apps/demo/src/whiteboard/*`: whiteboard model and future app components.
- `apps/demo/src/workflow/*`: workflow model and future app components.
- `tests/e2e/demo-collaboration.spec.ts`: current e2e coverage for room links, collaboration, drawing, workflow links, dark mode, collapsible sidebars, replay overflow.

Target structure:

```txt
apps/demo/src/
  app/
    AppShell.svelte
    RoomHome.svelte
    RoomToolbar.svelte
    RoomPresence.svelte
    RoomHistory.svelte
    ShareRoomDialog.svelte
  canvas/
    CanvasStage.svelte
    CanvasObject.svelte
    ResizeHandles.svelte
    SelectionBox.svelte
    geometry.ts
    usePointerDrag.ts
    useResize.ts
  whiteboard/
    WhiteboardApp.svelte
    WhiteboardToolbar.svelte
    WhiteboardObject.svelte
    whiteboard-model.ts
  workflow/
    WorkflowApp.svelte
    WorkflowToolbar.svelte
    WorkflowNode.svelte
    WorkflowEdgeLayer.svelte
    workflow-model.ts
  ui/
    button/
    dialog/
    sidebar/
    tooltip/
    input/
    scroll-area/
    toggle-group/
```

## Task 1: Keep The Room System Stable

**Files:**
- Modify: `apps/demo/src/App.svelte`
- Modify: `apps/demo/src/app/RoomHome.svelte`
- Modify: `tests/e2e/demo-collaboration.spec.ts`

- [x] **Step 1: Write failing route test**

```ts
test("creates shareable whiteboard and workflow room URLs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Oculus Studio" })).toBeVisible();
  await expect(page.getByText("Create a collaborative room")).toBeVisible();

  await page.getByRole("button", { name: /new whiteboard/i }).click();
  await expect(page).toHaveURL(/\/whiteboard\/room_/);
  await expect(page.getByRole("heading", { name: "Whiteboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: /share/i })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: /new workflow/i }).click();
  await expect(page).toHaveURL(/\/workflow\/room_/);
  await expect(page.getByRole("heading", { name: "Workflow Builder" })).toBeVisible();
});
```

- [x] **Step 2: Run red test**

Run: `bun run test:e2e`

Expected before implementation: fails because `/` does not show `Create a collaborative room`.

- [x] **Step 3: Implement route switch**

`App.svelte` should parse:

```ts
type RoomKind = "whiteboard" | "workflow";
type Route =
  | { name: "home" }
  | { name: "room"; kind: RoomKind; roomId: string };
```

`createRoom(kind)` should generate `room_${crypto.randomUUID().slice(0, 8)}` and navigate to `/${kind}/${roomId}`.

- [x] **Step 4: Verify**

Run:

```bash
bun run test:e2e
bun run typecheck
bun run build
```

Expected: e2e route test passes and direct room URLs still join the same room.

## Task 2: Finish Tailwind And shadcn-Style Foundation

**Files:**
- Modify: `apps/demo/package.json`
- Modify: `apps/demo/vite.config.ts`
- Modify: `apps/demo/src/styles.css`
- Create: `apps/demo/src/lib/cn.ts`
- Create: `apps/demo/src/ui/button/Button.svelte`
- Create: `apps/demo/src/ui/dialog/Dialog.svelte`
- Create: `apps/demo/src/ui/sidebar/Sidebar.svelte`
- Create: `apps/demo/src/ui/tooltip/Tooltip.svelte`
- Create later: `apps/demo/src/ui/input/Input.svelte`
- Create later: `apps/demo/src/ui/scroll-area/ScrollArea.svelte`
- Create later: `apps/demo/src/ui/toggle-group/ToggleGroup.svelte`

- [x] **Step 1: Add Tailwind and helper dependencies**

```json
{
  "dependencies": {
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.4.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.17",
    "tailwindcss": "^4.1.17"
  }
}
```

- [x] **Step 2: Register Tailwind Vite plugin**

```ts
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), svelte()]
});
```

- [x] **Step 3: Import Tailwind**

```css
@import "tailwindcss";
```

- [x] **Step 4: Add base primitives**

Add owned components for Button, Dialog, Sidebar and Tooltip. These are intentionally local code, matching the shadcn ownership model.

- [ ] **Step 5: Add form and layout primitives**

Create `Input`, `Textarea`, `ScrollArea`, `ToggleGroup`, and `Badge` components before converting environment toolbars.

- [ ] **Step 6: Replace raw toolbar buttons**

Update `AppShell.svelte`, `WhiteboardToolbar.svelte`, and `WorkflowToolbar.svelte` to use owned `Button` and `ToggleGroup`.

- [ ] **Step 7: Verify**

Run:

```bash
bun run typecheck
bun run build
bun run test:e2e
```

Expected: no Svelte warnings, room launcher and existing interactions still pass.

## Task 3: Extract Shared Canvas Primitives

**Files:**
- Create/modify: `apps/demo/src/canvas/geometry.ts`
- Create/modify: `apps/demo/src/canvas/usePointerDrag.ts`
- Create/modify: `apps/demo/src/canvas/useResize.ts`
- Create/modify: `apps/demo/src/canvas/CanvasStage.svelte`
- Create: `apps/demo/src/canvas/CanvasObject.svelte`
- Create/modify: `apps/demo/src/canvas/ResizeHandles.svelte`
- Create: `apps/demo/src/canvas/SelectionBox.svelte`
- Modify: `apps/demo/src/app/AppShell.svelte`
- Test: `tests/e2e/demo-collaboration.spec.ts`

- [x] **Step 1: Add geometry and draft drag helpers**

`geometry.ts` exposes `Point`, `Rect`, `snap`, `moveRect`, `resizeRect`.

`usePointerDrag.ts` exposes `startDrag`, `updateDrag`, `dragDelta`.

- [x] **Step 2: Add resize helper**

`useResize.ts` exposes:

```ts
export type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
export function resizeFromHandle(rect: Rect, handle: ResizeHandle, delta: Point): Rect;
```

- [x] **Step 3: Write failing resize e2e**

Add to `tests/e2e/demo-collaboration.spec.ts`:

```ts
await ada.getByRole("button", { name: /rectangle/i }).click();
const rectangle = ada.getByTestId("whiteboard-rectangle").last();
const before = await rectangle.boundingBox();
await dragBy(ada.getByLabel("Resize se").last(), ada, 80, 50);
const after = await rectangle.boundingBox();
expect(after!.width).toBeGreaterThan(before!.width);
expect(after!.height).toBeGreaterThan(before!.height);
```

Expected: fails before resize handles are wired.

- [x] **Step 4: Wire resize draft state**

Add an `activeResize` state in the environment app:

```ts
let resize:
  | {
      collection: CollectionName;
      id: string;
      handle: ResizeHandle;
      startPointer: Point;
      startRect: Rect;
      currentRect: Rect;
    }
  | null = null;
```

On pointer move, calculate `currentRect = resizeFromHandle(startRect, handle, delta)`.

- [x] **Step 5: Commit resize transaction on pointer up**

For shapes/frames/nodes, commit:

```ts
await room.transaction("Resize object", [
  { op: "set", path: `${collection}.${id}.x`, value: currentRect.x },
  { op: "set", path: `${collection}.${id}.y`, value: currentRect.y },
  { op: "set", path: `${collection}.${id}.width`, value: currentRect.width },
  { op: "set", path: `${collection}.${id}.height`, value: currentRect.height }
]);
```

- [x] **Step 6: Verify**

Run:

```bash
bun run test:e2e
bun run typecheck
```

Expected: resize test passes and drag remains smooth.

## Task 4: Extract WhiteboardApp

**Files:**
- Modify: `apps/demo/src/app/AppShell.svelte`
- Modify: `apps/demo/src/whiteboard/WhiteboardApp.svelte`
- Create: `apps/demo/src/whiteboard/WhiteboardToolbar.svelte`
- Create: `apps/demo/src/whiteboard/WhiteboardObject.svelte`
- Modify: `apps/demo/src/whiteboard/whiteboard-model.ts`
- Test: `tests/e2e/whiteboard-room.spec.ts`

- [x] **Step 1: Write focused whiteboard e2e**

Create `tests/e2e/whiteboard-room.spec.ts`:

```ts
test("whiteboard room supports core object operations", async ({ page }) => {
  await page.goto("/whiteboard/e2e-whiteboard-room");
  await page.getByRole("button", { name: /add sticky/i }).click();
  await expect(page.getByTestId("whiteboard-sticky")).toHaveCount(1);
  await page.getByRole("button", { name: /rectangle/i }).click();
  await expect(page.getByTestId("whiteboard-rectangle")).toHaveCount(1);
  await page.getByRole("button", { name: /pencil/i }).click();
  await drawOnCanvas(page);
  await expect.poll(() => page.getByTestId("freehand-stroke").count()).toBeGreaterThan(0);
});
```

- [x] **Step 2: Move whiteboard toolbar**

Move the whiteboard branch of `command-bar` into `WhiteboardToolbar.svelte` with props:

```ts
tool: WhiteboardTool;
selected: boolean;
onToolChange(tool: WhiteboardTool): void;
onAddSticky(): void;
onAddShape(type: "rectangle" | "ellipse" | "chart"): void;
onDeleteSelected(): void;
```

- [x] **Step 3: Move whiteboard stage**

Move whiteboard rendering into `WhiteboardApp.svelte` with props for shapes, selected ID, draft drag/resize state, and callbacks.

- [x] **Step 4: Keep behavior identical**

Do not add new features in extraction. The existing e2e must still pass.

- [x] **Step 5: Verify**

Run:

```bash
bun run test:e2e
bun run typecheck
bun run build
```

Expected: old combined e2e and new whiteboard e2e pass.

## Task 5: Extract WorkflowApp

**Files:**
- Modify: `apps/demo/src/app/AppShell.svelte`
- Modify: `apps/demo/src/workflow/WorkflowApp.svelte`
- Create: `apps/demo/src/workflow/WorkflowToolbar.svelte`
- Create: `apps/demo/src/workflow/WorkflowNode.svelte`
- Create: `apps/demo/src/workflow/WorkflowEdgeLayer.svelte`
- Modify: `apps/demo/src/workflow/workflow-model.ts`
- Test: `tests/e2e/workflow-room.spec.ts`

- [x] **Step 1: Write focused workflow e2e**

Create `tests/e2e/workflow-room.spec.ts`:

```ts
test("workflow room supports node operations and drag linking", async ({ page }) => {
  await page.goto("/workflow/e2e-workflow-room");
  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByRole("button", { name: /add node/i }).click();
  await expect(page.getByTestId("workflow-node")).toHaveCount(2);
  await dragConnector(page, page.getByTestId("workflow-node").nth(0), page.getByTestId("workflow-node").nth(1));
  await expect.poll(() => page.getByTestId("workflow-edge").count()).toBeGreaterThan(0);
});
```

- [x] **Step 2: Move workflow toolbar**

Move workflow branch of `command-bar` into `WorkflowToolbar.svelte`.

- [x] **Step 3: Move edge layer**

Move SVG edge rendering and preview edge into `WorkflowEdgeLayer.svelte`.

- [x] **Step 4: Move node rendering**

Move node card and connector handle into `WorkflowNode.svelte`.

- [x] **Step 5: Verify**

Run:

```bash
bun run test:e2e
bun run typecheck
bun run build
```

Expected: old combined e2e and new workflow e2e pass.

## Task 6: Make Resizing Production-Useful

**Files:**
- Modify: `apps/demo/src/canvas/ResizeHandles.svelte`
- Modify: `apps/demo/src/whiteboard/WhiteboardObject.svelte`
- Modify: `apps/demo/src/workflow/WorkflowNode.svelte`
- Modify: `apps/demo/src/whiteboard/whiteboard-model.ts`
- Modify: `apps/demo/src/workflow/workflow-model.ts`

- [ ] **Step 1: Add visible handles only when selected**

Selected objects render 8 handles. Unselected objects render none.

- [ ] **Step 2: Support minimum sizes**

Use:

```ts
const minSizes = {
  sticky: { width: 120, height: 84 },
  rectangle: { width: 56, height: 40 },
  ellipse: { width: 56, height: 40 },
  chart: { width: 150, height: 100 },
  workflowNode: { width: 140, height: 64 }
};
```

- [ ] **Step 3: Add resize-aware models**

Use model helpers:

```ts
resizeWhiteboardShape(id, width, height)
resizeWorkflowNode(id, width, height)
```

- [ ] **Step 4: Verify undo**

After resizing, click Undo and assert width/height return.

## Task 7: Make Drag Feel Native

**Files:**
- Modify: `apps/demo/src/canvas/usePointerDrag.ts`
- Modify: `apps/demo/src/canvas/CanvasObject.svelte`
- Modify: `apps/demo/src/whiteboard/WhiteboardObject.svelte`
- Modify: `apps/demo/src/workflow/WorkflowNode.svelte`

- [ ] **Step 1: Keep local transforms during drag**

During drag, render:

```svelte
style={`transform: translate(${draftDelta.x}px, ${draftDelta.y}px)`}
```

Do not mutate `left/top` until pointer up.

- [ ] **Step 2: Add transition only after drag**

Objects should not transition while dragging. After commit, use a short transition:

```css
.canvas-object:not(.dragging) {
  transition: transform 120ms ease, left 120ms ease, top 120ms ease;
}
```

- [ ] **Step 3: Verify visually and by e2e**

Add an assertion that the dragged object has class `dragging` during pointer movement.

## Task 8: Add Real Room Sharing UX

**Files:**
- Modify: `apps/demo/src/app/ShareRoomDialog.svelte`
- Modify: `apps/demo/src/app/AppShell.svelte`
- Test: `tests/e2e/share-room.spec.ts`

- [ ] **Step 1: Extract share dialog**

Move current inline dialog into `ShareRoomDialog.svelte`.

- [ ] **Step 2: Add copy success state**

After copy, show `Copied`.

- [ ] **Step 3: Add join test**

Test:

```ts
await page.goto("/whiteboard/e2e-share-room");
await page.getByRole("button", { name: /share/i }).click();
await expect(page.getByDisplayValue(/\/whiteboard\/e2e-share-room/)).toBeVisible();
```

## Task 9: Responsive App Layout

**Files:**
- Modify: `apps/demo/src/app/AppShell.svelte`
- Modify: `apps/demo/src/styles.css`
- Create: `tests/e2e/layout.spec.ts`

- [ ] **Step 1: Desktop test**

Viewport `1366x768`; assert nav, canvas, inspector visible.

- [ ] **Step 2: Tablet test**

Viewport `900x768`; assert inspector becomes drawer/collapsible bottom region.

- [ ] **Step 3: Mobile test**

Viewport `390x844`; assert toolbar wraps, room is usable, page does not horizontally scroll.

- [ ] **Step 4: Implement responsive CSS**

Use Tailwind utilities and minimal component CSS. Canvas should remain the main visible area.

## Task 10: Split E2E Tests And Remove Mega-Test

**Files:**
- Create: `tests/e2e/room-routing.spec.ts`
- Create: `tests/e2e/whiteboard-room.spec.ts`
- Create: `tests/e2e/workflow-room.spec.ts`
- Create: `tests/e2e/layout.spec.ts`
- Modify/delete: `tests/e2e/demo-collaboration.spec.ts`

- [ ] **Step 1: Move route test**

Move `creates shareable whiteboard and workflow room URLs` to `room-routing.spec.ts`.

- [ ] **Step 2: Move whiteboard behavior**

Move whiteboard behavior into `whiteboard-room.spec.ts`.

- [ ] **Step 3: Move workflow behavior**

Move workflow behavior into `workflow-room.spec.ts`.

- [ ] **Step 4: Keep collaboration smoke test**

Keep one small two-tab test that only proves cross-tab sync and presence.

## Task 11: Canvas Pan & Zoom

**Files:**
- Create: `apps/demo/src/canvas/useCanvasTransform.ts`
- Modify: `apps/demo/src/canvas/CanvasStage.svelte`
- Modify: `apps/demo/src/whiteboard/WhiteboardApp.svelte`
- Modify: `apps/demo/src/workflow/WorkflowApp.svelte`
- Test: `tests/e2e/canvas-pan-zoom.spec.ts`

Without pan/zoom the canvas fills up after ~20 objects. Real sessions (sprint planning, architecture diagrams, process maps) require infinite-feeling space.

- [x] **Step 1: Write failing pan/zoom e2e**

```ts
test("canvas supports zoom with wheel and pan with space+drag", async ({ page }) => {
  await page.goto("/whiteboard/e2e-zoom-room");
  const canvas = page.getByTestId("studio-canvas");
  await canvas.waitFor();
  // Zoom in
  await canvas.dispatchEvent("wheel", { deltaY: -120, ctrlKey: true });
  await expect(canvas.locator(".canvas-viewport")).toHaveCSS("transform", /scale\(1\.[1-9]/);
  // Reset zoom
  await page.keyboard.press("Shift+0");
  await expect(canvas.locator(".canvas-viewport")).toHaveCSS("transform", /scale\(1\)/);
});
```

- [x] **Step 2: Implement `useCanvasTransform`**

```ts
export type CanvasTransform = { x: number; y: number; scale: number };

export function createCanvasTransform(): {
  transform: CanvasTransform;
  zoom(delta: number, origin: Point): void;
  pan(delta: Point): void;
  reset(): void;
  fitToScreen(bounds: Rect, viewport: Size): void;
};
```

- [x] **Step 3: Apply transform to canvas viewport div**

Wrap stage content in `<div class="canvas-viewport">` with CSS:

```css
.canvas-viewport {
  transform-origin: 0 0;
  transform: translate(var(--pan-x), var(--pan-y)) scale(var(--zoom));
  will-change: transform;
}
```

- [x] **Step 4: Wire events**

- `wheel` with `ctrlKey/metaKey` = zoom centered on cursor position
- `wheel` without modifier = pan (scroll behavior)
- `Space + pointerdown + pointermove` = pan
- `Shift+0` = reset to 1:1
- Show zoom level badge (e.g., `100%`) in bottom-left corner

- [x] **Step 5: Convert pointer events to canvas space**

Update `canvasPoint()` to divide by scale and subtract pan offset so drag/resize still works correctly in any zoom level.

- [x] **Step 6: Verify**

```bash
bun run test:e2e
bun run typecheck
```

## Task 12: Keyboard Shortcuts

**Files:**
- Create: `apps/demo/src/app/useKeyboardShortcuts.ts`
- Modify: `apps/demo/src/app/AppShell.svelte`
- Modify: `apps/demo/src/whiteboard/WhiteboardApp.svelte`
- Modify: `apps/demo/src/workflow/WorkflowApp.svelte`

Real-world: every whiteboard/workflow user reaches for Delete, Escape, and Ctrl+D constantly. Without these, the tool feels broken.

- [x] **Step 1: Write failing keyboard e2e**

```ts
test("keyboard shortcuts work for selection and deletion", async ({ page }) => {
  await page.goto("/whiteboard/e2e-keyboard-room");
  await page.getByRole("button", { name: /add sticky/i }).click();
  await expect(page.getByTestId("whiteboard-sticky")).toHaveCount(1);
  // Click to select
  await page.getByTestId("whiteboard-sticky").click();
  // Ctrl+D duplicates
  await page.keyboard.press("Control+d");
  await expect(page.getByTestId("whiteboard-sticky")).toHaveCount(2);
  // Delete removes selected
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("whiteboard-sticky")).toHaveCount(1);
  // Escape deselects
  await page.getByTestId("whiteboard-sticky").click();
  await page.keyboard.press("Escape");
  // No selection ring visible
});
```

- [x] **Step 2: Implement `useKeyboardShortcuts`**

```ts
export type ShortcutHandlers = {
  onDelete(): void;
  onEscape(): void;
  onDuplicate(): void;
  onUndo(): void;
  onRedo(): void;
};

export function attachKeyboardShortcuts(handlers: ShortcutHandlers): () => void;
```

- [x] **Step 3: Wire shortcuts**

| Key | Action |
|-----|--------|
| `Delete` / `Backspace` | Delete selected (skip if focus is in input/textarea) |
| `Escape` | Deselect, exit draw mode |
| `Ctrl+D` / `Cmd+D` | Duplicate selected object (offset +24px) |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |

- [x] **Step 4: Implement duplicate**

Duplicate reads the selected object from state, creates a copy with new ID at `x+24, y+24`, commits as a single transaction.

- [x] **Step 5: Verify**

```bash
bun run test:e2e
bun run typecheck
```

## Task 13: Color Picker for Stickies and Shapes

**Files:**
- Create: `apps/demo/src/ui/color-picker/ColorPicker.svelte`
- Modify: `apps/demo/src/app/AppShell.svelte` (inspector section)
- Modify: `apps/demo/src/whiteboard/WhiteboardApp.svelte`

Real-world: every retro, brainstorm, or planning session uses color conventions — red = blocker, green = done, yellow = todo. Without color control, stickies are decorative.

- [x] **Step 1: Write failing color e2e**

```ts
test("selected sticky color changes via inspector", async ({ page }) => {
  await page.goto("/whiteboard/e2e-color-room");
  await page.getByRole("button", { name: /add sticky/i }).click();
  await page.getByTestId("whiteboard-sticky").click();
  await page.getByLabel("Rose").click(); // color swatch
  await expect(page.getByTestId("whiteboard-sticky")).toHaveCSS("background-color", /rose|#ffe4e6/i);
});
```

- [x] **Step 2: Create `ColorPicker.svelte`**

12 preset swatches matching Tailwind 100-level palette colors:

```ts
const PALETTE = [
  { name: "Yellow", value: "#fef9c3" },
  { name: "Amber", value: "#fef3c7" },
  { name: "Orange", value: "#ffedd5" },
  { name: "Rose", value: "#ffe4e6" },
  { name: "Pink", value: "#fce7f3" },
  { name: "Purple", value: "#f3e8ff" },
  { name: "Indigo", value: "#e0e7ff" },
  { name: "Blue", value: "#dbeafe" },
  { name: "Cyan", value: "#cffafe" },
  { name: "Teal", value: "#ccfbf1" },
  { name: "Green", value: "#dcfce7" },
  { name: "Slate", value: "#f1f5f9" },
];
```

Each swatch has `aria-label={name}` for testability. Selected swatch shows a ring.

- [x] **Step 3: Show picker in inspector when object selected**

When a shape or sticky is selected, inspector shows color picker. On pick, commit `set shapes.${id}.color`.

- [x] **Step 4: Verify**

```bash
bun run test:e2e
bun run typecheck
```

## Task 14: Workflow Edge Labels

**Files:**
- Modify: `apps/demo/src/workflow/WorkflowApp.svelte`
- Modify: `apps/demo/src/workflow/WorkflowEdgeLayer.svelte`
- Modify: `apps/demo/src/workflow/workflow-model.ts`
- Test: `tests/e2e/workflow-room.spec.ts`

Real-world: a decision node branches to "Approved" and "Rejected". Without labels, flow branches are ambiguous. Every real flow tool (Lucidchart, Draw.io, Miro) supports edge labels.

- [x] **Step 1: Add `label` to `WorkflowEdge` model**

```ts
export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};
```

- [x] **Step 2: Render label mid-edge**

Edge label renders as a `<text>` element at the midpoint of the SVG line. When empty, show nothing. When selected, show a small `<foreignObject>` with an input.

- [x] **Step 3: Click edge to select and edit label**

Click on edge line (or mid-point region) selects it. Inspector panel shows label input. On blur/enter, commit `set edges.${id}.label`.

- [x] **Step 4: Write failing e2e**

```ts
test("workflow edge supports labels", async ({ page }) => {
  await page.goto("/workflow/e2e-edge-label-room");
  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByRole("button", { name: /add node/i }).click();
  // Connect
  await dragConnector(page, page.getByTestId("workflow-node").nth(0), page.getByTestId("workflow-node").nth(1));
  // Select edge and add label via inspector
  await page.getByTestId("workflow-edge").click();
  await page.getByLabel("Edge label").fill("Approved");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("edge-label-text")).toHaveText("Approved");
});
```

- [x] **Step 5: Verify**

```bash
bun run test:e2e
bun run typecheck
```

## Task 15: Workflow Node Visual Differentiation

**Files:**
- Modify: `apps/demo/src/workflow/WorkflowNode.svelte`
- Modify: `apps/demo/src/styles.css`

Real-world: a workflow with 10 nodes is unreadable if every node looks the same. Flow tools visually encode node types — diamond for decisions, pill for triggers, rectangle for actions.

- [x] **Step 1: Add node shape variants**

| Kind | Visual |
|------|--------|
| `trigger` | Pill shape (fully rounded), lightning icon, blue accent |
| `action` | Rectangle (current default), solid border |
| `decision` | Diamond (rotated 45° square via CSS), purple accent |

CSS:
```css
.workflow-node.trigger { border-radius: 9999px; }
.workflow-node.decision { transform: rotate(45deg); }
.workflow-node.decision .node-content { transform: rotate(-45deg); }
```

- [x] **Step 2: Add node type icons**

Import from lucide-svelte: `Zap` for trigger, `GitBranch` for decision, `Play` for action. Render inside node card alongside label.

- [x] **Step 3: Verify existing e2e still passes**

No new e2e needed — visual change only, but existing selector `[data-testid="workflow-node"]` must still work.

```bash
bun run test:e2e
bun run typecheck
```

## Completion Checklist

- [x] Whiteboard app has move, resize, draw, shape, sticky, chart, delete, undo/redo.
- [x] Workflow app has add, move, resize/autosize, drag-connect, delete, undo/redo.
- [x] Canvas supports pan and zoom (wheel, space+drag, Shift+0 reset).
- [x] Keyboard shortcuts: Delete, Escape, Ctrl+D, Ctrl+Z/Y.
- [x] Color picker visible in inspector when shape/sticky selected.
- [x] Workflow edges support optional labels editable via inspector.
- [x] Workflow node types are visually distinct (pill, rectangle, diamond).
- [x] Room home creates shareable URLs.
- [ ] Share dialog copies the current URL.
- [ ] Sidebars collapse.
- [ ] Dark mode works.
- [ ] Layout is usable on desktop, tablet, mobile.
- [ ] Replay/history scrolls internally.
- [ ] E2E tests are split by product area.
- [ ] `bun run test` passes.
- [ ] `bun run typecheck` passes.
- [ ] `bun run build` passes.
- [ ] `bun run test:e2e` passes.

## Self-Review

- Spec coverage: Covers room creation/share links, Tailwind/shadcn foundation, whiteboard, workflow, resize, smooth drag, pan/zoom, keyboard shortcuts, color picker, edge labels, node visual types, responsive layout, undo/replay, and tests.
- Placeholder scan: No TBD/TODO placeholders are present; incomplete future work is tracked as explicit checkbox tasks.
- Type consistency: Uses existing environment names `whiteboard` and `workflow`, existing room path pattern `/:kind/:roomId`, existing SDK `Operation` and `room.transaction` APIs, and current canvas helper names.
