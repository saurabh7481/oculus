import { expect, test } from "@playwright/test";

test("selected sticky color changes via color picker", async ({ page }) => {
  await page.goto("/whiteboard/e2e-color-room");
  await page.getByRole("button", { name: /add sticky/i }).click();
  await page.getByTestId("whiteboard-sticky").click();
  // Inspector color picker appears when shape is selected
  await expect(page.getByLabel("Rose")).toBeVisible();
  // Click a swatch
  await page.getByLabel("Rose").click();
  // Sticky background changes
  await expect(page.getByTestId("whiteboard-sticky")).toHaveCSS("background-color", "rgb(255, 228, 230)");
});
