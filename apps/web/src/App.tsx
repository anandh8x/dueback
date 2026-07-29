import { useMemo, useState } from "react";
import {
  campaignIdFor,
  campaignReferenceFor,
  createDeterministicRandomSource,
  formatArcAmount,
  generateDistribution,
  organizationIdFor,
  parseAllocationCsv,
  type GeneratedDistribution,
} from "@dueback/protocol";

type View = "home" | "verify" | "organize";

const sampleCampaignId = `0x${"9f3a".padEnd(64, "7b2c")}`;
const sampleRoot = `0x${"7b14".padEnd(64, "6f2d")}`;
const sampleCsv = `reference,amount,contact
REF-0001,196.40,alex@example.com
REF-0002,85.00,jules@example.com
REF-0003,241.60,sam@example.com`;

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

function CampaignLedger() {
  return (
    <div className="campaign-ledger">
      <div className="ledger-topline">
        <span className="status-dot" />
        Fully funded · claims open
      </div>
      <h3>Spring membership refunds</h3>
      <p>Community Refunds Foundation · communityrefunds.org</p>
      <div className="ledger-values">
        <div>
          <span>Total committed</span>
          <b>$125,000.00</b>
        </div>
        <div>
          <span>Total claimed</span>
          <b>$82,314.60</b>
        </div>
        <div>
          <span>Remaining</span>
          <b>$42,685.40</b>
        </div>
      </div>
      <div className="ledger-progress">
        <i />
      </div>
      <div className="ledger-code">
        <span>Immutable root</span>
        <code>
          {sampleRoot.slice(0, 18)}...{sampleRoot.slice(-8)}
        </code>
      </div>
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
  const [query, setQuery] = useState("");
  const [verified, setVerified] = useState(false);

  return (
    <main className="workspace">
      <WorkspaceHeader title="Public campaign verifier" onClose={onClose} />
      <section className="workspace-body verify-workspace">
        <p className="eyebrow">
          <span>{"{"}</span> Read-only · sourced from Arc <span>{"}"}</span>
        </p>
        <h1>Verify before you claim.</h1>
        <form
          className="verify-form"
          onSubmit={(event) => {
            event.preventDefault();
            setVerified(true);
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
            <button type="submit">Verify</button>
          </div>
        </form>
        {verified ? (
          <div className="workspace-result">
            <CampaignLedger />
            <div className="claim-check">
              <span className="check-ring">✓</span>
              <p>Your campaign record checks out.</p>
              <small>Contract state, funding, root, and claim totals were read from Arc.</small>
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
      </section>
    </main>
  );
}

function OrganizerWorkspace({ onClose }: { onClose: () => void }) {
  const [csv, setCsv] = useState(sampleCsv);
  const [distribution, setDistribution] = useState<GeneratedDistribution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => {
    try {
      return parseAllocationCsv(csv);
    } catch {
      return [];
    }
  }, [csv]);

  const generate = () => {
    try {
      const organizationId = organizationIdFor("communityrefunds.org");
      const reference = campaignReferenceFor("spring-membership-refunds");
      const campaignId = campaignIdFor(organizationId, reference);
      setDistribution(
        generateDistribution(
          campaignId,
          parseAllocationCsv(csv),
          createDeterministicRandomSource(),
        ),
      );
      setError(null);
    } catch (cause) {
      setDistribution(null);
      setError(cause instanceof Error ? cause.message : "Could not validate allocation");
    }
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
        <div className="builder-grid">
          <div className="csv-editor">
            <label htmlFor="allocation">Allocation CSV</label>
            <textarea
              id="allocation"
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
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
            {distribution ? (
              <div className="distribution-summary">
                <span>{distribution.recipientCount} recipients</span>
                <strong>{formatMoney(distribution.totalAmount)} USDC</strong>
                <code>{distribution.merkleRoot.slice(0, 20)}...</code>
              </div>
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
  return `${whole}.${fraction.padEnd(2, "0")}`;
}
