import { describe, expect, it } from "vitest";
import {
  campaignIdFor,
  campaignReferenceFor,
  canonicalJson,
  claimLeaf,
  createDeterministicRandomSource,
  formatArcAmount,
  generateDistribution,
  hashJson,
  normalizeAllocations,
  organizationIdFor,
  parseAllocationCsv,
  parseArcAmount,
  parseClaimPacketJson,
  validateClaimPacket,
  verifyClaimPacket,
  type ClaimPacket,
} from "../src/index.js";

describe("Arc amounts", () => {
  it("parses and formats native USDC at 18 decimals", () => {
    expect(parseArcAmount("12.345")).toBe(12_345_000_000_000_000_000n);
    expect(formatArcAmount(12_345_000_000_000_000_000n)).toBe("12.345");
  });

  it.each(["", "0", "-1", "01", "1e2", "1.0000000000000000001"])(
    "rejects invalid amount %s",
    (amount) => {
      expect(() => parseArcAmount(amount)).toThrow();
    },
  );
});

describe("allocation CSV", () => {
  it("parses quoted contacts and normalizes allocations", () => {
    const parsed = parseAllocationCsv(
      'reference,amount,contact\r\nREF-1,4.25,"person@example.com"\r\n"REF,2",5,user@example.com',
    );
    expect(parsed).toEqual([
      { reference: "REF-1", amount: "4.25", contact: "person@example.com" },
      { reference: "REF,2", amount: "5", contact: "user@example.com" },
    ]);
    expect(normalizeAllocations(parsed)[0]?.amount).toBe(4_250_000_000_000_000_000n);
  });

  it("rejects duplicate references", () => {
    expect(() =>
      normalizeAllocations([
        { reference: "same", amount: "1" },
        { reference: "same", amount: "2" },
      ]),
    ).toThrow("Duplicate reference");
  });

  it("rejects malformed input", () => {
    expect(() => parseAllocationCsv("name,value\nA,1")).toThrow("reference and amount");
    expect(() => parseAllocationCsv('reference,amount\n"broken,1')).toThrow("Unterminated");
  });
});

describe("campaign identifiers and claim trees", () => {
  const organizationId = organizationIdFor("refunds.example");
  const campaignReference = campaignReferenceFor("refund-2026-001");
  const campaignId = campaignIdFor(organizationId, campaignReference);

  it("generates deterministic IDs", () => {
    expect(organizationId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(campaignReference).toMatch(/^0x[0-9a-f]{64}$/);
    expect(campaignId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(organizationIdFor(" REFUNDS.EXAMPLE ")).toBe(organizationId);
  });

  it("builds and verifies every proof including an odd final leaf", () => {
    const distribution = generateDistribution(
      campaignId,
      [
        { reference: "A", amount: "1.5", contact: "a@example.com" },
        { reference: "B", amount: "2" },
        { reference: "C", amount: "3.25" },
      ],
      createDeterministicRandomSource(10n),
    );

    expect(distribution.recipientCount).toBe(3);
    expect(distribution.totalAmount).toBe(6_750_000_000_000_000_000n);
    for (const claim of distribution.claims) {
      expect(verifyClaimPacket(claim.packet, distribution.merkleRoot)).toBe(true);
    }
  });

  it("uses fresh cryptographic randomness by default", () => {
    const allocation = [{ reference: "A", amount: "1" }];
    const first = generateDistribution(campaignId, allocation);
    const second = generateDistribution(campaignId, allocation);

    expect(first.claims[0]?.packet.claimId).not.toBe(second.claims[0]?.packet.claimId);
    expect(first.claims[0]?.packet.secret).not.toBe(second.claims[0]?.packet.secret);
    expect(first.merkleRoot).not.toBe(second.merkleRoot);
  });

  it("rejects a changed amount, secret, proof, or campaign", () => {
    const distribution = generateDistribution(
      campaignId,
      [
        { reference: "A", amount: "1" },
        { reference: "B", amount: "2" },
      ],
      createDeterministicRandomSource(),
    );
    const original = distribution.claims[0]?.packet;
    if (!original) throw new Error("missing test claim");

    const changedAmount = { ...original, amount: (BigInt(original.amount) + 1n).toString() };
    expect(verifyClaimPacket(changedAmount, distribution.merkleRoot)).toBe(false);

    const changedSecret = {
      ...original,
      secret: `0x${"ff".repeat(32)}` as const,
    };
    expect(verifyClaimPacket(changedSecret, distribution.merkleRoot)).toBe(false);

    const changedProof = {
      ...original,
      proof: [`0x${"aa".repeat(32)}` as const],
    };
    expect(verifyClaimPacket(changedProof, distribution.merkleRoot)).toBe(false);

    const changedCampaign = {
      ...original,
      campaignId: `0x${"bb".repeat(32)}` as const,
    };
    expect(verifyClaimPacket(changedCampaign, distribution.merkleRoot)).toBe(false);
  });

  it("matches direct leaf construction", () => {
    const distribution = generateDistribution(
      campaignId,
      [{ reference: "A", amount: "1" }],
      createDeterministicRandomSource(99n),
    );
    const claim = distribution.claims[0];
    if (!claim) throw new Error("missing test claim");
    expect(
      claimLeaf(
        campaignId,
        claim.packet.index,
        claim.packet.claimId,
        BigInt(claim.packet.amount),
        claim.packet.secret,
      ),
    ).toBe(claim.leaf);
  });
});

describe("packet and manifest primitives", () => {
  it("parses a generated claim packet from JSON", () => {
    const campaignId = campaignIdFor(
      organizationIdFor("refunds.example"),
      campaignReferenceFor("packet-json"),
    );
    const distribution = generateDistribution(
      campaignId,
      [{ reference: "A", amount: "4.25" }],
      createDeterministicRandomSource(30n),
    );
    const packet = distribution.claims[0]?.packet;
    if (!packet) throw new Error("missing test packet");

    expect(parseClaimPacketJson(JSON.stringify(packet))).toEqual(packet);
  });

  it("rejects malformed, oversized, and structurally invalid packet JSON", () => {
    expect(() => parseClaimPacketJson("{")).toThrow("not valid JSON");
    expect(() => parseClaimPacketJson("[]")).toThrow("JSON object");
    expect(() => parseClaimPacketJson(JSON.stringify({ schemaVersion: 1 }))).toThrow(
      "invalid or missing fields",
    );
    expect(() => parseClaimPacketJson("x".repeat(100_001))).toThrow("100,000");
  });

  it("rejects malformed packet fields", () => {
    const malformed = {
      schemaVersion: 1,
      campaignId: "0x01",
      index: -1,
      claimId: "0x02",
      amount: "0",
      secret: "0x03",
      proof: [],
    } as unknown as ClaimPacket;
    expect(() => validateClaimPacket(malformed)).toThrow();
  });

  it("canonicalizes and hashes independent of object key order", () => {
    expect(canonicalJson({ b: 2, a: [true, "x"] })).toBe('{"a":[true,"x"],"b":2}');
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }));
  });
});
