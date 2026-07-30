import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const deploymentDirectory = process.env.DUEBACK_DEPLOYMENT_DIR ?? "deployments";
const manifest = JSON.parse(readFileSync(`${deploymentDirectory}/arc-testnet.json`, "utf8"));
if (manifest.chainId !== 5_042_002) {
  throw new Error("Deployment manifest is not for Arc Testnet");
}

const registryArguments = run("cast", [
  "abi-encode",
  "constructor(address,uint64)",
  manifest.domainAttestor,
  String(manifest.reclaimChangeDelay),
]);
const campaignsArguments = run("cast", [
  "abi-encode",
  "constructor(address)",
  manifest.contracts.OrganizationRegistry.address,
]);

verify(
  manifest.contracts.OrganizationRegistry.address,
  "src/OrganizationRegistry.sol:OrganizationRegistry",
  registryArguments,
);
verify(
  manifest.contracts.DueBackCampaigns.address,
  "src/DueBackCampaigns.sol:DueBackCampaigns",
  campaignsArguments,
);

process.stdout.write(
  [
    "Both contracts are verified on ArcScan.",
    `${manifest.explorer}/address/${manifest.contracts.OrganizationRegistry.address}`,
    `${manifest.explorer}/address/${manifest.contracts.DueBackCampaigns.address}`,
    "",
  ].join("\n"),
);

function verify(address, contract, constructorArguments) {
  run("forge", [
    "verify-contract",
    "--root",
    "contracts",
    address,
    contract,
    "--chain-id",
    String(manifest.chainId),
    "--verifier",
    "blockscout",
    "--verifier-url",
    `${manifest.explorer}/api/`,
    "--constructor-args",
    constructorArguments,
    "--watch",
  ]);
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
    process.stdout.write(result.stdout);
    throw new Error(`${command} exited with status ${String(result.status)}`);
  }
  if (result.stderr !== "") process.stderr.write(result.stderr);
  if (result.stdout !== "") process.stdout.write(result.stdout);
  return result.stdout.trim();
}
