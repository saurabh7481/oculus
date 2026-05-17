import { expect, test } from "@playwright/test";

test("workflow edge supports labels", async ({ page }) => {
  await page.goto("/workflow/e2e-edge-label-room");

  // Add two nodes and connect them
  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByRole("button", { name: /link latest/i }).click();

  // Dispatch click event directly on the edge group (SVG lines have no fill area for Playwright visibility check)
  const edge = page.getByTestId("workflow-edge").first();
  await edge.dispatchEvent("click");

  // Inspector shows edge label input
  await expect(page.getByLabel("Edge label")).toBeVisible();

  // Fill label and press Enter
  await page.getByLabel("Edge label").fill("Approved");
  await page.keyboard.press("Enter");

  // Label appears on edge
  await expect(page.getByTestId("edge-label-text").first()).toHaveText("Approved");
});
