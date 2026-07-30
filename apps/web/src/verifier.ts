import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import type { OrganizationAttestation } from "./arc";

export interface DomainChallenge {
  id: string;
  domain: string;
  admin: Address;
  dnsName: string;
  dnsValue: string;
  expiresAt: string;
}

type Fetcher = typeof fetch;

export async function createDomainChallenge(
  domain: string,
  admin: Address,
  fetcher: Fetcher = fetch,
): Promise<DomainChallenge> {
  const payload = await request(
    "/v1/challenges",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, admin }),
    },
    fetcher,
  );
  return parseChallenge(payload);
}

export async function verifyDomainChallenge(
  challengeId: string,
  fetcher: Fetcher = fetch,
): Promise<OrganizationAttestation> {
  const payload = await request(
    `/v1/challenges/${encodeURIComponent(challengeId)}/verify`,
    { method: "POST" },
    fetcher,
  );
  if (
    !isRecord(payload) ||
    typeof payload.admin !== "string" ||
    !isAddress(payload.admin) ||
    typeof payload.validUntil !== "string" ||
    !isBytes32(payload.nonce) ||
    !isHex(payload.signature, { strict: true })
  ) {
    throw new Error("Verifier returned an invalid domain attestation.");
  }
  return {
    admin: getAddress(payload.admin),
    validUntil: payload.validUntil,
    nonce: payload.nonce,
    signature: payload.signature,
  };
}

async function request(path: string, init: RequestInit, fetcher: Fetcher): Promise<unknown> {
  const baseURL = (import.meta.env.VITE_VERIFIER_API_URL || "/api").replace(/\/$/, "");
  const response = await fetcher(`${baseURL}${path}`, init);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `Domain verifier returned HTTP ${String(response.status)}.`;
    throw new Error(message);
  }
  return payload;
}

function parseChallenge(payload: unknown): DomainChallenge {
  if (
    !isRecord(payload) ||
    typeof payload.id !== "string" ||
    typeof payload.domain !== "string" ||
    typeof payload.admin !== "string" ||
    !isAddress(payload.admin) ||
    typeof payload.dnsName !== "string" ||
    typeof payload.dnsValue !== "string" ||
    typeof payload.expiresAt !== "string"
  ) {
    throw new Error("Verifier returned an invalid DNS challenge.");
  }
  return {
    id: payload.id,
    domain: payload.domain,
    admin: getAddress(payload.admin),
    dnsName: payload.dnsName,
    dnsValue: payload.dnsValue,
    expiresAt: payload.expiresAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBytes32(value: unknown): value is Hex {
  return typeof value === "string" && value.length === 66 && isHex(value, { strict: true });
}
