import { describe, expect, it } from "vitest";
import { CONSENT_MAX_AGE_MS, ConsentError, consumeConsentToken, issueConsentToken, SOFT_PULL_CONSENT_VERSION } from "@/lib/consent";

const APPROVAL = { softPullAuthorized: true, textVersion: SOFT_PULL_CONSENT_VERSION };

function rejectionKind(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConsentError);
    return (err as ConsentError).kind;
  }
  throw new Error("expected a ConsentError");
}

describe("issueConsentToken", () => {
  it("issues a token only for an explicit approval of the current text", () => {
    expect(issueConsentToken(APPROVAL).consentToken).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(rejectionKind(() => issueConsentToken({}))).toBe("missing");
    expect(rejectionKind(() => issueConsentToken({ softPullAuthorized: "true", textVersion: SOFT_PULL_CONSENT_VERSION }))).toBe("missing");
    expect(rejectionKind(() => issueConsentToken({ softPullAuthorized: true, textVersion: "soft-pull-v0" }))).toBe("wrong_version");
  });

  it("stamps the server's clock and ignores any client-supplied time", () => {
    const serverNow = Date.UTC(2026, 9, 24, 12);
    const { consentToken, expiresAt } = issueConsentToken({ ...APPROVAL, consentedAt: "2020-01-01T00:00:00Z", iat: 1 }, serverNow);
    expect(expiresAt).toBe(new Date(serverNow + CONSENT_MAX_AGE_MS).toISOString());
    expect(consumeConsentToken(consentToken, {}, serverNow + 1000).issuedAt).toBe(serverNow);
  });
});

describe("consumeConsentToken", () => {
  it("accepts a fresh token once and keeps request context server-side", () => {
    const { consentToken } = issueConsentToken(APPROVAL);
    const consent = consumeConsentToken(consentToken, { ipAddress: "203.0.113.9", userAgent: "x".repeat(400) });
    expect(consent.version).toBe(SOFT_PULL_CONSENT_VERSION);
    expect(consent.ipAddress).toBe("203.0.113.9");
    expect(consent.userAgent).toHaveLength(256);
    expect(rejectionKind(() => consumeConsentToken(consentToken))).toBe("replayed");
  });

  it("rejects missing, malformed, and tampered tokens", () => {
    expect(rejectionKind(() => consumeConsentToken(undefined))).toBe("missing");
    expect(rejectionKind(() => consumeConsentToken(""))).toBe("missing");
    expect(rejectionKind(() => consumeConsentToken("not-a-token"))).toBe("malformed");
    expect(rejectionKind(() => consumeConsentToken("a.b.c"))).toBe("malformed");
    const { consentToken } = issueConsentToken(APPROVAL);
    const [payload, signature] = consentToken.split(".");
    const forged = Buffer.from(JSON.stringify({ v: SOFT_PULL_CONSENT_VERSION, iat: Date.now(), jti: "forged" })).toString("base64url");
    expect(rejectionKind(() => consumeConsentToken(`${forged}.${signature}`))).toBe("bad_signature");
    expect(rejectionKind(() => consumeConsentToken(`${payload}.${signature.slice(0, -2)}xx`))).toBe("bad_signature");
  });

  it("rejects expired tokens and tokens from the future by the server clock", () => {
    const issuedAt = Date.UTC(2026, 9, 24, 12);
    const stale = issueConsentToken(APPROVAL, issuedAt).consentToken;
    expect(rejectionKind(() => consumeConsentToken(stale, {}, issuedAt + CONSENT_MAX_AGE_MS + 1))).toBe("expired");
    const future = issueConsentToken(APPROVAL, issuedAt + 60_000).consentToken;
    expect(rejectionKind(() => consumeConsentToken(future, {}, issuedAt))).toBe("future");
  });
});
