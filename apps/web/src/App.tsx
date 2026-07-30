import { useMemo, useState } from "react";
import {
  campaignIdFor,
  campaignReferenceFor,
  formatArcAmount,
  generateDistribution,
  hashJson,
  organizationIdFor,
  parseAllocationCsv,
  parseClaimPacketJson,
  type ClaimPacket,
  type GeneratedDistribution,
} from "@dueback/protocol";
import type { EIP1193Provider, Hash } from "viem";
import {
  arcTestnet,
  campaignContractAddress,
  campaignExplorerUrl,
  featuredCampaignId,
  inspectClaimPacket,
  readLiveCampaign,
  selectedWalletAddress,
  submitClaimPacket,
  submitFundedCampaign,
  submitOrganizationRegistration,
  transactionExplorerUrl,
  type ClaimReadiness,
  type FundedCampaignRequest,
  type LiveCampaign,
  type OrganizationAttestation,
} from "./arc";
import { readableError } from "./errors";
import { createDomainChallenge, verifyDomainChallenge, type DomainChallenge } from "./verifier";

type View = "home" | "verify" | "organize";

const sampleCampaignId = `0x${"9f3a".padEnd(64, "7b2c")}`;
const sampleRoot = `0x${"7b14".padEnd(64, "6f2d")}`;
const sampleCsv = `reference,amount,contact
SAMPLE-001,0.001,alex@example.com
SAMPLE-002,0.002,jules@example.com
SAMPLE-003,0.003,sam@example.com`;

interface PreparedCampaign {
  distribution: GeneratedDistribution;
  request: FundedCampaignRequest;
  publicManifest: Record<string, unknown>;
}

export function App() {
  const [view, setView] = useState<View>("home");

  if (view === "verify") return <VerifyWorkspace onClose={() => setView("home")} />;
  if (view === "organize") return <OrganizerWorkspace onClose={() => setView("home")} />;

  return (
    <main>
      <Hero onView={setView} />
      <TrustSection />
      <WorkflowSection />
      <VerificationSection onOpen={() => setView("verify")} />
      <ClosingSection onView={setView} />
    </main>
  );
}

function Header({ onView }: { onView: (view: View) => void }) {
  return (
    <header className="site-header">
      <button className="wordmark" onClick={() => onView("home")} aria-label="DueBack home">
        <span className="wordmark-mark" aria-hidden="true">
          D
        </span>
        DueBack
      </button>
      <nav aria-label="Primary navigation">
        <a href="#product">Product</a>
        <a href="#workflow">How it works</a>
        <button onClick={() => onView("verify")}>Verify</button>
        <a href="#trust">Trust boundary</a>
      </nav>
      <button className="header-action" onClick={() => onView("verify")}>
        Open app <Arrow />
      </button>
    </header>
  );
}

function Hero({ onView }: { onView: (view: View) => void }) {
  return (
    <section className="hero" id="product">
      <div className="signal-field" aria-hidden="true">
        {Array.from({ length: 22 }, (_, index) => (
          <i key={index} style={{ "--i": index } as React.CSSProperties} />
        ))}
      </div>
      <Header onView={onView} />
      <div className="hero-content">
        <div className="hero-copy">
          <p className="eyebrow">
            <span>{"{"}</span> Funded on Arc · verified by anyone <span>{"}"}</span>
          </p>
          <h1>
            Refunds with proof built in<span>.</span>
          </h1>
          <p className="hero-summary">
            DueBack locks every committed dollar on Arc before recipients are asked to claim.
            Funding, deadlines, and totals remain independently verifiable.
          </p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={() => onView("verify")}>
              Verify a campaign <Arrow />
            </button>
            <button className="button button-secondary" onClick={() => onView("organize")}>
              Create a funded payout
            </button>
          </div>
          <div className="hero-footnote">
            <span className="arc-orbit" aria-hidden="true" />
            <div>
              <b>Arc Testnet prototype</b>
              <span>Exact-value claims · Public settlement state</span>
            </div>
          </div>
        </div>
        <FundingGraph />
      </div>
      <div className="horizon" aria-hidden="true" />
    </section>
  );
}

function FundingGraph() {
  const paths = Array.from({ length: 15 }, (_, index) => {
    const endY = 114 + index * 24;
    const bend = 355 + Math.abs(index - 7) * 7;
    return (
      <path
        key={index}
        className={index === 7 ? "claim-path active" : "claim-path"}
        d={`M 250 285 C ${bend} 285, 410 ${endY}, 548 ${endY}`}
      />
    );
  });

  return (
    <div className="graph-wrap" aria-label="One fully funded pool branches into exact claims">
      <svg viewBox="0 0 650 570" role="img">
        <title>DueBack funded campaign claim graph</title>
        <path className="orbit orbit-one" d="M 280 32 C 502 105, 610 400, 432 558" />
        <path className="orbit orbit-two" d="M 176 34 C 54 170, 72 406, 238 552" />
        <line className="source-line" x1="0" y1="285" x2="180" y2="285" />
        {paths}
        <circle className="fund-node" cx="250" cy="285" r="72" />
        <circle className="fund-node-pulse" cx="250" cy="285" r="72" />
        <path className="lock" d="M239 267v-8a11 11 0 0 1 22 0v8m-26 0h30v25h-30z" />
        <text className="fund-amount" x="250" y="320" textAnchor="middle">
          $2.45M
        </text>
        <text className="fund-label" x="250" y="340" textAnchor="middle">
          FULLY FUNDED
        </text>
        {Array.from({ length: 15 }, (_, index) => {
          const y = 114 + index * 24;
          return (
            <circle
              key={index}
              className={index === 7 ? "claim-dot active" : "claim-dot"}
              cx="548"
              cy={y}
              r={index === 7 ? 10 : 5}
            />
          );
        })}
        <text className="graph-label" x="500" y="82">
          12,408 RECIPIENTS
        </text>
        <text className="claim-amount" x="575" y="304">
          $196.40
        </text>
        <text className="claim-state" x="575" y="326">
          VERIFIED
        </text>
        <text className="claim-state muted" x="575" y="344">
          UNCLAIMED
        </text>
        <path className="root-line" d="M250 358v126l22 22h170" />
        <circle className="root-point" cx="442" cy="506" r="3" />
        <text className="root-label" x="456" y="510">
          IMMUTABLE ROOT
        </text>
        <text className="root-hash" x="456" y="531">
          0x9f3a...7b2c
        </text>
        <text className="root-label muted" x="456" y="550">
          ON ARC
        </text>
      </svg>
    </div>
  );
}

function TrustSection() {
  return (
    <section className="trust-section" id="trust">
      <div className="section-kicker">Why DueBack exists</div>
      <div className="trust-heading">
        <h2>A payout notice should come with evidence.</h2>
        <p>
          Recipients should not need to trust an unfamiliar email, a private spreadsheet, or a
          promise that funds will arrive later.
        </p>
      </div>
      <div className="trust-grid">
        <article>
          <span>01</span>
          <h3>Verify the sender</h3>
          <p>The organization is tied to a time-bounded domain verification on Arc.</p>
        </article>
        <article>
          <span>02</span>
          <h3>See the funding</h3>
          <p>The campaign cannot launch unless its complete committed amount is locked.</p>
        </article>
        <article>
          <span>03</span>
          <h3>Check your claim</h3>
          <p>Your packet proves the exact amount and can release it only once.</p>
        </article>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section className="workflow-section" id="workflow">
      <div className="section-kicker">A verifiable path</div>
      <h2>Private preparation. Public accountability.</h2>
      <div className="workflow-track">
        {[
          ["Prepare", "The allocation is validated and converted into commitments in the browser."],
          ["Fund", "The organizer locks the complete campaign amount as native USDC on Arc."],
          ["Claim", "A valid packet releases its exact committed value to the recipient once."],
          ["Reconcile", "Claimed, remaining, and reclaimed totals stay publicly verifiable."],
        ].map(([title, copy], index) => (
          <article key={title}>
            <div className="step-node">{String(index + 1).padStart(2, "0")}</div>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
      <p className="public-notice">
        Claim transfers, wallet addresses, amounts, and transaction timing are public on Arc
        Testnet.
      </p>
    </section>
  );
}

function VerificationSection({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="verification-section">
      <div className="verification-copy">
        <div className="section-kicker">Public campaign explorer</div>
        <h2>Know what the chain proves.</h2>
        <p>
          DueBack shows funding and claim integrity without pretending to verify an organizer’s
          offchain eligibility decisions.
        </p>
        <button className="text-action" onClick={onOpen}>
          Open the verifier <Arrow />
        </button>
      </div>
      <CampaignLedger />
    </section>
  );
}

function CampaignLedger({ campaign }: { campaign?: LiveCampaign | undefined }) {
  const total = campaign?.totalAmount ?? 125_000n * 10n ** 18n;
  const claimed = campaign?.claimedAmount ?? 82_3146n * 10n ** 17n;
  const reclaimed = campaign?.reclaimedAmount ?? 0n;
  const remaining = total - claimed - reclaimed;
  const progress = total === 0n ? 0 : Number((claimed * 10_000n) / total) / 100;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const status = campaign
    ? campaign.reclaimed
      ? "Reconciled"
      : now < campaign.opensAt
        ? "Funded · opens soon"
        : now >= campaign.closesAt
          ? "Claims closed"
          : "Fully funded · claims open"
    : "Fully funded · claims open";

  return (
    <div className="campaign-ledger">
      <div className="ledger-topline">
        <span className="status-dot" />
        {status}
      </div>
      <h3>
        {campaign ? `${campaign.organizationName} payout campaign` : "Spring membership refunds"}
      </h3>
      <p>
        {campaign
          ? `${campaign.organizationName} · ${campaign.organizationDomain}`
          : "Community Refunds Foundation · communityrefunds.org"}
      </p>
      <div className="ledger-values">
        <div>
          <span>Total committed</span>
          <b>${formatMoney(total)}</b>
        </div>
        <div>
          <span>Total claimed</span>
          <b>${formatMoney(claimed)}</b>
        </div>
        <div>
          <span>Remaining</span>
          <b>${formatMoney(remaining)}</b>
        </div>
      </div>
      <div className="ledger-progress">
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="ledger-code">
        <span>Immutable root</span>
        <code>
          {(campaign?.merkleRoot ?? sampleRoot).slice(0, 18)}...
          {(campaign?.merkleRoot ?? sampleRoot).slice(-8)}
        </code>
      </div>
      {campaign ? (
        <div className="live-details">
          <span>
            Recipients <b>{campaign.recipientCount.toLocaleString()}</b>
          </span>
          <span>
            Claims paid <b>{campaign.claimedCount.toLocaleString()}</b>
          </span>
          <span>
            Domain status <b>{campaign.organizationActive ? "Active" : "Inactive"}</b>
          </span>
          <a href={campaignExplorerUrl(campaign.contractAddress)} target="_blank" rel="noreferrer">
            View contract on ArcScan <Arrow />
          </a>
        </div>
      ) : null}
      <div className="proof-split">
        <div>
          <b>What this proves</b>
          <span>Funding, committed root, exact claims, duplicate prevention.</span>
        </div>
        <div>
          <b>What it does not prove</b>
          <span>Offchain eligibility or whether the organizer’s calculation was correct.</span>
        </div>
      </div>
    </div>
  );
}

function ClosingSection({ onView }: { onView: (view: View) => void }) {
  return (
    <section className="closing-section">
      <p className="eyebrow">
        <span>{"{"}</span> Make the commitment visible <span>{"}"}</span>
      </p>
      <h2>Fund first. Ask for trust second.</h2>
      <div className="hero-actions">
        <button className="button button-primary" onClick={() => onView("organize")}>
          Create a funded payout <Arrow />
        </button>
        <button className="button button-secondary" onClick={() => onView("verify")}>
          Verify a campaign
        </button>
      </div>
      <footer>
        <span>DueBack</span>
        <p>Independent Arc Testnet prototype</p>
        <p>Wallet addresses, amounts, and transactions are public on Arc.</p>
      </footer>
    </section>
  );
}

function WorkspaceHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="workspace-header">
      <button className="wordmark" onClick={onClose}>
        <span className="wordmark-mark">D</span>
        DueBack
      </button>
      <span>{title}</span>
      <div className="workspace-network">
        <i /> Arc Testnet
      </div>
      <button className="close-button" onClick={onClose}>
        Close
      </button>
    </header>
  );
}

function VerifyWorkspace({ onClose }: { onClose: () => void }) {
  const featured = featuredCampaignId();
  const [mode, setMode] = useState<"campaign" | "claim">("campaign");
  const [query, setQuery] = useState("");
  const [campaign, setCampaign] = useState<LiveCampaign | null>(null);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async (input: string) => {
    setLoading(true);
    setError(null);
    setCampaign(null);
    setDemo(false);
    try {
      if (input.trim().toLowerCase() === "demo") {
        setDemo(true);
      } else {
        setCampaign(await readLiveCampaign(input));
      }
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="workspace">
      <WorkspaceHeader title="Public campaign verifier" onClose={onClose} />
      <section className="workspace-body verify-workspace">
        <p className="eyebrow">
          <span>{"{"}</span> Read-only · sourced from Arc <span>{"}"}</span>
        </p>
        <h1>Verify before you claim.</h1>
        <div className="workspace-tabs" aria-label="Verification mode">
          <button
            className={mode === "campaign" ? "active" : ""}
            onClick={() => setMode("campaign")}
            aria-pressed={mode === "campaign"}
          >
            Campaign state
          </button>
          <button
            className={mode === "claim" ? "active" : ""}
            onClick={() => setMode("claim")}
            aria-pressed={mode === "claim"}
          >
            Claim packet
          </button>
        </div>
        {mode === "campaign" ? (
          <>
            <form
              className="verify-form"
              onSubmit={(event) => {
                event.preventDefault();
                void verify(query);
              }}
            >
              <label htmlFor="campaign-search">Campaign ID or claim link</label>
              <div>
                <input
                  id="campaign-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={sampleCampaignId}
                />
                <button type="submit" disabled={loading}>
                  {loading ? "Reading Arc..." : "Verify"}
                </button>
              </div>
              <div className="verify-shortcuts">
                {featured ? (
                  <button
                    className="live-action"
                    type="button"
                    onClick={() => void verify(featured)}
                  >
                    Load the real Arc smoke campaign
                  </button>
                ) : null}
                <button className="demo-action" type="button" onClick={() => void verify("demo")}>
                  Try the clearly labeled demo campaign
                </button>
              </div>
            </form>
            {error ? <p className="verify-error">{error}</p> : null}
            {campaign || demo ? (
              <div className="workspace-result">
                <CampaignLedger campaign={campaign ?? undefined} />
                <div className="claim-check">
                  <span className="check-ring">✓</span>
                  <p>{demo ? "Demo campaign loaded." : "Live campaign state loaded from Arc."}</p>
                  <small>
                    {demo
                      ? "Illustrative data only. No blockchain record was queried."
                      : "Funding, commitments, timing, and claim totals came directly from the configured contract."}
                  </small>
                </div>
              </div>
            ) : (
              <div className="empty-graph" aria-hidden="true">
                <span />
                <span />
                <span />
                <p>Campaign state will appear here</p>
              </div>
            )}
          </>
        ) : (
          <ClaimPacketPanel />
        )}
      </section>
    </main>
  );
}

function ClaimPacketPanel() {
  const [source, setSource] = useState("");
  const [packet, setPacket] = useState<ClaimPacket | null>(null);
  const [readiness, setReadiness] = useState<ClaimReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<Hash | null>(null);

  const inspect = async () => {
    setLoading(true);
    setError(null);
    setPacket(null);
    setReadiness(null);
    setTransactionHash(null);
    try {
      const parsed = parseClaimPacketJson(source);
      setPacket(parsed);
      setReadiness(await inspectClaimPacket(parsed));
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setLoading(false);
    }
  };

  const claim = async () => {
    if (!packet) return;
    const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    if (!provider) {
      setError("Install or open an EVM wallet to submit this claim.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      setTransactionHash(await submitClaimPacket(packet, provider));
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const ready =
    readiness?.proofValid === true &&
    readiness.alreadyClaimed === false &&
    readiness.claimOpen === true;

  return (
    <div className="claim-packet-panel">
      <div className="packet-input">
        <label htmlFor="claim-packet">Claim packet JSON</label>
        <textarea
          id="claim-packet"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder={'{"schemaVersion":1,"campaignId":"0x...","index":0,...}'}
        />
        <p>
          This packet contains a bearer secret. It stays in your browser and should not be shared
          publicly.
        </p>
        <button className="button button-primary" onClick={() => void inspect()} disabled={loading}>
          {loading ? "Checking Arc..." : "Check packet on Arc"} <Arrow />
        </button>
      </div>
      <div className="packet-result">
        {error ? <p className="verify-error">{error}</p> : null}
        {readiness && packet ? (
          <>
            <p className="packet-campaign">{readiness.campaign.organizationName}</p>
            <strong>{formatMoney(BigInt(packet.amount))} USDC</strong>
            <dl>
              <div>
                <dt>Merkle proof</dt>
                <dd className={readiness.proofValid ? "good" : "bad"}>
                  {readiness.proofValid ? "Matches root" : "Invalid"}
                </dd>
              </div>
              <div>
                <dt>Claim status</dt>
                <dd className={readiness.alreadyClaimed ? "bad" : "good"}>
                  {readiness.alreadyClaimed ? "Already paid" : "Unclaimed"}
                </dd>
              </div>
              <div>
                <dt>Claim window</dt>
                <dd className={readiness.claimOpen ? "good" : "bad"}>
                  {readiness.claimOpen ? "Open" : "Closed"}
                </dd>
              </div>
            </dl>
            <button
              className="button button-primary full"
              onClick={() => void claim()}
              disabled={!ready || submitting}
            >
              {submitting ? "Waiting for Arc confirmation..." : "Connect wallet and claim"}
            </button>
            {transactionHash ? (
              <a
                className="transaction-link"
                href={transactionExplorerUrl(transactionHash)}
                target="_blank"
                rel="noreferrer"
              >
                Claim confirmed. View on ArcScan <Arrow />
              </a>
            ) : null}
          </>
        ) : (
          <div className="packet-empty">
            <span />
            <p>Packet checks will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}

function OrganizerWorkspace({ onClose }: { onClose: () => void }) {
  const [domain, setDomain] = useState("your-company.example");
  const [displayName, setDisplayName] = useState("Your organization");
  const [campaignReference, setCampaignReference] = useState("refund-2026-001");
  const [policy, setPolicy] = useState("Recipients listed in the approved refund allocation.");
  const [notice, setNotice] = useState("Claims remain open for 30 days after funding.");
  const [csv, setCsv] = useState(sampleCsv);
  const [preparedCampaign, setPreparedCampaign] = useState<PreparedCampaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const [fundingTransaction, setFundingTransaction] = useState<Hash | null>(null);
  const [domainChallenge, setDomainChallenge] = useState<DomainChallenge | null>(null);
  const [domainAttestation, setDomainAttestation] = useState<OrganizationAttestation | null>(null);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [registrationTransaction, setRegistrationTransaction] = useState<Hash | null>(null);
  const preview = useMemo(() => {
    try {
      return parseAllocationCsv(csv);
    } catch {
      return [];
    }
  }, [csv]);

  const generate = () => {
    try {
      const organizationId = organizationIdFor(domain);
      const reference = campaignReferenceFor(campaignReference);
      const campaignId = campaignIdFor(organizationId, reference);
      const distribution = generateDistribution(campaignId, parseAllocationCsv(csv));
      const policyDocument = { policy };
      const noticeDocument = { notice };
      const metadata = {
        schemaVersion: 1,
        campaignReference,
        recipientCount: distribution.recipientCount,
      };
      const now = BigInt(Math.floor(Date.now() / 1000));
      const request: FundedCampaignRequest = {
        organizationId,
        campaignReference: reference,
        merkleRoot: distribution.merkleRoot,
        policyHash: hashJson(policyDocument),
        metadataHash: hashJson(metadata),
        noticeHash: hashJson(noticeDocument),
        supersedesCampaignId: `0x${"0".repeat(64)}`,
        totalAmount: distribution.totalAmount,
        opensAt: now + 3_600n,
        closesAt: now + 30n * 86_400n,
        recipientCount: distribution.recipientCount,
      };
      setPreparedCampaign({
        distribution,
        request,
        publicManifest: {
          schemaVersion: 1,
          network: arcTestnet.name,
          chainId: arcTestnet.id,
          contractAddress: campaignContractAddress(),
          organizationDomain: domain.trim().toLowerCase().replace(/\.$/, ""),
          organizationId,
          organizationDisplayName: displayName,
          campaignReference,
          campaignReferenceHash: reference,
          campaignId,
          merkleRoot: distribution.merkleRoot,
          totalAmount: distribution.totalAmount.toString(),
          recipientCount: distribution.recipientCount,
          policyDocument,
          policyHash: request.policyHash,
          noticeDocument,
          noticeHash: request.noticeHash,
          metadata,
          metadataHash: request.metadataHash,
          supersedesCampaignId: request.supersedesCampaignId,
          opensAt: request.opensAt.toString(),
          opensAtIso: new Date(Number(request.opensAt) * 1000).toISOString(),
          closesAt: request.closesAt.toString(),
          closesAtIso: new Date(Number(request.closesAt) * 1000).toISOString(),
        },
      });
      setError(null);
    } catch (cause) {
      setPreparedCampaign(null);
      setError(cause instanceof Error ? cause.message : "Could not validate allocation");
    }
  };

  const startDomainVerification = async () => {
    const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    if (!provider) {
      setError("Install or open an EVM wallet to verify an organization.");
      return;
    }
    setVerificationBusy(true);
    setError(null);
    setDomainChallenge(null);
    setDomainAttestation(null);
    setRegistrationTransaction(null);
    try {
      const admin = await selectedWalletAddress(provider);
      const challenge = await createDomainChallenge(domain, admin);
      setDomain(challenge.domain);
      invalidate();
      setDomainChallenge(challenge);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setVerificationBusy(false);
    }
  };

  const checkDomainVerification = async () => {
    if (!domainChallenge) return;
    setVerificationBusy(true);
    setError(null);
    try {
      setDomainAttestation(await verifyDomainChallenge(domainChallenge.id));
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setVerificationBusy(false);
    }
  };

  const registerOrganization = async () => {
    if (!domainAttestation || !domainChallenge) return;
    const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    if (!provider) {
      setError("Install or open the wallet that requested this attestation.");
      return;
    }
    setVerificationBusy(true);
    setError(null);
    try {
      setRegistrationTransaction(
        await submitOrganizationRegistration(
          domainChallenge.domain,
          displayName,
          domainAttestation,
          provider,
        ),
      );
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setVerificationBusy(false);
    }
  };

  const fund = async () => {
    if (!preparedCampaign) return;
    const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    if (!provider) {
      setError("Install or open an EVM wallet to fund this campaign.");
      return;
    }
    setFunding(true);
    setError(null);
    setFundingTransaction(null);
    try {
      if (BigInt(Math.floor(Date.now() / 1000)) >= preparedCampaign.request.opensAt) {
        throw new Error("The prepared opening time has passed. Generate the commitments again.");
      }
      if (
        campaignIdFor(
          preparedCampaign.request.organizationId,
          preparedCampaign.request.campaignReference,
        ) !== preparedCampaign.distribution.campaignId
      ) {
        throw new Error("Campaign details changed. Generate the commitments again.");
      }
      setFundingTransaction(await submitFundedCampaign(preparedCampaign.request, provider));
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setFunding(false);
    }
  };

  const invalidate = () => {
    setPreparedCampaign(null);
    setFundingTransaction(null);
    setError(null);
  };

  return (
    <main className="workspace">
      <WorkspaceHeader title="Organizer campaign builder" onClose={onClose} />
      <section className="workspace-body organizer-workspace">
        <div className="builder-heading">
          <div>
            <p className="eyebrow">
              <span>{"{"}</span> Local allocation builder <span>{"}"}</span>
            </p>
            <h1>Prepare the private allocation.</h1>
            <p>Recipient data and claim secrets stay in this browser.</p>
          </div>
          <ol>
            <li className="active">Allocations</li>
            <li>Commitments</li>
            <li>Fund</li>
            <li>Distribute</li>
          </ol>
        </div>
        <div className="organization-onboarding">
          <div>
            <span className="section-kicker">Organization identity</span>
            <h2>Verify the domain before funding.</h2>
            <p>
              A one-time DNS record proves control of the organization domain. The connected wallet
              becomes its first authorized issuer and reclaim address.
            </p>
          </div>
          <div className="onboarding-action">
            {!domainChallenge ? (
              <button
                className="button button-primary full"
                onClick={() => void startDomainVerification()}
                disabled={verificationBusy}
              >
                {verificationBusy ? "Connecting..." : "Connect wallet and request DNS challenge"}
              </button>
            ) : (
              <>
                <dl>
                  <div>
                    <dt>TXT name</dt>
                    <dd>
                      <code>{domainChallenge.dnsName}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>TXT value</dt>
                    <dd>
                      <code>{domainChallenge.dnsValue}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>{new Date(domainChallenge.expiresAt).toLocaleTimeString()}</dd>
                  </div>
                </dl>
                {!domainAttestation ? (
                  <button
                    className="button button-primary full"
                    onClick={() => void checkDomainVerification()}
                    disabled={verificationBusy}
                  >
                    {verificationBusy ? "Checking DNS..." : "Check DNS and issue attestation"}
                  </button>
                ) : (
                  <button
                    className="button button-primary full"
                    onClick={() => void registerOrganization()}
                    disabled={verificationBusy || registrationTransaction !== null}
                  >
                    {registrationTransaction
                      ? "Organization confirmed"
                      : verificationBusy
                        ? "Waiting for Arc confirmation..."
                        : "Register organization on Arc"}
                  </button>
                )}
                {registrationTransaction ? (
                  <a
                    className="transaction-link"
                    href={transactionExplorerUrl(registrationTransaction)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Registration confirmed. View on ArcScan <Arrow />
                  </a>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="campaign-details">
          <label>
            Organization name
            <input
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
                invalidate();
              }}
            />
          </label>
          <label>
            Organization domain
            <input
              value={domain}
              onChange={(event) => {
                setDomain(event.target.value);
                setDomainChallenge(null);
                setDomainAttestation(null);
                setRegistrationTransaction(null);
                invalidate();
              }}
            />
          </label>
          <label>
            Campaign reference
            <input
              value={campaignReference}
              onChange={(event) => {
                setCampaignReference(event.target.value);
                invalidate();
              }}
            />
          </label>
          <label>
            Eligibility policy
            <input
              value={policy}
              onChange={(event) => {
                setPolicy(event.target.value);
                invalidate();
              }}
            />
          </label>
          <label>
            Recipient notice
            <input
              value={notice}
              onChange={(event) => {
                setNotice(event.target.value);
                invalidate();
              }}
            />
          </label>
        </div>
        <div className="builder-grid">
          <div className="csv-editor">
            <label htmlFor="allocation">Allocation CSV · sample testnet values</label>
            <textarea
              id="allocation"
              value={csv}
              onChange={(event) => {
                setCsv(event.target.value);
                invalidate();
              }}
            />
            <div className="privacy-line">
              <span>Local browser</span>
              <i />
              <span>Merkle root</span>
              <i />
              <span>Arc</span>
            </div>
          </div>
          <div className="allocation-preview">
            <div className="preview-header">
              <span>Validated preview</span>
              <b>{preview.length} rows</b>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Contact</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 5).map((row) => (
                  <tr key={row.reference}>
                    <td>{row.reference}</td>
                    <td>{maskContact(row.contact ?? "")}</td>
                    <td>{row.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preparedCampaign ? (
              <>
                <div className="distribution-summary">
                  <span>{preparedCampaign.distribution.recipientCount} recipients</span>
                  <strong>{formatMoney(preparedCampaign.distribution.totalAmount)} USDC</strong>
                  <code>{preparedCampaign.distribution.merkleRoot.slice(0, 20)}...</code>
                </div>
                <div className="export-actions">
                  <button
                    onClick={() =>
                      downloadJson(
                        "dueback-public-campaign-manifest.json",
                        preparedCampaign.publicManifest,
                      )
                    }
                  >
                    Download public commitments
                  </button>
                  <button
                    onClick={() =>
                      downloadJson("dueback-private-claim-packets.json", {
                        schemaVersion: 1,
                        campaignId: preparedCampaign.distribution.campaignId,
                        claims: preparedCampaign.distribution.claims,
                      })
                    }
                  >
                    Export private claim packets
                  </button>
                </div>
                <div className="funding-action">
                  <p>
                    Your wallet must be an authorized issuer for <b>{domain}</b>. Funding locks the
                    exact total on Arc.
                  </p>
                  <button
                    className="button button-primary full"
                    onClick={() => void fund()}
                    disabled={funding}
                  >
                    {funding
                      ? "Waiting for Arc confirmation..."
                      : `Connect wallet and fund ${formatMoney(
                          preparedCampaign.distribution.totalAmount,
                        )} USDC`}
                  </button>
                  {fundingTransaction ? (
                    <a
                      className="transaction-link"
                      href={transactionExplorerUrl(fundingTransaction)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Campaign confirmed. View on ArcScan <Arrow />
                    </a>
                  ) : null}
                </div>
              </>
            ) : null}
            {error ? <p className="form-error">{error}</p> : null}
            <button className="button button-primary full" onClick={generate}>
              Generate commitments <Arrow />
            </button>
          </div>
        </div>
        <p className="bearer-warning">
          Claim packets are bearer credentials. Deliver them only through an authenticated channel.
        </p>
      </section>
    </main>
  );
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function maskContact(contact: string): string {
  const [name, domain] = contact.split("@");
  if (!name || !domain) return contact;
  return `${name.slice(0, 1)}•••@${domain}`;
}

function formatMoney(value: bigint): string {
  const formatted = formatArcAmount(value);
  const [whole, fraction = ""] = formatted.split(".");
  return `${BigInt(whole ?? "0").toLocaleString("en-US")}.${fraction.padEnd(2, "0")}`;
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
