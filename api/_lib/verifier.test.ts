import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { createChallenge, normalizeDomain, verifyChallenge, type RuntimeConfig } from "./verifier";

const privateKey = `0x${"11".repeat(32)}` as const;
const config: RuntimeConfig = {
  challengeSecret: "test-secret-that-is-at-least-32-characters",
  attestorPrivateKey: privateKey,
  registryAddress: "0x5028C830C3260fE5604B7F39eB118a1F3dBe34f5",
  chainId: 5_042_002,
};

describe("serverless domain verifier", () => {
  it("normalizes domains and creates a self-contained challenge", () => {
    const challenge = createChallenge(
      " Refunds.Example. ",
      "0x99066fBc97557490fA794F750630bb41733D1004",
      config,
      1_000,
    );
    expect(challenge.domain).toBe("refunds.example");
    expect(challenge.dnsName).toBe("_dueback.refunds.example");
    expect(challenge.id).toContain(".");
  });

  it("verifies DNS and signs the registry attestation", async () => {
    const challenge = createChallenge(
      "refunds.example",
      "0x99066fBc97557490fA794F750630bb41733D1004",
      config,
      1_000,
    );
    const attestation = await verifyChallenge(
      challenge.id,
      config,
      async () => [[challenge.dnsValue]],
      1_001,
    );
    expect(attestation.organizationId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(attestation.signature).toHaveLength(132);
    expect(privateKeyToAccount(privateKey).address).toBe(
      "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
    );
  });

  it("rejects invalid domains, tampering, and missing DNS proof", async () => {
    expect(() => normalizeDomain("localhost")).toThrow("invalid");
    const challenge = createChallenge(
      "refunds.example",
      "0x99066fBc97557490fA794F750630bb41733D1004",
      config,
      1_000,
    );
    await expect(
      verifyChallenge(`${challenge.id}x`, config, async () => [[challenge.dnsValue]], 1_001),
    ).rejects.toThrow("invalid verification challenge");
    await expect(
      verifyChallenge(challenge.id, config, async () => [["other"]], 1_001),
    ).rejects.toThrow("required DNS TXT");
  });
});
