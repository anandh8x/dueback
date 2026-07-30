import type { IncomingMessage, ServerResponse } from "node:http";
import {
  VerificationError,
  challengeSecret,
  createChallenge,
  readJSONBody,
  sendJSON,
} from "../../_lib/verifier.js";

export default function handler(
  request: IncomingMessage & { body?: unknown },
  response: ServerResponse,
): void {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJSON(response, 405, { error: "method not allowed" });
    return;
  }
  try {
    const body = readJSONBody(request);
    sendJSON(
      response,
      201,
      createChallenge(body.domain, body.admin, { challengeSecret: challengeSecret() }),
    );
  } catch (cause) {
    const status = cause instanceof VerificationError ? cause.status : 500;
    const message = cause instanceof Error ? cause.message : "could not create DNS challenge";
    sendJSON(response, status, { error: status === 500 ? "verifier is not configured" : message });
  }
}
