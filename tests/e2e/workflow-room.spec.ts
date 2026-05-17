import { expect, test, type Locator, type Page } from "@playwright/test";

test("workflow room supports node operations and drag linking", async ({ page }) => {
  await page.goto(`/workflow/e2e-workflow-room-${Date.now()}`);

  await expect(page.getByTestId("connection-status")).toContainText("Connected");

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByRole("button", { name: /add node/i }).click();
  await expect(page.getByTestId("workflow-node")).toHaveCount(2);

  await dragConnector(
    page,
    page.getByTestId("workflow-node").nth(0),
    page.getByTestId("workflow-node").nth(1)
  );
  await expect.poll(() => page.getByTestId("workflow-edge").count()).toBeGreaterThan(0);
});

async function dragConnector(
  page: Page,
  sourceLocator: Locator,
  targetLocator: Locator
) {
  const source = await sourceLocator.boundingBox();
  const target = await targetLocator.boundingBox();
  if (!source || !target) throw new Error("Cannot connect nodes without bounding boxes");
  await page.mouse.move(source.x + source.width + 6, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 8, target.y + target.height / 2, { steps: 6 });
  await page.mouse.up();
}
