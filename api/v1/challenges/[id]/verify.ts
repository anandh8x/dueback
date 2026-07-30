import type { IncomingMessage, ServerResponse } from "node:http";
import {
  VerificationError,
  runtimeConfig,
  sendJSON,
  verifyChallenge,
} from "../../../_lib/verifier.js";

export default async function handler(
  request: IncomingMessage & { query?: Record<string, string | string[]> },
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJSON(response, 405, { error: "method not allowed" });
    return;
  }
  const value = request.query?.id;
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) {
    sendJSON(response, 400, { error: "verification challenge is required" });
    return;
  }
  try {
    sendJSON(response, 200, await verifyChallenge(id, runtimeConfig()));
  } catch (cause) {
    const status = cause instanceof VerificationError ? cause.status : 500;
    const message = cause instanceof Error ? cause.message : "could not verify domain";
    sendJSON(response, status, {
      error: status === 500 ? "could not verify and sign this domain" : message,
    });
  }
}
