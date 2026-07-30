import { describe, expect, it } from "vitest";
import { campaignExplorerUrl, parseCampaignId, withArcReadRetry } from "./arc";

const campaignId = `0x${"ab".repeat(32)}` as const;

describe("Arc campaign reader", () => {
  it("accepts a campaign ID directly", () => {
    expect(parseCampaignId(campaignId)).toBe(campaignId);
  });

  it("extracts a campaign ID from a claim link", () => {
    expect(parseCampaignId(`https://dueback.example/claim/${campaignId}?packet=local`)).toBe(
      campaignId,
    );
  });

  it("rejects incomplete and malformed identifiers", () => {
    expect(() => parseCampaignId("0x1234")).toThrow("32-byte campaign ID");
    expect(() => parseCampaignId(`0x${"zz".repeat(32)}`)).toThrow("32-byte campaign ID");
  });

  it("builds an ArcScan contract link", () => {
    expect(campaignExplorerUrl("0x000000000000000000000000000000000000bEEF")).toBe(
      "https://testnet.arcscan.app/address/0x000000000000000000000000000000000000bEEF",
    );
  });

  it("retries temporary Arc RPC rate limits", async () => {
    let attempts = 0;
    const result = await withArcReadRetry(async () => {
      attempts++;
      if (attempts < 3) throw new Error("request limit reached");
      return "campaign";
    }, [0, 0]);

    expect(result).toBe("campaign");
    expect(attempts).toBe(3);
  });
});
