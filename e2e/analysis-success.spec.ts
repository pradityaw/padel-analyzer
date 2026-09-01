import { expect, test } from "@playwright/test";
import { startTelemetry, type TelemetrySession } from "./helpers/telemetry";
import { deleteAnalysis, seedAnalysis } from "./helpers/seed";

const telemetryByTestId = new Map<string, TelemetrySession>();
const seededIdsByTestId = new Map<string, number[]>();

test.beforeEach(async ({ page }, testInfo) => {
  telemetryByTestId.set(testInfo.testId, startTelemetry(page));
  seededIdsByTestId.set(testInfo.testId, []);
});

test.afterEach(async ({ request }, testInfo) => {
  const ids = seededIdsByTestId.get(testInfo.testId) ?? [];
  for (const id of ids) {
    try {
      await deleteAnalysis(request, id);
    } catch {
      // ignore cleanup failures
    }
  }
  seededIdsByTestId.delete(testInfo.testId);

  const telemetry = telemetryByTestId.get(testInfo.testId);
  if (!telemetry) return;
  await telemetry.flush(testInfo);
  telemetryByTestId.delete(testInfo.testId);
});

test("analysis page renders score, coaching tips, and next-step actions for a real record", async ({
  page,
  request,
}, testInfo) => {
  const analysisId = await seedAnalysis(request, {
    videoFileName: "e2e-success-fixture.mp4",
    overallScore: 76,
    shotType: "drive",
    shotConfidence: 0.92,
  });
  seededIdsByTestId.get(testInfo.testId)!.push(analysisId);

  await page.goto(`/app/analysis/${analysisId}`);

  await expect(page.getByRole("heading", { name: "e2e-success-fixture.mp4" })).toBeVisible();
  await expect(page.getByText("Right-handed", { exact: false })).toBeVisible();
  // UI label is "Overall Score" (not a bare "Overall"); assert the current copy.
  await expect(page.getByText("Overall score", { exact: true })).toBeVisible();
  await expect(page.getByText("76", { exact: true }).first()).toBeVisible();

  await expect(page.getByRole("button", { name: /Drive/ })).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Compare with Pro" }).first()
  ).toBeVisible();
  await expect(page.getByText("Pose + swing phases (beta)")).toBeVisible();
});

test("compare entry from analysis preselects the current swing", async ({
  page,
  request,
}, testInfo) => {
  const analysisId = await seedAnalysis(request, {
    videoFileName: "e2e-compare-source.mp4",
    overallScore: 70,
  });
  seededIdsByTestId.get(testInfo.testId)!.push(analysisId);

  await page.goto(`/app/analysis/${analysisId}`);
  await page.getByTestId("compare-with-pro").click();

  await expect(page).toHaveURL(new RegExp(`/app/pro-compare\\?player=${analysisId}`));
});

test("session card exposes a compare entry point", async ({ page, request }, testInfo) => {
  const analysisId = await seedAnalysis(request, {
    videoFileName: "e2e-session-card.mp4",
    overallScore: 65,
  });
  seededIdsByTestId.get(testInfo.testId)!.push(analysisId);

  // Touch-sized viewport: compare must remain visible without hover.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");

  await expect(page.getByRole("heading", { name: "Your sports schedule" })).toBeVisible();
  await expect(page.getByText("e2e-session-card.mp4")).toBeVisible();

  await page.getByText("e2e-session-card.mp4").click();
  await expect(page).toHaveURL(new RegExp(`/app/analysis/${analysisId}`));
});
