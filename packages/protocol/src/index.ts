import {
  concatHex,
  encodeAbiParameters,
  formatUnits,
  getAddress,
  isAddress,
  keccak256,
  parseUnits,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";

export const ARC_NATIVE_USDC_DECIMALS = 18;
export const CLAIM_PACKET_SCHEMA_VERSION = 1;

export interface AllocationInput {
  reference: string;
  amount: string;
  contact?: string;
}

export interface NormalizedAllocation {
  reference: string;
  amount: bigint;
  contact?: string;
}

export interface ClaimPacket {
  schemaVersion: 1;
  campaignId: Hex;
  index: number;
  claimId: Hex;
  amount: string;
  secret: Hex;
  proof: Hex[];
}

export interface PrivateClaimRecord {
  reference: string;
  contact?: string;
  packet: ClaimPacket;
  leaf: Hex;
}

export interface GeneratedDistribution {
  campaignId: Hex;
  merkleRoot: Hex;
  totalAmount: bigint;
  recipientCount: number;
  claims: PrivateClaimRecord[];
}

export interface CampaignManifest {
  schemaVersion: 1;
  network: "Arc Testnet";
  chainId: 5042002;
  campaignId: Hex;
  organizationId: Hex;
  campaignReference: Hex;
  merkleRoot: Hex;
  totalAmount: string;
  recipientCount: number;
  opensAt: number;
  closesAt: number;
  reclaimAddress: Address;
  policyHash: Hex;
  metadataHash: Hex;
  noticeHash: Hex;
}

export interface RandomSource {
  bytes32(): Hex;
}

interface TreeNode {
  hash: Hex;
  leaves: number[];
}

const amountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

export function parseArcAmount(value: string): bigint {
  const normalized = value.trim();
  if (!amountPattern.test(normalized)) {
    throw new Error(`Invalid Arc USDC amount: ${value}`);
  }
  const amount = parseUnits(normalized, ARC_NATIVE_USDC_DECIMALS);
  if (amount <= 0n) {
    throw new Error("Amount must be greater than zero");
  }
  return amount;
}

export function formatArcAmount(value: bigint): string {
  return formatUnits(value, ARC_NATIVE_USDC_DECIMALS);
}

export function parseAllocationCsv(csv: string): AllocationInput[] {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) {
    throw new Error("CSV must contain a header and at least one allocation");
  }

  const header = rows[0]?.map((cell) => cell.trim().toLowerCase());
  const referenceIndex = header?.indexOf("reference") ?? -1;
  const amountIndex = header?.indexOf("amount") ?? -1;
  const contactIndex = header?.indexOf("contact") ?? -1;
  if (referenceIndex < 0 || amountIndex < 0) {
    throw new Error("CSV header must include reference and amount");
  }

  return rows.slice(1).map((row, offset) => {
    const line = offset + 2;
    const reference = row[referenceIndex]?.trim() ?? "";
    const amount = row[amountIndex]?.trim() ?? "";
    const contact = contactIndex >= 0 ? row[contactIndex]?.trim() : undefined;
    if (reference.length === 0) throw new Error(`Missing reference on line ${line}`);
    if (amount.length === 0) throw new Error(`Missing amount on line ${line}`);
    return contact ? { reference, amount, contact } : { reference, amount };
  });
}

export function normalizeAllocations(inputs: readonly AllocationInput[]): NormalizedAllocation[] {
  if (inputs.length === 0) throw new Error("At least one allocation is required");
  if (inputs.length > 100_000) throw new Error("Allocation exceeds the 100,000 recipient limit");

  const references = new Set<string>();
  return inputs.map((input, index) => {
    const reference = input.reference.trim();
    if (reference.length === 0 || reference.length > 160) {
      throw new Error(`Invalid reference at row ${index + 1}`);
    }
    if (references.has(reference)) {
      throw new Error(`Duplicate reference: ${reference}`);
    }
    references.add(reference);
    const contact = input.contact?.trim();
    return contact
      ? { reference, amount: parseArcAmount(input.amount), contact }
      : { reference, amount: parseArcAmount(input.amount) };
  });
}

export function organizationIdFor(domain: string): Hex {
  const normalized = domain.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 253) {
    throw new Error("Invalid organization domain");
  }
  return keccak256(stringToHex(normalized));
}

export function campaignIdFor(organizationId: Hex, campaignReference: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [organizationId, campaignReference],
    ),
  );
}

export function campaignReferenceFor(reference: string): Hex {
  const normalized = reference.trim();
  if (normalized.length === 0 || normalized.length > 160) {
    throw new Error("Invalid campaign reference");
  }
  return keccak256(stringToHex(normalized));
}

export function claimLeaf(
  campaignId: Hex,
  index: number,
  claimId: Hex,
  amount: bigint,
  secret: Hex,
): Hex {
  assertBytes32(campaignId, "campaignId");
  assertBytes32(claimId, "claimId");
  assertBytes32(secret, "secret");
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("Invalid claim index");
  if (amount <= 0n) throw new Error("Invalid claim amount");

  const secretHash = keccak256(secret);
  const inner = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [campaignId, BigInt(index), claimId, amount, secretHash],
    ),
  );
  return keccak256(concatHex([inner]));
}

export function generateDistribution(
  campaignId: Hex,
  inputs: readonly AllocationInput[],
  random: RandomSource = browserRandomSource,
): GeneratedDistribution {
  assertBytes32(campaignId, "campaignId");
  const allocations = normalizeAllocations(inputs);
  const materials = allocations.map((allocation, index) => {
    const claimId = random.bytes32();
    const secret = random.bytes32();
    return {
      allocation,
      index,
      claimId,
      secret,
      leaf: claimLeaf(campaignId, index, claimId, allocation.amount, secret),
    };
  });

  const tree = buildMerkleTree(materials.map((material) => material.leaf));
  const claims = materials.map((material) => {
    const packet: ClaimPacket = {
      schemaVersion: CLAIM_PACKET_SCHEMA_VERSION,
      campaignId,
      index: material.index,
      claimId: material.claimId,
      amount: material.allocation.amount.toString(),
      secret: material.secret,
      proof: tree.proofs[material.index] ?? [],
    };
    const base = {
      reference: material.allocation.reference,
      packet,
      leaf: material.leaf,
    };
    return material.allocation.contact ? { ...base, contact: material.allocation.contact } : base;
  });

  return {
    campaignId,
    merkleRoot: tree.root,
    totalAmount: allocations.reduce((total, allocation) => total + allocation.amount, 0n),
    recipientCount: claims.length,
    claims,
  };
}

export function verifyClaimPacket(packet: ClaimPacket, merkleRoot: Hex): boolean {
  try {
    validateClaimPacket(packet);
    assertBytes32(merkleRoot, "merkleRoot");
    let computed = claimLeaf(
      packet.campaignId,
      packet.index,
      packet.claimId,
      BigInt(packet.amount),
      packet.secret,
    );
    for (const sibling of packet.proof) computed = hashPair(computed, sibling);
    return computed === merkleRoot;
  } catch {
    return false;
  }
}

export function validateClaimPacket(packet: ClaimPacket): void {
  if (packet.schemaVersion !== CLAIM_PACKET_SCHEMA_VERSION) {
    throw new Error("Unsupported claim packet version");
  }
  assertBytes32(packet.campaignId, "campaignId");
  assertBytes32(packet.claimId, "claimId");
  assertBytes32(packet.secret, "secret");
  if (!Number.isSafeInteger(packet.index) || packet.index < 0) {
    throw new Error("Invalid claim packet index");
  }
  if (!/^[1-9]\d*$/.test(packet.amount) || BigInt(packet.amount) <= 0n) {
    throw new Error("Invalid claim packet amount");
  }
  for (const sibling of packet.proof) assertBytes32(sibling, "proof sibling");
}

export function normalizeAddress(value: string): Address {
  if (!isAddress(value)) throw new Error("Invalid address");
  return getAddress(value);
}

export function hashJson(value: unknown): Hex {
  return keccak256(stringToHex(canonicalJson(value)));
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("Unsupported JSON value");
}

export function createDeterministicRandomSource(seed: bigint = 1n): RandomSource {
  let cursor = seed;
  return {
    bytes32() {
      const value = keccak256(toHex(cursor, { size: 32 }));
      cursor += 1n;
      return value;
    },
  };
}

const browserRandomSource: RandomSource = {
  bytes32() {
    const value = new Uint8Array(32);
    globalThis.crypto.getRandomValues(value);
    return toHex(value);
  },
};

function buildMerkleTree(leaves: readonly Hex[]): { root: Hex; proofs: Hex[][] } {
  if (leaves.length === 0) throw new Error("Cannot build an empty Merkle tree");
  leaves.forEach((leaf) => assertBytes32(leaf, "leaf"));

  const proofs: Hex[][] = Array.from({ length: leaves.length }, () => []);
  let level: TreeNode[] = leaves.map((hash, index) => ({ hash, leaves: [index] }));

  while (level.length > 1) {
    const next: TreeNode[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      if (!left || !right) throw new Error("Invalid Merkle tree state");

      for (const leafIndex of left.leaves) proofs[leafIndex]?.push(right.hash);
      if (right !== left) {
        for (const leafIndex of right.leaves) proofs[leafIndex]?.push(left.hash);
      }
      next.push({
        hash: hashPair(left.hash, right.hash),
        leaves: right === left ? [...left.leaves] : [...left.leaves, ...right.leaves],
      });
    }
    level = next;
  }

  const root = level[0]?.hash;
  if (!root) throw new Error("Merkle root missing");
  return { root, proofs };
}

function hashPair(left: Hex, right: Hex): Hex {
  assertBytes32(left, "left node");
  assertBytes32(right, "right node");
  return BigInt(left) < BigInt(right)
    ? keccak256(concatHex([left, right]))
    : keccak256(concatHex([right, left]));
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      if (cell.length !== 0) throw new Error("Unexpected quote in CSV");
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("Unterminated quoted CSV field");
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.trim().length > 0)) rows.push(row);
  return rows;
}

function assertBytes32(value: Hex, name: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be bytes32`);
}
