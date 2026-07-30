const contractErrors: ReadonlyArray<readonly [string, string]> = [
  ["CampaignNotFound", "No DueBack campaign was found for that ID on Arc."],
  [
    "UnauthorizedIssuer",
    "This wallet is not authorized to create campaigns for that organization.",
  ],
  ["OrganizationAlreadyExists", "That domain is already registered on DueBack."],
  ["OrganizationInactive", "That organization is not currently active."],
  ["DomainVerificationExpired", "The domain verification has expired. Verify the domain again."],
  ["InvalidAttestation", "The domain attestation is invalid or has expired."],
  ["CampaignAlreadyExists", "That campaign reference has already been used."],
  ["IncorrectFunding", "Fund the campaign with exactly the displayed total."],
  ["ClaimAlreadyPaid", "This claim has already been paid."],
  ["CampaignNotOpen", "This campaign is not open yet."],
  ["CampaignClosed", "This campaign is closed."],
  ["InvalidClaim", "This claim packet does not match the campaign commitment."],
];

export function readableError(cause: unknown): string {
  if (!(cause instanceof Error)) return "Something went wrong while contacting Arc.";

  if (/request limit|rate limit|too many requests|status\s*429/i.test(cause.message)) {
    return "Arc Testnet RPC is temporarily busy. Wait a moment and try again.";
  }

  if (/networkerror|failed to fetch|network request failed/i.test(cause.message)) {
    return "Could not reach the domain verifier. Check that it is running and try again.";
  }

  for (const [contractError, message] of contractErrors) {
    if (cause.message.includes(contractError)) return message;
  }

  if (cause.message.includes("execution reverted")) {
    return "Arc rejected this transaction. Check the wallet permissions and campaign details.";
  }

  return cause.message;
}
