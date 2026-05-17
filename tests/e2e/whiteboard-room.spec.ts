import { expect, test, type Locator, type Page } from "@playwright/test";

test("whiteboard room supports core object operations", async ({ page }) => {
  await page.goto(`/whiteboard/e2e-whiteboard-room-${Date.now()}`);

  await expect(page.getByTestId("connection-status")).toContainText("Connected");

  await page.getByRole("button", { name: /add sticky/i }).click();
  await expect(page.getByTestId("whiteboard-sticky")).toHaveCount(1);

  await page.getByRole("button", { name: /rectangle/i }).click();
  await expect(page.getByTestId("whiteboard-rectangle")).toHaveCount(1);

  // Move the seeded sticky out of the drawing region so the pencil starts on empty canvas.
  await dragBy(page.getByTestId("whiteboard-sticky").last(), page, 220, 40);

  await page.getByRole("button", { name: /pencil/i }).click();
  await drawOnCanvas(page);
  await expect.poll(() => page.getByTestId("freehand-stroke").count()).toBeGreaterThan(0);
});

async function dragBy(locator: Locator, page: Page, dx: number, dy: number) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Cannot drag element without a bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + 14 + dy, { steps: 6 });
  await page.mouse.up();
}

async function drawOnCanvas(page: Page) {
  const box = await page.getByTestId("studio-canvas").boundingBox();
  if (!box) throw new Error("Cannot draw without canvas");
  await page.mouse.move(box.x + 160, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 210, box.y + 210, { steps: 3 });
  await page.mouse.move(box.x + 270, box.y + 170, { steps: 3 });
  await page.mouse.move(box.x + 330, box.y + 230, { steps: 3 });
  await page.mouse.up();
}
