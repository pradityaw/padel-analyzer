import { expect, test } from "@playwright/test";

test("upload page describes server-side analysis flow", async ({ page }) => {
  await page.goto("/upload");

  await expect(
    page.getByText(/Analysis runs on the server with MediaPipe/i)
  ).toBeVisible();
  await expect(page.getByText(/Server analysis/i)).toBeVisible();
  await expect(page.getByText(/scripts\/analyze_video\.py/i)).toBeHidden();
});

test("upload processing UI can be mocked via job polling", async ({ page }) => {
  let pollCount = 0;

  await page.route("**/api/trpc/mobileAnalysis.getProgress*", async (route) => {
    pollCount += 1;
    const status =
      pollCount >= 2
        ? {
            status: "completed",
            progress: 100,
            statusMessage: "Analysis complete.",
            analysisId: 42,
            errorMessage: null,
          }
        : {
            status: "processing",
            progress: 50,
            statusMessage: "Extracting pose landmarks...",
            analysisId: null,
            errorMessage: null,
          };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          result: {
            data: {
              json: {
                id: 1,
                videoFileName: "mock.mp4",
                videoStorageKey: "upload_mock.mp4",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                ...status,
              },
            },
          },
        },
      ]),
    });
  });

  await page.route("**/api/trpc/mobileAnalysis.create*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          result: {
            data: {
              json: {
                id: 1,
                videoFileName: "mock.mp4",
                videoStorageKey: "upload_mock.mp4",
                status: "queued",
                progress: 0,
                statusMessage: "Queued",
                errorMessage: null,
                analysisId: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            },
          },
        },
      ]),
    });
  });

  await page.route("**/api/upload", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ storageKey: "upload_mock.mp4" }),
    });
  });

  await page.goto("/upload");

  await page.setInputFiles('input[type="file"]', {
    name: "mock.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("fake"),
  });

  await page.getByRole("button", { name: "Analyze My Swing" }).click();

  await expect(
    page.getByText(/Analyzing your swing on the server/i)
  ).toBeVisible({ timeout: 10_000 });

  await expect(page).toHaveURL(/\/analysis\/42$/, { timeout: 15_000 });
});
