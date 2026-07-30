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

test("keeps illustrative campaign data explicitly labeled", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Verify a campaign" }).first().click();

  await expect(page.getByRole("heading", { name: "Verify before you claim." })).toBeVisible();
  await page.getByRole("button", { name: "Try the clearly labeled demo campaign" }).click();

  await expect(page.getByText("Demo campaign loaded.")).toBeVisible();
  await expect(
    page.getByText("Illustrative data only. No blockchain record was queried."),
  ).toBeVisible();
  await expect(page.getByText("$125,000.00")).toBeVisible();
});

test("does not verify malformed campaign input", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Verify a campaign" }).first().click();
  await page.getByLabel("Campaign ID or claim link").fill("0x9f3a");
  await page.getByRole("button", { name: "Verify", exact: true }).click();

  await expect(
    page.getByText("Enter a 32-byte campaign ID or a claim link containing one."),
  ).toBeVisible();
  await expect(page.getByText("Live campaign state loaded from Arc.")).not.toBeVisible();
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
