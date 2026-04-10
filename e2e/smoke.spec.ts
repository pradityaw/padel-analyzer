import { test, expect } from "@playwright/test";

test.describe("smoke tests", () => {
  test("homepage loads and shows history page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Padel/i);
    // The history page should be the default route
    await expect(page.locator("body")).toBeVisible();
  });

  test("upload page is accessible", async ({ page }) => {
    await page.goto("/upload");
    await expect(page.locator("body")).toBeVisible();
  });

  test("login page renders form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test("navigation bar is present", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("nav")).toBeVisible();
  });

  test("nonexistent analysis shows appropriate state", async ({ page }) => {
    await page.goto("/analysis/999999");
    await expect(page.locator("body")).toBeVisible();
  });
});
