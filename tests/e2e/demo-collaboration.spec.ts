import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

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

test("showcases branded multi-environment collaboration with replay diffs", async ({ browser }) => {
  const adaContext = await identityContext(browser, {
    name: "Ada",
    color: "#2563eb",
    userId: "ada-e2e"
  });
  const graceContext = await identityContext(browser, {
    name: "Grace",
    color: "#0f766e",
    userId: "grace-e2e"
  });

  const ada = await adaContext.newPage();
  const grace = await graceContext.newPage();

  await Promise.all([ada.goto("/whiteboard/e2e-collab-room"), grace.goto("/whiteboard/e2e-collab-room")]);
  await expect(ada.getByRole("heading", { name: "Oculus Studio" })).toBeVisible();
  await expect(ada.getByRole("button", { name: /whiteboard/i })).toBeVisible();
  await expect(ada.getByRole("button", { name: /workflow builder/i })).toBeVisible();

  await expect(ada.getByTestId("connection-status")).toContainText("Connected");
  await expect(grace.getByTestId("connection-status")).toContainText("Connected");

  await ada.getByRole("button", { name: /workflow builder/i }).click();
  await grace.getByRole("button", { name: /workflow builder/i }).click();
  const initialNodeCount = await grace.getByTestId("node-label").count();
  await ada.getByRole("button", { name: /add node/i }).click();
  await ada.getByRole("button", { name: /add node/i }).click();
  await expect(grace.getByTestId("node-label")).toHaveCount(initialNodeCount + 2);
  await expect(grace.getByTestId("node-label").nth(initialNodeCount)).toHaveValue("New step");

  const editedLabel = `Start edited ${Date.now()}`;
  await ada.getByTestId("node-label").nth(0).fill(editedLabel);
  await expect(grace.getByTestId("node-label").nth(0)).toHaveValue(editedLabel);

  const firstNewNode = initialNodeCount;
  const secondNewNode = initialNodeCount + 1;
  await dragBy(ada.getByTestId("workflow-node").nth(firstNewNode), ada, 90, 40);
  await expect(grace.getByTestId("workflow-node").nth(firstNewNode)).toHaveAttribute("data-x", /\d+/);

  await dragConnector(
    ada,
    ada.getByTestId("workflow-node").nth(firstNewNode),
    ada.getByTestId("workflow-node").nth(secondNewNode)
  );
  await expect.poll(() => grace.getByTestId("workflow-edge").count()).toBeGreaterThan(0);

  await ada.getByTestId("workflow-node").nth(firstNewNode).click();
  const beforeDeleteNodeCount = await grace.getByTestId("workflow-node").count();
  await ada.getByRole("button", { name: /delete selected/i }).click();
  await expect(grace.getByTestId("workflow-node")).toHaveCount(beforeDeleteNodeCount - 1);

  await ada.mouse.move(260, 260);
  await expect(grace.getByTestId("collaborator-cursor").filter({ hasText: "Ada" })).toBeVisible();

  await ada.getByRole("button", { name: /whiteboard/i }).click();
  await grace.getByRole("button", { name: /whiteboard/i }).click();
  const initialStickyCount = await grace.getByTestId("whiteboard-sticky").count();
  await ada.getByRole("button", { name: /add sticky/i }).click();
  await expect(grace.getByTestId("whiteboard-sticky")).toHaveCount(initialStickyCount + 1);
  await dragBy(ada.getByTestId("whiteboard-sticky").last(), ada, 80, 50);
  await expect(grace.getByTestId("whiteboard-sticky").last()).toHaveAttribute("data-x", /\d+/);

  await ada.getByRole("button", { name: /pencil/i }).click();
  await drawOnCanvas(ada);
  await expect.poll(() => grace.getByTestId("freehand-stroke").count()).toBeGreaterThan(0);

  await ada.getByRole("button", { name: /rectangle/i }).click();
  await expect.poll(() => grace.getByTestId("whiteboard-rectangle").count()).toBeGreaterThan(0);
  const rectangle = ada.getByTestId("whiteboard-rectangle").last();
  const rectangleBefore = await mustHaveBox(rectangle);
  await dragHandleBy(ada.getByLabel("Resize se").last(), ada, 70, 45);
  const rectangleAfter = await mustHaveBox(rectangle);
  expect(rectangleAfter.width).toBeGreaterThan(rectangleBefore.width);
  expect(rectangleAfter.height).toBeGreaterThan(rectangleBefore.height);

  await ada.getByRole("button", { name: /ellipse/i }).click();
  await expect.poll(() => grace.getByTestId("whiteboard-ellipse").count()).toBeGreaterThan(0);
  await ada.getByRole("button", { name: /chart/i }).click();
  await expect.poll(() => grace.getByTestId("whiteboard-chart").count()).toBeGreaterThan(0);

  const beforeUndoChartCount = await grace.getByTestId("whiteboard-chart").count();
  await ada.getByRole("button", { name: /^undo$/i }).click();
  await expect.poll(() => grace.getByTestId("whiteboard-chart").count()).toBe(beforeUndoChartCount - 1);

  await ada.getByRole("button", { name: /dark mode/i }).click();
  await expect(ada.getByTestId("studio-shell")).toHaveClass(/dark/);

  await ada.getByRole("button", { name: /collapse navigation/i }).click();
  await expect(ada.getByTestId("nav-panel")).toHaveClass(/collapsed/);
  await ada.getByRole("button", { name: /collapse inspector/i }).click();
  await expect(ada.getByTestId("inspector-panel")).toHaveClass(/collapsed/);

  await expect(grace.getByTestId("event-row").first()).toBeVisible();
  await grace.getByTestId("event-row").first().click();

  await expect(grace.getByText(/Viewing replay at v\d+/)).toBeVisible();
  await expect(grace.getByTestId("replay-diff")).toBeVisible();
  await expect(grace.getByTestId("replay-diff")).toContainText(/nodes|shapes/);
  await expect(grace.getByTestId("history-log")).toHaveCSS("overflow-y", "auto");

  await Promise.all([adaContext.close(), graceContext.close()]);
});

async function dragBy(locator: Locator, page: Page, dx: number, dy: number) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Cannot drag element without a bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + 14 + dy, { steps: 6 });
  await page.mouse.up();
}

async function dragHandleBy(locator: Locator, page: Page, dx: number, dy: number) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Cannot drag handle without a bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
  await page.mouse.up();
}

async function mustHaveBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected element to have a bounding box");
  return box;
}

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

async function identityContext(
  browser: Browser,
  identity: { name: string; color: string; userId: string }
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript((nextIdentity) => {
    sessionStorage.setItem("oculus_demo_name", nextIdentity.name);
    sessionStorage.setItem("oculus_demo_color", nextIdentity.color);
    sessionStorage.setItem("oculus_demo_user_id", nextIdentity.userId);
  }, identity);
  return context;
}
