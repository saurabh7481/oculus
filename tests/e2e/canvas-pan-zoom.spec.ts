import { expect, test } from "@playwright/test";

test("canvas supports zoom with wheel and pan with space+drag", async ({ page }) => {
  await page.goto("/whiteboard/e2e-zoom-room");
  const canvas = page.getByTestId("studio-canvas");
  await canvas.waitFor();
  const viewport = canvas.locator(".canvas-viewport");
  // Zoom in with ctrl+wheel. Browsers normalize translate()+scale() to a matrix,
  // so assert against the matrix scale factor.
  await canvas.dispatchEvent("wheel", { deltaY: -120, ctrlKey: true });
  await expect(viewport).toHaveCSS("transform", /matrix\(1\.[1-9]/);
  // Reset zoom with Shift+0
  await page.keyboard.press("Shift+0");
  await expect(viewport).toHaveCSS("transform", /matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)|none/);

  // Space+drag pans the canvas (changes translation).
  await page.keyboard.down("Space");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 240, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect(viewport).toHaveCSS("transform", /matrix\(1,\s*0,\s*0,\s*1,\s*(?!0,\s*0\)).+/);
});
