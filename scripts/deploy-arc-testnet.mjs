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

const chainId = 5_042_002;
const rpcUrl = process.env.DUEBACK_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const explorer = process.env.DUEBACK_ARC_EXPLORER_URL ?? "https://testnet.arcscan.app";
const account = process.env.DUEBACK_FOUNDRY_ACCOUNT;
const keystorePath = process.env.DUEBACK_KEYSTORE_PATH;
const passwordFile = process.env.DUEBACK_PASSWORD_FILE;
const domainAttestor = requireAddress(
  process.env.DUEBACK_ATTESTOR_ADDRESS,
  "DUEBACK_ATTESTOR_ADDRESS",
);
const reclaimChangeDelay = parsePositiveInteger(
  process.env.DUEBACK_RECLAIM_CHANGE_DELAY ?? "86400",
  "DUEBACK_RECLAIM_CHANGE_DELAY",
);

if (
  (account === undefined || account === "") &&
  (keystorePath === undefined || keystorePath === "")
) {
  throw new Error("DUEBACK_FOUNDRY_ACCOUNT or DUEBACK_KEYSTORE_PATH is required");
}
if (passwordFile === undefined || passwordFile === "" || !existsSync(passwordFile)) {
  throw new Error("Run this deployment through pnpm arc:deploy");
}

const actualChainId = Number.parseInt(await rpcString("eth_chainId"), 16);
if (actualChainId !== chainId) {
  throw new Error(
    `Refusing deployment: expected Arc Testnet ${String(chainId)}, received ${String(actualChainId)}`,
  );
}

const deployer = requireAddress(
  run("cast", ["wallet", "address", ...walletArguments(), "--password-file", passwordFile]),
  "deployer",
);
const balance = BigInt(await rpcString("eth_getBalance", [deployer, "latest"]));
if (balance === 0n) {
  throw new Error(`${deployer} has no Arc Testnet USDC for deployment gas`);
}

run("forge", ["build", "--root", "contracts"]);
const registry = deploy("src/OrganizationRegistry.sol:OrganizationRegistry", [
  domainAttestor,
  String(reclaimChangeDelay),
]);
const campaigns = deploy("src/DueBackCampaigns.sol:DueBackCampaigns", [registry.address]);

for (const deployment of [registry, campaigns]) {
  const receipt = await waitForReceipt(deployment.transactionHash);
  if (
    receipt.status !== "0x1" ||
    receipt.contractAddress?.toLowerCase() !== deployment.address.toLowerCase()
  ) {
    throw new Error(`Deployment receipt did not confirm ${deployment.address}`);
  }
  deployment.blockNumber = Number.parseInt(receipt.blockNumber, 16);
  if ((await rpcString("eth_getCode", [deployment.address, "latest"])) === "0x") {
    throw new Error(`No runtime bytecode found at ${deployment.address}`);
  }
}

const configuredAttestor = requireAddress(
  run("cast", ["call", registry.address, "domainAttestor()(address)", "--rpc-url", rpcUrl]),
  "registry domain attestor",
);
const configuredRegistry = requireAddress(
  run("cast", ["call", campaigns.address, "registry()(address)", "--rpc-url", rpcUrl]),
  "campaign registry",
);
if (configuredAttestor.toLowerCase() !== domainAttestor.toLowerCase()) {
  throw new Error("Registry domain attestor does not match the deployment input");
}
if (configuredRegistry.toLowerCase() !== registry.address.toLowerCase()) {
  throw new Error("Campaign contract registry does not match the deployed registry");
}

const manifest = {
  schemaVersion: 1,
  network: "Arc Testnet",
  chainId,
  rpcUrl,
  explorer,
  nativeGasToken: { name: "USDC", symbol: "USDC", decimals: 18 },
  compiler: {
    version: "0.8.30",
    optimizer: true,
    optimizerRuns: 200,
  },
  deployedAt: new Date().toISOString(),
  deployer,
  domainAttestor,
  reclaimChangeDelay,
  contracts: {
    OrganizationRegistry: {
      address: registry.address,
      transactionHash: registry.transactionHash,
      blockNumber: registry.blockNumber,
    },
    DueBackCampaigns: {
      address: campaigns.address,
      transactionHash: campaigns.transactionHash,
      blockNumber: campaigns.blockNumber,
    },
  },
};

const deploymentDirectory = process.env.DUEBACK_DEPLOYMENT_DIR ?? "deployments";
mkdirSync(deploymentDirectory, { recursive: true });
writeFileSync(`${deploymentDirectory}/arc-testnet.json`, `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o644,
});
writeFileSync(
  `${deploymentDirectory}/arc-testnet.env`,
  [
    `VITE_ARC_RPC_URL=${rpcUrl}`,
    `VITE_ARC_EXPLORER_URL=${explorer}`,
    `VITE_ORGANIZATION_REGISTRY_ADDRESS=${registry.address}`,
    `VITE_DUEBACK_CAMPAIGNS_ADDRESS=${campaigns.address}`,
    `DUEBACK_CHAIN_ID=${String(chainId)}`,
    `DUEBACK_ORGANIZATION_REGISTRY_ADDRESS=${registry.address}`,
    `DUEBACK_CAMPAIGNS_ADDRESS=${campaigns.address}`,
    "",
  ].join("\n"),
  { mode: 0o644 },
);
updateLocalEnvironment({
  VITE_ARC_RPC_URL: rpcUrl,
  VITE_ARC_EXPLORER_URL: explorer,
  VITE_ORGANIZATION_REGISTRY_ADDRESS: registry.address,
  VITE_DUEBACK_CAMPAIGNS_ADDRESS: campaigns.address,
  DUEBACK_CHAIN_ID: String(chainId),
  DUEBACK_ORGANIZATION_REGISTRY_ADDRESS: registry.address,
  DUEBACK_CAMPAIGNS_ADDRESS: campaigns.address,
});

process.stdout.write(
  `${JSON.stringify(manifest, null, 2)}\n\nRun pnpm arc:verify after ArcScan indexes both deployments.\n`,
);

function deploy(contract, constructorArguments) {
  const output = run("forge", [
    "create",
    "--root",
    "contracts",
    "--broadcast",
    "--rpc-url",
    rpcUrl,
    ...walletArguments(),
    "--password-file",
    passwordFile,
    "--json",
    contract,
    "--constructor-args",
    ...constructorArguments,
  ]);
  const parsed = parseJSONOutput(output);
  const outputDeployer = requireAddress(parsed.deployer, "forge deployer");
  if (outputDeployer.toLowerCase() !== deployer.toLowerCase()) {
    throw new Error("Forge used an unexpected deployment account");
  }
  return {
    address: requireAddress(parsed.deployedTo ?? parsed.deployed_to, "deployed contract"),
    transactionHash: requireHash(
      parsed.transactionHash ?? parsed.transaction_hash,
      "deployment transaction",
    ),
    blockNumber: 0,
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

function parseJSONOutput(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Forge did not return JSON deployment output");
  return JSON.parse(output.slice(start, end + 1));
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

function parsePositiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${label} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is too large`);
  return parsed;
}

async function rpcString(method, params = []) {
  const result = await rpc(method, params);
  if (typeof result !== "string") throw new Error(`${method} returned an invalid result`);
  return result;
}

async function rpc(method, params = []) {
  const response = await globalThis.fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
  });
  if (!response.ok) throw new Error(`${method} failed with HTTP ${String(response.status)}`);
  const payload = await response.json();
  if (payload.error !== undefined) {
    throw new Error(`${method} failed: ${payload.error.message ?? JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

async function waitForReceipt(transactionHash) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const receipt = await rpc("eth_getTransactionReceipt", [transactionHash]);
    if (receipt !== null) return receipt;
    await delay(500);
  }
  throw new Error(`Timed out waiting for deployment ${transactionHash}`);
}

function updateLocalEnvironment(values) {
  let source = existsSync(environmentPath) ? readFileSync(environmentPath, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    source = pattern.test(source)
      ? source.replace(pattern, line)
      : `${source.trimEnd()}\n${line}\n`;
  }
  writeFileSync(environmentPath, source.trimStart(), { encoding: "utf8", mode: 0o600 });
}

function walletArguments() {
  if (keystorePath !== undefined && keystorePath !== "") {
    return ["--keystore", keystorePath];
  }
  return ["--account", account];
}
