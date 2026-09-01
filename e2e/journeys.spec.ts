import { expect, test } from "@playwright/test";
import { startTelemetry, type TelemetrySession } from "./helpers/telemetry";

const telemetryByTestId = new Map<string, TelemetrySession>();

test.beforeEach(async ({ page }, testInfo) => {
  telemetryByTestId.set(testInfo.testId, startTelemetry(page));
});

test.afterEach(async ({}, testInfo) => {
  const telemetry = telemetryByTestId.get(testInfo.testId);
  if (!telemetry) return;
  await telemetry.flush(testInfo);
  telemetryByTestId.delete(testInfo.testId);
});

test("first-time upload journey explains primary actions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Analyze a swing/i }).click();

  await expect(page).toHaveURL(/\/app\/upload/);
  await expect(page.getByRole("dialog", { name: "How it works" })).toBeVisible();
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.getByText(/How to film/)).toBeVisible();
  await expect(page.getByText("Drop your video here or click to browse")).toBeVisible();

  await page.getByRole("button", { name: "YouTube Link" }).click();
  await expect(page.getByPlaceholder("https://www.youtube.com/watch?v=...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Look up" })).toBeDisabled();
});

test("invalid upload gives recoverable feedback", async ({ page }) => {
  await page.goto("/app/upload");
  await page.setInputFiles('input[type="file"]', {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a video"),
  });

  await expect(
    page.getByText(
      "That file does not look like a video (need a known extension such as .mp4, .mov, or .3gp, or a video/* type from your device)."
    )
  ).toBeVisible();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Drop your video here or click to browse")).toBeVisible();
});

test("mobile viewport keeps the main journey navigable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");

  await expect(page.getByRole("navigation", { name: "App navigation" })).toBeVisible();
  await page.locator('a[href="/app/upload"]').click();
  await expect(page).toHaveURL(/\/app\/upload/);
  await expect(page.getByRole("button", { name: "Upload Video" })).toBeVisible();

  await page.locator('a[href="/app/compare"]').click();
  await expect(page.getByRole("heading", { name: "Compare Swings" })).toBeVisible();
});

test("analysis not found state provides a path back", async ({ page }) => {
  await page.goto("/analysis/99999999");
  await expect(page).toHaveURL(/\/app\/analysis\/99999999/);
  await expect(page.getByText("Analysis not found")).toBeVisible();

  await page.getByRole("button", { name: "Back to sessions" }).click();
  await expect(page).toHaveURL(/\/app\/?$/);
});

test("secondary product surfaces expose clear empty or selection states", async ({ page }) => {
  await page.goto("/app/compare");
  await expect(page.getByText("Select two analyses above to compare them side by side.")).toBeVisible();

  await page.goto("/app/pro-compare");
  await expect(page.getByText("Select both swings to compare")).toBeVisible();
  await expect(page.getByText("Choose your swing on the left and a pro reference on the right.")).toBeVisible();

  await page.goto("/app/annotate");
  await expect(page.getByRole("button", { name: /Export Training Data/ })).toBeVisible();
});
