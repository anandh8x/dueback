# DueBack

DueBack is an Arc Testnet application for fully funded refunds and large-scale payouts. It allows an organization to commit the complete amount required for a campaign before recipients begin claiming, while keeping the private recipient list outside the public blockchain.

The product combines local claim-packet generation, immutable Merkle commitments, domain-backed organization identity, exactly funded smart contracts, and a public verification interface.

## Why DueBack exists

Refund and payout announcements are usually promises backed by an internal database. A recipient cannot independently confirm whether:

- the complete payout amount has been reserved;
- their allocation existed when the campaign was announced;
- an allocation was changed after publication;
- the same allocation can be paid more than once;
- unclaimed funds and completed payments reconcile with the original total.

Publishing the complete recipient list onchain would make those questions easier to audit, but would expose private contacts and commercial records. DueBack separates private allocation data from public financial state.

## How it works

### 1. Establish organization identity

An organizer connects the wallet that will administer the organization and requests a one-time DNS challenge. The organizer publishes the challenge as a TXT record under its domain.

The DueBack verifier confirms the DNS record and signs a short-lived EIP-712 attestation. `OrganizationRegistry` verifies that attestation on Arc and records the domain, administrator, authorized issuers, and reclaim address.

### 2. Prepare the allocation locally

The organizer imports a CSV containing internal recipient references, amounts, and optional delivery contacts. DueBack validates and processes this file entirely in the browser.

For every allocation, the browser creates a cryptographically random claim identifier and bearer secret. It then builds a Merkle tree and produces:

- a public campaign manifest containing the root, totals, hashes, timing, and contract request;
- a private claim-packet export containing the credentials that must be delivered to recipients.

Recipient references, contacts, and unclaimed secrets are not sent to Arc.

### 3. Fund the complete campaign

An authorized issuer submits the generated campaign request and transfers the exact committed total to `DueBackCampaigns`. The contract rejects both underfunding and overfunding.

Once confirmed, the Merkle root, total amount, recipient count, policy hash, notice hash, metadata hash, claim window, issuer, and reclaim address cannot be silently changed.

### 4. Distribute private claim packets

The organizer delivers each bearer packet through an authenticated offchain channel such as an existing customer portal or verified communication system.

A packet contains only the information required to prove one allocation. It does not reveal the rest of the campaign.

### 5. Verify and claim

Before connecting a wallet, a recipient can load the packet and independently inspect the live campaign state from Arc. DueBack checks:

- that the packet proof matches the immutable Merkle root;
- that the committed amount is fully funded;
- that the claim window is open;
- that the allocation has not already been paid;
- that the organization remains active.

After the recipient selects a destination wallet, the contract validates the proof and secret, marks the allocation as paid, and transfers the exact committed amount. Duplicate claims are rejected.

### 6. Reconcile the result

Anyone can inspect the total committed, total claimed, remaining balance, recipient count, paid-claim count, campaign timing, and reclaim state directly from Arc. After the claim window closes, only the unclaimed balance can be returned to the campaign's committed reclaim address.

## What DueBack proves

DueBack provides public evidence that:

- the full campaign total was locked at creation;
- the allocation commitment has not changed;
- valid claims receive their exact committed amounts;
- the same allocation cannot be paid twice;
- claimed, remaining, and reclaimed values reconcile onchain.

## What remains offchain

DueBack does not decide whether a recipient is eligible or whether an organizer calculated an allocation correctly. Organizations remain responsible for:

- determining eligibility and amounts;
- protecting the private claim-packet export;
- delivering packets to the correct recipients;
- maintaining accurate policy and notice documents;
- securing administrator, issuer, reclaim, and attestor keys.

Claim packets are bearer credentials. Anyone who obtains an unclaimed packet can submit it to a wallet of their choice.

## Architecture

```text
apps/web/          React and Vite interface for verification, claiming, and campaign creation
api/               Stateless Vercel DNS challenge and EIP-712 attestation functions
contracts/         OrganizationRegistry and DueBackCampaigns Solidity contracts
packages/protocol/ CSV validation, amount handling, Merkle trees, manifests, and claim packets
services/verifier/ Go verifier for local or long-running deployments
scripts/           Arc Testnet deployment, verification, and smoke-test commands
tests/browser/     Desktop and mobile product workflow tests
```

The Vercel API seals challenge state with an HMAC, so serverless instances do not depend on writable disk. The attestor private key is read only from the deployment environment. The Go verifier provides an alternative persistent single-instance service using a permission-restricted local challenge store and a Foundry keystore signer.

## Arc Testnet contracts

- `OrganizationRegistry`: [`0x5028C830C3260fE5604B7F39eB118a1F3dBe34f5`](https://testnet.arcscan.app/address/0x5028C830C3260fE5604B7F39eB118a1F3dBe34f5)
- `DueBackCampaigns`: [`0x111f01A0ee61C7A9D779c2C9f9b91cadD7d5a0ec`](https://testnet.arcscan.app/address/0x111f01A0ee61C7A9D779c2C9f9b91cadD7d5a0ec)
- Current testnet attestor: [`0x99066fBc97557490fA794F750630bb41733D1004`](https://testnet.arcscan.app/address/0x99066fBc97557490fA794F750630bb41733D1004)

Both contract sources are verified on ArcScan.

## Run locally

Requirements:

- Node.js 22 or newer
- pnpm 11
- Go 1.26 or newer for the Go verifier
- Foundry for contract and deployment commands

```bash
pnpm install
cp .env.example .env
pnpm dev:web
```

The web interface runs at `http://localhost:5173`.

To run the Go domain verifier in a second terminal:

```bash
pnpm dev:verifier
```

The command requests the attestor keystore password locally, stores it in a temporary owner-only file for the process lifetime, and removes that file on exit.

## Verify the repository

```bash
pnpm verify
pnpm test:browser
pnpm audit --prod
```

The release suite covers protocol utilities, serverless verifier challenges, frontend clients and error states, Go verifier behavior, Solidity authorization and accounting, production builds, and desktop and mobile workflows.

## Deploy the contracts

Configure a deployer and attestor in the ignored `.env` file:

```text
DUEBACK_FOUNDRY_ACCOUNT=your-deployer-account
DUEBACK_ATTESTOR_ADDRESS=0x...
DUEBACK_RECLAIM_CHANGE_DELAY=86400
```

Then run:

```bash
pnpm arc:deploy
pnpm arc:verify
pnpm arc:smoke
```

The deployment command checks the Arc Testnet chain ID and deployer balance, validates constructor relationships and bytecode, writes a public deployment manifest, and updates the local frontend contract addresses.

## Deploy to Vercel

The frontend and serverless verifier can be deployed as one Vercel project. Configure these build-time and runtime variables:

```text
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
VITE_ARC_EXPLORER_URL=https://testnet.arcscan.app
VITE_ORGANIZATION_REGISTRY_ADDRESS=0x5028C830C3260fE5604B7F39eB118a1F3dBe34f5
VITE_DUEBACK_CAMPAIGNS_ADDRESS=0x111f01A0ee61C7A9D779c2C9f9b91cadD7d5a0ec
VITE_FEATURED_CAMPAIGN_ID=0x8dfffaf7881664582784a2186d40cfe87cd7a7114833096cbe3e0f022b3edc11

DUEBACK_CHAIN_ID=5042002
DUEBACK_ORGANIZATION_REGISTRY_ADDRESS=0x5028C830C3260fE5604B7F39eB118a1F3dBe34f5
DUEBACK_CHALLENGE_SECRET=<random value of at least 32 characters>
DUEBACK_ATTESTOR_PRIVATE_KEY=<dedicated attestor private key>
```

The private key must control the `domainAttestor` address configured in `OrganizationRegistry`. Use a dedicated signing wallet. Do not place the deployer key or any private key in source control or a `VITE_` variable.

## Status

DueBack is an independent Arc Testnet prototype. Use testnet tokens only.
