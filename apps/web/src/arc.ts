import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

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
  const campaignsAddress = campaignContractAddress();
  const registryAddress = organizationRegistryAddress();
  if (!campaignsAddress || !registryAddress) {
    throw new Error("Live Arc contracts are not configured in this build.");
  }

  const campaignId = parseCampaignId(input);
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
