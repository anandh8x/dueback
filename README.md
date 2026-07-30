# DueBack

DueBack is an Arc Testnet prototype for fully funded refunds and mass payouts.

Organizations often announce refunds before recipients can verify whether enough money exists, whether the claim list can change, or whether the same allocation can be paid twice. DueBack makes those commitments inspectable before a recipient connects a wallet.

## What it does

- Locks the complete campaign amount when a campaign is created.
- Commits recipient allocations through a Merkle root.
- Gives each recipient a private bearer claim packet.
- Verifies campaign funding, timing, totals, and claim status from Arc.
- Pays the exact committed amount once for each valid packet.
- Makes claimed, remaining, and reclaimed totals publicly reconcilable.
- Ties campaign issuers to domain-backed organization records.

Claim packets are prepared locally. Wallet addresses, claimed amounts, transaction timing, campaign totals, and contract state are public on Arc.

## Trust boundary

DueBack proves that a published allocation is funded and cannot be silently changed after campaign creation. It does not prove that an organizer calculated eligibility correctly or delivered private packets to the correct people.

Organizations remain responsible for:

- deciding who qualifies;
- calculating allocations correctly;
- protecting and delivering bearer claim packets;
- publishing accurate policy and notice documents.

## Repository

```text
apps/web/          React and Vite product interface
contracts/         Solidity organization registry and funded campaign contracts
packages/protocol/ Local CSV, commitment, Merkle proof, and packet utilities
scripts/           Arc Testnet deployment and verification commands
tests/browser/     Desktop and mobile product workflow tests
```

## Run locally

Requirements:

- Node.js 22 or newer
- pnpm 11
- Foundry for contract commands

```bash
pnpm install
pnpm dev:web
```

Open `http://localhost:5173`.

The campaign explorer reads Arc directly when these variables are configured:

```bash
cp .env.example .env
```

```text
VITE_ORGANIZATION_REGISTRY_ADDRESS=0x...
VITE_DUEBACK_CAMPAIGNS_ADDRESS=0x...
```

Without deployed addresses, the interface offers a clearly labeled illustrative campaign. It never presents that data as a live verification result.

## Verify the code

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
pnpm contracts:test
```

The current contract suite covers exact funding, immutable campaign data, organization authorization, opening and closing windows, proof validation, duplicate prevention, exact-value claims, delayed reclaim-address changes, and post-close reconciliation.

## Deploy to Arc Testnet

Create an ignored `.env` file and configure either a Foundry account or keystore:

```text
DUEBACK_FOUNDRY_ACCOUNT=your-foundry-account
DUEBACK_ATTESTOR_ADDRESS=0x...
DUEBACK_RECLAIM_CHANGE_DELAY=86400
```

Then run:

```bash
pnpm arc:deploy
pnpm arc:verify
```

The guarded deployment command confirms the Arc Testnet chain ID, checks the deployer balance, verifies both constructor relationships, checks deployed bytecode, writes a public deployment manifest, and updates local frontend addresses.

## Contracts

`OrganizationRegistry` stores domain-backed organization identities, authorized issuers, active status, and delayed reclaim-address changes.

`DueBackCampaigns` creates exactly funded campaigns, validates private claim packets against immutable Merkle roots, prevents duplicate claims, pays recipients, and returns unclaimed funds to the committed reclaim address after closing.

Arc Testnet deployments:

- `OrganizationRegistry`: [`0x5028C830C3260fE5604B7F39eB118a1F3dBe34f5`](https://testnet.arcscan.app/address/0x5028C830C3260fE5604B7F39eB118a1F3dBe34f5)
- `DueBackCampaigns`: [`0x111f01A0ee61C7A9D779c2C9f9b91cadD7d5a0ec`](https://testnet.arcscan.app/address/0x111f01A0ee61C7A9D779c2C9f9b91cadD7d5a0ec)
- Deployer and testnet domain attestor: [`0x99066fBc97557490fA794F750630bb41733D1004`](https://testnet.arcscan.app/address/0x99066fBc97557490fA794F750630bb41733D1004)

Both contract sources are verified on ArcScan.

## Status

DueBack is an independent Arc Testnet prototype. Use testnet tokens only.
