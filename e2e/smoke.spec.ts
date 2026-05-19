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

test("navbar links are present on home page", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Padel Analyzer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sessions" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Analyze", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Compare", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pro Compare", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Annotate", exact: true })).toBeVisible();
});

test("upload route exposes core controls", async ({ page }) => {
  await page.goto("/upload");

  await expect(page.getByRole("button", { name: "Upload Video" })).toBeVisible();
  await expect(page.getByRole("button", { name: "YouTube Link" })).toBeVisible();
  await expect(page.getByText("Drop your video here or click to browse")).toBeVisible();

  await page.getByRole("button", { name: "YouTube Link" }).click();
  await expect(page.getByPlaceholder("https://www.youtube.com/watch?v=...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Look up" })).toBeVisible();
});

test("upload route handles invalid file types", async ({ page }) => {
  await page.goto("/upload");
  await page.setInputFiles('input[type="file"]', {
    name: "not-a-video.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("invalid"),
  });

  await expect(
    page.getByText("Please upload a video file (.mp4, .mov, .webm)")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("upload route accepts MOV when MIME is omitted (Safari-like)", async ({
  page,
}) => {
  await page.goto("/upload");
  await page.setInputFiles('input[type="file"]', {
    name: "recording.mov",
    mimeType: "",
    buffer: Buffer.from("stub"),
  });

  await expect(
    page.getByRole("button", { name: "Analyze My Swing" })
  ).toBeVisible();
});

test("core app routes render without crash", async ({ page }) => {
  await page.goto("/compare");
  await expect(page.getByRole("heading", { name: "Compare Swings" })).toBeVisible();

  await page.goto("/annotate");
  await expect(page.getByRole("heading", { name: "Annotate" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Export Training Data/ })).toBeVisible();

  await page.goto("/pro-compare");
  await expect(page.getByRole("heading", { name: "Pro Compare" })).toBeVisible();
});

test("invalid analysis id falls back safely", async ({ page }) => {
  await page.goto("/analysis/99999999");
  await expect(page.getByText("Analysis not found.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to sessions" })).toBeVisible();
});
