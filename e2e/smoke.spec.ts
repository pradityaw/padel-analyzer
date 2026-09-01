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

test("marketing home exposes login and analyze CTA", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Padel Analyzer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Analyze a swing/i })).toBeVisible();
});

test("legacy /sessions redirects into the app shell", async ({ page }) => {
  await page.goto("/sessions");
  await expect(page).toHaveURL(/\/app\/?$/);
  await expect(page.getByRole("navigation", { name: "App navigation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sessions" })).toHaveAttribute("href", "/app");
});

test("upload route exposes core controls", async ({ page }) => {
  await page.goto("/app/upload");

  await expect(page.getByRole("button", { name: "Upload Video" })).toBeVisible();
  await expect(page.getByRole("button", { name: "YouTube Link" })).toBeVisible();
  await expect(page.getByText("Drop your video here or click to browse")).toBeVisible();
  await expect(page.getByTestId("upload-dropzone")).toBeVisible();

  await page.getByRole("button", { name: "YouTube Link" }).click();
  await expect(page.getByPlaceholder("https://www.youtube.com/watch?v=...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Look up" })).toBeVisible();
});

test("legacy /upload redirects to /app/upload", async ({ page }) => {
  await page.goto("/upload");
  await expect(page).toHaveURL(/\/app\/upload/);
  await expect(page.getByText("Drop your video here or click to browse")).toBeVisible();
});

test("upload route handles invalid file types", async ({ page }) => {
  await page.goto("/app/upload");
  await page.setInputFiles('input[type="file"]', {
    name: "not-a-video.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("invalid"),
  });

  await expect(
    page.getByText(
      "That file does not look like a video (need a known extension such as .mp4, .mov, or .3gp, or a video/* type from your device)."
    )
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("upload route accepts MOV when MIME is omitted (Safari-like)", async ({
  page,
}) => {
  await page.goto("/app/upload");
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
  await page.goto("/app/compare");
  await expect(page.getByRole("heading", { name: "Compare Swings" })).toBeVisible();

  await page.goto("/how-to-film");
  await expect(page.getByRole("heading", { name: "How to film" })).toBeVisible();
});
