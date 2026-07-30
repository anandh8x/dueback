import {
  createWalletClient,
  createPublicClient,
  custom,
  defineChain,
  getAddress,
  http,
  isAddress,
  isHex,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Hex,
} from "viem";
import { verifyClaimPacket, type ClaimPacket } from "@dueback/protocol";

const defaultRpcUrl = "https://rpc.testnet.arc.network";
const defaultExplorerUrl = "https://testnet.arcscan.app";

export const arcTestnet = defineChain({
  id: 5_042_002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_ARC_RPC_URL || defaultRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: import.meta.env.VITE_ARC_EXPLORER_URL || defaultExplorerUrl,
    },
  },
  testnet: true,
});

const campaignComponents = [
  { name: "organizationId", type: "bytes32" },
  { name: "merkleRoot", type: "bytes32" },
  { name: "policyHash", type: "bytes32" },
  { name: "metadataHash", type: "bytes32" },
  { name: "noticeHash", type: "bytes32" },
  { name: "supersedesCampaignId", type: "bytes32" },
  { name: "issuer", type: "address" },
  { name: "reclaimAddress", type: "address" },
  { name: "totalAmount", type: "uint256" },
  { name: "claimedAmount", type: "uint256" },
  { name: "reclaimedAmount", type: "uint256" },
  { name: "opensAt", type: "uint64" },
  { name: "closesAt", type: "uint64" },
  { name: "recipientCount", type: "uint32" },
  { name: "claimedCount", type: "uint32" },
  { name: "reclaimed", type: "bool" },
] as const;

const organizationComponents = [
  { name: "admin", type: "address" },
  { name: "reclaimAddress", type: "address" },
  { name: "pendingReclaimAddress", type: "address" },
  { name: "pendingReclaimActivatesAt", type: "uint64" },
  { name: "domainVerifiedUntil", type: "uint64" },
  { name: "reclaimVersion", type: "uint32" },
  { name: "active", type: "bool" },
  { name: "domain", type: "string" },
  { name: "displayName", type: "string" },
] as const;

export const dueBackCampaignsAbi = [
  {
    type: "function",
    name: "getCampaign",
    stateMutability: "view",
    inputs: [{ name: "campaignId", type: "bytes32" }],
    outputs: [{ name: "campaign", type: "tuple", components: campaignComponents }],
  },
  {
    type: "function",
    name: "isClaimed",
    stateMutability: "view",
    inputs: [
      { name: "campaignId", type: "bytes32" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "paid", type: "bool" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "campaignId", type: "bytes32" },
      { name: "index", type: "uint256" },
      { name: "claimId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "secret", type: "bytes32" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [],
  },
] as const;

export const organizationRegistryAbi = [
  {
    type: "function",
    name: "getOrganization",
    stateMutability: "view",
    inputs: [{ name: "organizationId", type: "bytes32" }],
    outputs: [{ name: "organization", type: "tuple", components: organizationComponents }],
  },
] as const;

export interface LiveCampaign {
  campaignId: Hex;
  organizationId: Hex;
  organizationName: string;
  organizationDomain: string;
  issuer: Address;
  reclaimAddress: Address;
  merkleRoot: Hex;
  totalAmount: bigint;
  claimedAmount: bigint;
  reclaimedAmount: bigint;
  opensAt: bigint;
  closesAt: bigint;
  recipientCount: number;
  claimedCount: number;
  reclaimed: boolean;
  organizationActive: boolean;
  domainVerifiedUntil: bigint;
  contractAddress: Address;
}

export interface ClaimReadiness {
  campaign: LiveCampaign;
  proofValid: boolean;
  alreadyClaimed: boolean;
  claimOpen: boolean;
}

export function campaignContractAddress(): Address | null {
  const configured = import.meta.env.VITE_DUEBACK_CAMPAIGNS_ADDRESS;
  return configured && isAddress(configured) ? getAddress(configured) : null;
}

export function organizationRegistryAddress(): Address | null {
  const configured = import.meta.env.VITE_ORGANIZATION_REGISTRY_ADDRESS;
  return configured && isAddress(configured) ? getAddress(configured) : null;
}

export function parseCampaignId(value: string): Hex {
  const match = value.trim().match(/0x[a-fA-F0-9]{64}/);
  if (!match || !isHex(match[0], { strict: true }) || match[0].length !== 66) {
    throw new Error("Enter a 32-byte campaign ID or a claim link containing one.");
  }
  return match[0];
}

export function campaignExplorerUrl(address: Address): string {
  return `${arcTestnet.blockExplorers.default.url}/address/${address}`;
}

export async function readLiveCampaign(input: string): Promise<LiveCampaign> {
  const campaignId = parseCampaignId(input);
  const campaignsAddress = campaignContractAddress();
  const registryAddress = organizationRegistryAddress();
  if (!campaignsAddress || !registryAddress) {
    throw new Error("Live Arc contracts are not configured in this build.");
  }

  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(),
  });
  const campaign = await client.readContract({
    address: campaignsAddress,
    abi: dueBackCampaignsAbi,
    functionName: "getCampaign",
    args: [campaignId],
  });
  const organization = await client.readContract({
    address: registryAddress,
    abi: organizationRegistryAbi,
    functionName: "getOrganization",
    args: [campaign.organizationId],
  });

  return {
    campaignId,
    organizationId: campaign.organizationId,
    organizationName: organization.displayName,
    organizationDomain: organization.domain,
    issuer: campaign.issuer,
    reclaimAddress: campaign.reclaimAddress,
    merkleRoot: campaign.merkleRoot,
    totalAmount: campaign.totalAmount,
    claimedAmount: campaign.claimedAmount,
    reclaimedAmount: campaign.reclaimedAmount,
    opensAt: campaign.opensAt,
    closesAt: campaign.closesAt,
    recipientCount: campaign.recipientCount,
    claimedCount: campaign.claimedCount,
    reclaimed: campaign.reclaimed,
    organizationActive: organization.active,
    domainVerifiedUntil: organization.domainVerifiedUntil,
    contractAddress: campaignsAddress,
  };
}

export async function inspectClaimPacket(packet: ClaimPacket): Promise<ClaimReadiness> {
  const campaign = await readLiveCampaign(packet.campaignId);
  const client = publicClient();
  const alreadyClaimed = await client.readContract({
    address: campaign.contractAddress,
    abi: dueBackCampaignsAbi,
    functionName: "isClaimed",
    args: [packet.campaignId, BigInt(packet.index)],
  });
  const now = BigInt(Math.floor(Date.now() / 1000));

  return {
    campaign,
    proofValid: verifyClaimPacket(packet, campaign.merkleRoot),
    alreadyClaimed,
    claimOpen: now >= campaign.opensAt && now < campaign.closesAt && !campaign.reclaimed,
  };
}

export async function submitClaimPacket(
  packet: ClaimPacket,
  provider: EIP1193Provider,
): Promise<Hash> {
  const readiness = await inspectClaimPacket(packet);
  if (!readiness.proofValid) throw new Error("The claim packet does not match the campaign root.");
  if (readiness.alreadyClaimed) throw new Error("This claim has already been paid.");
  if (!readiness.claimOpen) throw new Error("This campaign is not accepting claims right now.");

  const wallet = createWalletClient({
    chain: arcTestnet,
    transport: custom(provider),
  });
  try {
    await wallet.switchChain({ id: arcTestnet.id });
  } catch {
    await wallet.addChain({ chain: arcTestnet });
    await wallet.switchChain({ id: arcTestnet.id });
  }
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error("No wallet account was selected.");

  const { request } = await publicClient().simulateContract({
    account,
    address: readiness.campaign.contractAddress,
    abi: dueBackCampaignsAbi,
    functionName: "claim",
    args: [
      packet.campaignId,
      BigInt(packet.index),
      packet.claimId,
      BigInt(packet.amount),
      packet.secret,
      packet.proof,
    ],
  });
  return wallet.writeContract(request);
}

function publicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(),
  });
}
