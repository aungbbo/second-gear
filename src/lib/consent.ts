import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Server-issued consent for a soft credit pull.
 *
 * The browser never supplies a timestamp: when the buyer approves, the server
 * mints a short-lived token stamped with its own clock and signs it. The
 * pipeline accepts a credit request only with a valid, unexpired, unused token
 * for the current consent text.
 */

export const SOFT_PULL_CONSENT_VERSION = "soft-pull-v1";
export const CONSENT_MAX_AGE_MS = 15 * 60 * 1000;
/** Tolerated clock skew for tokens stamped slightly "in the future". */
const MAX_FUTURE_SKEW_MS = 5 * 1000;

export type ConsentErrorKind = "missing" | "malformed" | "bad_signature" | "wrong_version" | "expired" | "future" | "replayed";

export class ConsentError extends Error {
  readonly kind: ConsentErrorKind;
  readonly userMessage = "Consent to a soft credit check is required.";

  constructor(kind: ConsentErrorKind) {
    super(`Consent rejected: ${kind}`);
    this.name = "ConsentError";
    this.kind = kind;
  }
}

/** What the credit step receives once consent is verified. Never sent to the browser. */
export interface VerifiedConsent {
  version: string;
  /** Server clock, ms since epoch. */
  issuedAt: number;
  ipAddress?: string;
  userAgent?: string;
}

interface ConsentPayload {
  v: string;
  iat: number;
  jti: string;
}

// Kept on globalThis so dev-server module reloads don't invalidate live tokens.
const store = globalThis as typeof globalThis & {
  __secondGearConsent?: { secret: Buffer; used: Map<string, number> };
};

function state() {
  if (!store.__secondGearConsent) {
    const configured = process.env.CONSENT_SIGNING_SECRET;
    store.__secondGearConsent = {
      secret: configured && configured.length >= 32 ? Buffer.from(configured) : randomBytes(32),
      used: new Map(),
    };
  }
  return store.__secondGearConsent;
}

const b64url = (buf: Buffer) => buf.toString("base64url");
const sign = (payload: string) => b64url(createHmac("sha256", state().secret).update(payload).digest());

/**
 * Mints a consent token after validating the buyer's approval. Only the
 * consent flag and text version come from the client; the time is the server's.
 */
export function issueConsentToken(body: unknown, now: number = Date.now()): { consentToken: string; expiresAt: string } {
  const input = (body ?? {}) as { softPullAuthorized?: unknown; textVersion?: unknown };
  if (input.softPullAuthorized !== true) throw new ConsentError("missing");
  if (input.textVersion !== SOFT_PULL_CONSENT_VERSION) throw new ConsentError("wrong_version");

  const payload: ConsentPayload = { v: SOFT_PULL_CONSENT_VERSION, iat: now, jti: randomBytes(16).toString("hex") };
  const encoded = b64url(Buffer.from(JSON.stringify(payload)));
  return { consentToken: `${encoded}.${sign(encoded)}`, expiresAt: new Date(now + CONSENT_MAX_AGE_MS).toISOString() };
}

/**
 * Verifies and consumes a consent token: signature, current text version,
 * freshness by the server clock, and single use.
 */
export function consumeConsentToken(
  token: unknown,
  context: { ipAddress?: string; userAgent?: string } = {},
  now: number = Date.now(),
): VerifiedConsent {
  if (typeof token !== "string" || token.length === 0) throw new ConsentError("missing");
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra !== undefined) throw new ConsentError("malformed");

  const expected = Buffer.from(sign(encoded));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ConsentError("bad_signature");

  let payload: ConsentPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new ConsentError("malformed");
  }
  if (typeof payload?.iat !== "number" || typeof payload.jti !== "string") throw new ConsentError("malformed");
  if (payload.v !== SOFT_PULL_CONSENT_VERSION) throw new ConsentError("wrong_version");
  if (payload.iat > now + MAX_FUTURE_SKEW_MS) throw new ConsentError("future");
  if (now - payload.iat > CONSENT_MAX_AGE_MS) throw new ConsentError("expired");

  const { used } = state();
  for (const [jti, expiry] of used) if (expiry < now) used.delete(jti);
  if (used.has(payload.jti)) throw new ConsentError("replayed");
  used.set(payload.jti, payload.iat + CONSENT_MAX_AGE_MS);

  return {
    version: payload.v,
    issuedAt: payload.iat,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent?.slice(0, 256),
  };
}
