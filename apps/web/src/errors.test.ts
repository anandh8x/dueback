import { describe, expect, it } from "vitest";
import { readableError } from "./errors";

describe("readableError", () => {
  it("reports a missing campaign only for CampaignNotFound", () => {
    expect(readableError(new Error("execution reverted: CampaignNotFound"))).toContain(
      "No DueBack campaign",
    );
    expect(readableError(new Error("execution reverted: UnauthorizedIssuer"))).toContain(
      "not authorized",
    );
  });

  it("does not mislabel an unknown revert as a missing campaign", () => {
    expect(readableError(new Error("execution reverted"))).toBe(
      "Arc rejected this transaction. Check the wallet permissions and campaign details.",
    );
  });

  it("preserves useful non-contract errors", () => {
    expect(readableError(new Error("Wallet request rejected"))).toBe("Wallet request rejected");
  });
});
