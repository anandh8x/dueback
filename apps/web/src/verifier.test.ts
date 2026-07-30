import { describe, expect, it, vi } from "vitest";
import { createDomainChallenge, verifyDomainChallenge } from "./verifier";

const admin = "0x99066fBc97557490fA794F750630bb41733D1004";

describe("domain verifier client", () => {
  it("creates and validates a DNS challenge response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          id: "challenge-1",
          domain: "refunds.example",
          admin,
          dnsName: "_dueback.refunds.example",
          dnsValue: "dueback-verification=abc",
          expiresAt: "2026-07-30T12:15:00Z",
        },
        { status: 201 },
      ),
    );

    const challenge = await createDomainChallenge("refunds.example", admin, fetcher);
    expect(challenge.dnsName).toBe("_dueback.refunds.example");
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/v1/challenges",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("validates a signed domain attestation response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        organizationId: `0x${"11".repeat(32)}`,
        admin,
        validUntil: "2026-08-29T12:00:00Z",
        nonce: `0x${"22".repeat(32)}`,
        signature: `0x${"33".repeat(65)}`,
      }),
    );

    const attestation = await verifyDomainChallenge("challenge-1", fetcher);
    expect(attestation.admin).toBe(admin);
    expect(attestation.signature).toHaveLength(132);
  });

  it("surfaces verifier errors without accepting malformed responses", async () => {
    const rejected = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: "required DNS TXT value was not found" }, { status: 422 }),
      );
    await expect(verifyDomainChallenge("challenge-1", rejected)).rejects.toThrow(
      "required DNS TXT value",
    );

    const malformed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ admin }));
    await expect(verifyDomainChallenge("challenge-1", malformed)).rejects.toThrow(
      "invalid domain attestation",
    );
  });
});
