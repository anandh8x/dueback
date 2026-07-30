import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAddress, isAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const challengeLifetimeSeconds = 15 * 60;
const attestationLifetimeSeconds = 30 * 24 * 60 * 60;
const domainPattern =
  /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

interface ChallengePayload {
  version: 1;
  domain: string;
  admin: Address;
  token: string;
  nonce: Hex;
  expiresAt: number;
}

export interface RuntimeConfig {
  challengeSecret: string;
  attestorPrivateKey: Hex;
  registryAddress: Address;
  chainId: number;
}

export function runtimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const challengeSecret = environment.DUEBACK_CHALLENGE_SECRET?.trim() ?? "";
  if (challengeSecret.length < 32) {
    throw new Error("DUEBACK_CHALLENGE_SECRET must contain at least 32 characters");
  }
  const privateKey = environment.DUEBACK_ATTESTOR_PRIVATE_KEY?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("DUEBACK_ATTESTOR_PRIVATE_KEY is not configured");
  }
  const registry = environment.DUEBACK_ORGANIZATION_REGISTRY_ADDRESS?.trim() ?? "";
  if (!isAddress(registry)) {
    throw new Error("DUEBACK_ORGANIZATION_REGISTRY_ADDRESS is not configured");
  }
  const chainId = Number(environment.DUEBACK_CHAIN_ID ?? "5042002");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("DUEBACK_CHAIN_ID is invalid");
  }
  return {
    challengeSecret,
    attestorPrivateKey: privateKey as Hex,
    registryAddress: getAddress(registry),
    chainId,
  };
}

export function normalizeDomain(value: unknown): string {
  if (typeof value !== "string") throw new Error("domain is required");
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (!domainPattern.test(domain)) throw new Error("domain is invalid");
  return domain;
}

export function normalizeAdmin(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error("admin must be a valid EVM address");
  }
  return getAddress(value);
}

export function createChallenge(
  domainInput: unknown,
  adminInput: unknown,
  config: RuntimeConfig,
  now = Math.floor(Date.now() / 1000),
): {
  id: string;
  domain: string;
  admin: Address;
  dnsName: string;
  dnsValue: string;
  expiresAt: string;
} {
  const domain = normalizeDomain(domainInput);
  const admin = normalizeAdmin(adminInput);
  const token = randomBytes(32).toString("hex");
  const payload: ChallengePayload = {
    version: 1,
    domain,
    admin,
    token,
    nonce: `0x${randomBytes(32).toString("hex")}`,
    expiresAt: now + challengeLifetimeSeconds,
  };
  return {
    id: sealChallenge(payload, config.challengeSecret),
    domain,
    admin,
    dnsName: `_dueback.${domain}`,
    dnsValue: `dueback-verification=${token}`,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
  };
}

export async function verifyChallenge(
  id: string,
  config: RuntimeConfig,
  lookup: typeof resolveTxt = resolveTxt,
  now = Math.floor(Date.now() / 1000),
) {
  const payload = openChallenge(id, config.challengeSecret);
  if (payload.expiresAt <= now) throw new VerificationError(409, "verification challenge expired");

  let records: string[][];
  try {
    records = await lookup(`_dueback.${payload.domain}`);
  } catch {
    throw new VerificationError(422, "required DNS TXT value was not found");
  }
  const expected = `dueback-verification=${payload.token}`;
  if (!records.some((parts) => parts.join("").trim() === expected)) {
    throw new VerificationError(422, "required DNS TXT value was not found");
  }

  const organizationId = keccak256(stringToHex(payload.domain));
  const validUntil = BigInt(now + attestationLifetimeSeconds);
  const account = privateKeyToAccount(config.attestorPrivateKey);
  const signature = await account.signTypedData({
    domain: {
      name: "DueBack Organization Registry",
      version: "1",
      chainId: config.chainId,
      verifyingContract: config.registryAddress,
    },
    types: {
      DomainAttestation: [
        { name: "organizationId", type: "bytes32" },
        { name: "admin", type: "address" },
        { name: "validUntil", type: "uint64" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "DomainAttestation",
    message: {
      organizationId,
      admin: payload.admin,
      validUntil,
      nonce: payload.nonce,
    },
  });

  return {
    organizationId,
    admin: payload.admin,
    validUntil: new Date(Number(validUntil) * 1000).toISOString(),
    nonce: payload.nonce,
    signature,
  };
}

export class VerificationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function readJSONBody(
  request: IncomingMessage & { body?: unknown },
): Record<string, unknown> {
  if (request.body && typeof request.body === "object" && !Array.isArray(request.body)) {
    return request.body as Record<string, unknown>;
  }
  throw new VerificationError(400, "request body must be a JSON object");
}

export function sendJSON(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

function sealChallenge(payload: ChallengePayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function openChallenge(id: string, secret: string): ChallengePayload {
  const [encoded, providedSignature, extra] = id.split(".");
  if (!encoded || !providedSignature || extra) {
    throw new VerificationError(400, "invalid verification challenge");
  }
  const expectedSignature = createHmac("sha256", secret).update(encoded).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(providedSignature, "base64url");
  } catch {
    throw new VerificationError(400, "invalid verification challenge");
  }
  if (
    provided.length !== expectedSignature.length ||
    !timingSafeEqual(provided, expectedSignature)
  ) {
    throw new VerificationError(400, "invalid verification challenge");
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString()) as ChallengePayload;
    if (
      payload.version !== 1 ||
      !/^0x[0-9a-fA-F]{64}$/.test(payload.nonce) ||
      !/^[0-9a-f]{64}$/.test(payload.token) ||
      !Number.isSafeInteger(payload.expiresAt)
    ) {
      throw new Error("invalid payload");
    }
    payload.domain = normalizeDomain(payload.domain);
    payload.admin = normalizeAdmin(payload.admin);
    return payload;
  } catch {
    throw new VerificationError(400, "invalid verification challenge");
  }
}
