import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const environmentPath = process.env.DUEBACK_ENV_FILE ?? ".env";
try {
  process.loadEnvFile(environmentPath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const manifest = JSON.parse(readFileSync("deployments/arc-testnet.json", "utf8"));
if (manifest.chainId !== 5_042_002) throw new Error("Deployment is not on Arc Testnet");

const rpcUrl = manifest.rpcUrl;
const registry = manifest.contracts.OrganizationRegistry.address;
const campaigns = manifest.contracts.DueBackCampaigns.address;
const account = process.env.DUEBACK_FOUNDRY_ACCOUNT;
const keystorePath = process.env.DUEBACK_KEYSTORE_PATH;
const passwordFile = process.env.DUEBACK_PASSWORD_FILE;
if (
  (account === undefined || account === "") &&
  (keystorePath === undefined || keystorePath === "")
) {
  throw new Error("DUEBACK_FOUNDRY_ACCOUNT or DUEBACK_KEYSTORE_PATH is required");
}
if (passwordFile === undefined || passwordFile === "" || !existsSync(passwordFile)) {
  throw new Error("Run this smoke test through pnpm arc:smoke");
}

const deployer = requireAddress(
  run("cast", ["wallet", "address", ...walletArguments(), "--password-file", passwordFile]),
  "deployer",
);
if (deployer.toLowerCase() !== manifest.deployer.toLowerCase()) {
  throw new Error("Smoke-test account does not match the deployment account");
}
if (manifest.domainAttestor.toLowerCase() !== deployer.toLowerCase()) {
  throw new Error("This smoke flow requires the configured testnet attestor account");
}

const stamp = Math.floor(Date.now() / 1000);
const domain = `smoke-${String(stamp)}.dueback.test`;
const displayName = `DueBack Smoke ${String(stamp)}`;
const organizationId = run("cast", ["keccak", domain]);
const nonce = run("cast", ["keccak", `dueback-attestation-${String(stamp)}`]);
const verifiedUntil = stamp + 86_400;
const attestationTuple = `(${organizationId},${deployer},${String(verifiedUntil)},${nonce})`;
const digest = run("cast", [
  "call",
  registry,
  "hashDomainAttestation((bytes32,address,uint64,bytes32))(bytes32)",
  attestationTuple,
  "--rpc-url",
  rpcUrl,
]);
const signature = run("cast", [
  "wallet",
  "sign",
  digest,
  "--no-hash",
  ...walletArguments(),
  "--password-file",
  passwordFile,
]);
const registration = send(
  registry,
  "registerOrganization(string,string,address,uint64,bytes32,bytes)",
  [domain, displayName, deployer, String(verifiedUntil), nonce, signature],
);

const campaignReference = run("cast", ["keccak", `smoke-campaign-${String(stamp)}`]);
const campaignId = run("cast", [
  "call",
  campaigns,
  "campaignIdFor(bytes32,bytes32)(bytes32)",
  organizationId,
  campaignReference,
  "--rpc-url",
  rpcUrl,
]);
const claimId = run("cast", ["keccak", `smoke-claim-${String(stamp)}`]);
const secret = run("cast", ["keccak", `smoke-secret-${String(stamp)}`]);
const amount = "100000000000000";
const leaf = run("cast", [
  "call",
  campaigns,
  "leafFor(bytes32,uint256,bytes32,uint256,bytes32)(bytes32)",
  campaignId,
  "0",
  claimId,
  amount,
  run("cast", ["keccak", secret]),
  "--rpc-url",
  rpcUrl,
]);
const policyHash = run("cast", ["keccak", `smoke-policy-${String(stamp)}`]);
const metadataHash = run("cast", ["keccak", `smoke-metadata-${String(stamp)}`]);
const noticeHash = run("cast", ["keccak", `smoke-notice-${String(stamp)}`]);
const zeroHash = `0x${"0".repeat(64)}`;
const opensAt = stamp + 20;
const closesAt = opensAt + 120;
const request = [
  organizationId,
  campaignReference,
  leaf,
  policyHash,
  metadataHash,
  noticeHash,
  zeroHash,
  amount,
  String(opensAt),
  String(closesAt),
  "1",
].join(",");
const creation = send(
  campaigns,
  "createCampaign((bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint256,uint64,uint64,uint32))",
  [`(${request})`],
  ["--value", `${amount}wei`],
);

await waitUntil(opensAt + 3);
const claim = send(campaigns, "claim(bytes32,uint256,bytes32,uint256,bytes32,bytes32[])", [
  campaignId,
  "0",
  claimId,
  amount,
  secret,
  "[]",
]);
const claimed = run("cast", [
  "call",
  campaigns,
  "isClaimed(bytes32,uint256)(bool)",
  campaignId,
  "0",
  "--rpc-url",
  rpcUrl,
]);
if (claimed !== "true") throw new Error("Claim bitmap was not updated");

const duplicate = spawnSync(
  "cast",
  [
    "estimate",
    campaigns,
    "claim(bytes32,uint256,bytes32,uint256,bytes32,bytes32[])",
    campaignId,
    "0",
    claimId,
    amount,
    secret,
    "[]",
    "--from",
    deployer,
    "--rpc-url",
    rpcUrl,
  ],
  { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
if (duplicate.status === 0) throw new Error("Duplicate claim unexpectedly passed estimation");

const report = {
  schemaVersion: 1,
  network: manifest.network,
  chainId: manifest.chainId,
  checkedAt: new Date().toISOString(),
  contracts: {
    OrganizationRegistry: registry,
    DueBackCampaigns: campaigns,
  },
  organization: {
    domain,
    organizationId,
    registrationTransaction: registration.transactionHash,
    attestationMode: "CONFIGURED_ATTESTOR_SYNTHETIC_DOMAIN",
  },
  campaign: {
    campaignId,
    merkleRoot: leaf,
    amountWei: amount,
    recipientCount: 1,
    createTransaction: creation.transactionHash,
    opensAt,
    closesAt,
  },
  claim: {
    claimId,
    transaction: claim.transactionHash,
    claimed: true,
    duplicateBlocked: true,
  },
  publicStateNotice: "Wallet addresses, amounts, timing, and settlement data are public on Arc.",
};

mkdirSync("deployments", { recursive: true });
writeFileSync("deployments/arc-testnet-smoke.json", `${JSON.stringify(report, null, 2)}\n`, {
  mode: 0o644,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function send(address, signatureName, args, extra = []) {
  const output = run("cast", [
    "send",
    address,
    signatureName,
    ...args,
    "--rpc-url",
    rpcUrl,
    ...walletArguments(),
    "--password-file",
    passwordFile,
    ...extra,
    "--json",
  ]);
  const receipt = JSON.parse(output);
  if (receipt.status !== "0x1") throw new Error(`${signatureName} transaction reverted`);
  return {
    transactionHash: requireHash(receipt.transactionHash, `${signatureName} transaction`),
  };
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`${command} exited with status ${String(result.status)}`);
  }
  if (result.stderr !== "") process.stderr.write(result.stderr);
  return result.stdout.trim();
}

async function waitUntil(timestamp) {
  while (Math.floor(Date.now() / 1000) < timestamp) {
    await delay(500);
  }
}

function requireAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value.trim())) {
    throw new Error(`${label} is not a valid address`);
  }
  return value.trim();
}

function requireHash(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.trim())) {
    throw new Error(`${label} is not a valid transaction hash`);
  }
  return value.trim();
}

function walletArguments() {
  if (keystorePath !== undefined && keystorePath !== "") {
    return ["--keystore", keystorePath];
  }
  return ["--account", account];
}
