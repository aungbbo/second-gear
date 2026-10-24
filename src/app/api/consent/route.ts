import { NextRequest, NextResponse } from "next/server";
import { assertConsentRuntime, ConsentError, issueConsentToken } from "@/lib/consent";
import { ConsentConfigurationError, ConsentStorageError } from "@/lib/consent-store";
import { assertRequestOrigin, getRequestIdentity, OriginConfigurationError } from "@/lib/request-identity";
import { createSession, getSessionId, hasSessionCookie, setSessionCookie } from "@/lib/session";
import { enforceRateLimits, RateLimitError } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/monitoring";

/**
 * Records the buyer's approval of a soft credit check and returns a
 * short-lived, single-use token stamped with the server's clock. The pipeline
 * refuses to run without one.
 */
export async function POST(req: NextRequest) {
  try {
    assertRequestOrigin(req);
  } catch (err) {
    if (err instanceof OriginConfigurationError) return NextResponse.json({ error: err.userMessage }, { status: 503 });
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  if (hasSessionCookie(req) && !getSessionId(req)) return NextResponse.json({ error: "A valid session is required." }, { status: 400 });
  const session = getSessionId(req) ? { id: getSessionId(req)!, value: undefined } : createSession();
  const identity = getRequestIdentity(req);
  try {
    await enforceRateLimits("consent-ip", [identity.ipKey]);
    await enforceRateLimits("consent-session", [session.id]);
    await enforceRateLimits("consent-global", ["global"]);
  } catch (err) {
    if (err instanceof RateLimitError) return NextResponse.json({ error: err.userMessage }, { status: 429, headers: { "retry-after": String(err.retryAfterSeconds) } });
    if (err instanceof ConsentConfigurationError || err instanceof ConsentStorageError) return NextResponse.json({ error: err.userMessage }, { status: 503 });
    throw err;
  }
  recordSecurityEvent("consent_request");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  try {
    assertConsentRuntime();
    const response = NextResponse.json(issueConsentToken(body, Date.now(), session.id), { headers: { "cache-control": "no-store" } });
    if (session.value) setSessionCookie(response, session.value);
    return response;
  } catch (err) {
    if (err instanceof ConsentError) return NextResponse.json({ error: err.userMessage }, { status: 400 });
    if (err instanceof ConsentConfigurationError || err instanceof ConsentStorageError) {
      return NextResponse.json({ error: err.userMessage }, { status: 503 });
    }
    throw err;
  }
}
