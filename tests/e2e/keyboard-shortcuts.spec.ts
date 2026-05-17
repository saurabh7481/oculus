import { expect, test } from "@playwright/test";

test("keyboard shortcuts work for selection, duplication, and deletion", async ({ page }) => {
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

  // Escape deselects (no selection ring)
  await page.getByTestId("whiteboard-sticky").first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("whiteboard-sticky").first()).not.toHaveClass(/selected/);
});
