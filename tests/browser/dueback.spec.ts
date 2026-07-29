import { expect, test } from "@playwright/test";

test("explains the funded payout model without horizontal overflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Refunds with proof built in." })).toBeVisible();
  await expect(page.getByText("Fully funded · claims open")).toBeVisible();
  await expect(page.getByText("What it does not prove")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});

test("verifies a public campaign record", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Verify a campaign" }).first().click();

  await expect(page.getByRole("heading", { name: "Verify before you claim." })).toBeVisible();
  await page.getByLabel("Campaign ID or claim link").fill("0x9f3a");
  await page.getByRole("button", { name: "Verify", exact: true }).click();

  await expect(page.getByText("Your campaign record checks out.")).toBeVisible();
  await expect(page.getByText("$125,000.00")).toBeVisible();
});

test("builds allocation commitments locally", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create a funded payout" }).first().click();

  await expect(
    page.getByRole("heading", { name: "Prepare the private allocation." }),
  ).toBeVisible();
  await expect(page.getByText("3 rows")).toBeVisible();
  await page.getByRole("button", { name: "Generate commitments" }).click();

  await expect(page.getByText("3 recipients")).toBeVisible();
  await expect(page.getByText("523.00 USDC")).toBeVisible();
});
