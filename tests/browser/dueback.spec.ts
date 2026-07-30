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

test("validates bearer claim packets before any wallet action", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Verify a campaign" }).first().click();
  await page.getByRole("button", { name: "Claim packet" }).click();

  await expect(page.getByText("This packet contains a bearer secret.")).toBeVisible();
  await page.getByLabel("Claim packet JSON").fill("{");
  await page.getByRole("button", { name: "Check packet on Arc" }).click();

  await expect(page.getByText("Claim packet is not valid JSON")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet and claim" })).not.toBeVisible();
});

test("builds allocation commitments locally", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create a funded payout" }).first().click();

  await expect(
    page.getByRole("heading", { name: "Prepare the private allocation." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Verify the domain before funding." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet and request DNS challenge" }).click();
  await expect(
    page.getByText("Install or open an EVM wallet to verify an organization."),
  ).toBeVisible();
  await expect(page.getByText("3 rows")).toBeVisible();
  await page.getByRole("button", { name: "Generate commitments" }).click();

  await expect(page.getByText("3 recipients")).toBeVisible();
  await expect(page.getByText("523.00 USDC", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect wallet and fund 523.00 USDC" }),
  ).toBeVisible();

  const publicDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download public commitments" }).click();
  expect((await publicDownload).suggestedFilename()).toBe("dueback-public-commitments.json");

  const privateDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export private claim packets" }).click();
  expect((await privateDownload).suggestedFilename()).toBe("dueback-private-claim-packets.json");

  await page.getByLabel("Organization domain").fill("changed.example");
  await expect(page.getByText("3 recipients")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect wallet and fund 523.00 USDC" }),
  ).not.toBeVisible();
});
