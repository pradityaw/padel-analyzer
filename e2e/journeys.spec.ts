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
  await page.getByRole("link", { name: "Analyze", exact: true }).click();

  await expect(page).toHaveURL(/\/upload$/);
  await expect(page.getByText("Upload a video or paste a YouTube link")).toBeVisible();
  await expect(page.getByText("Drop your video here or click to browse")).toBeVisible();

  await page.getByRole("button", { name: "YouTube Link" }).click();
  await expect(page.getByPlaceholder("https://www.youtube.com/watch?v=...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Look up" })).toBeDisabled();
});

test("invalid upload gives recoverable feedback", async ({ page }) => {
  await page.goto("/upload");
  await page.setInputFiles('input[type="file"]', {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a video"),
  });

  await expect(
    page.getByText("Please upload a video file (.mp4, .mov, .webm)")
  ).toBeVisible();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Drop your video here or click to browse")).toBeVisible();
});

test("mobile viewport keeps the main journey navigable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("navigation")).toBeVisible();
  await page.locator('a[href="/upload"]').click();
  await expect(page).toHaveURL(/\/upload$/);
  await expect(page.getByRole("button", { name: "Upload Video" })).toBeVisible();

  await page.locator('a[href="/compare"]').click();
  await expect(page.getByRole("heading", { name: "Compare Swings" })).toBeVisible();
});

test("analysis not found state provides a path back", async ({ page }) => {
  await page.goto("/analysis/99999999");
  await expect(page.getByText("Analysis not found.")).toBeVisible();

  await page.getByRole("button", { name: "Back to sessions" }).click();
  await expect(page).toHaveURL(/\/sessions$/);
});

test("secondary product surfaces expose clear empty or selection states", async ({ page }) => {
  await page.goto("/compare");
  await expect(page.getByText("Select two analyses above to compare them side by side.")).toBeVisible();

  await page.goto("/pro-compare");
  await expect(page.getByText("Select both swings to compare")).toBeVisible();
  await expect(page.getByText("Choose your swing on the left and a pro reference on the right.")).toBeVisible();

  await page.goto("/annotate");
  await expect(page.getByRole("button", { name: /Export Training Data/ })).toBeVisible();
});
