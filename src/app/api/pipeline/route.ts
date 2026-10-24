import { NextRequest, NextResponse } from "next/server";
import { analyzeCars } from "@/lib/analysis";
import { pullSoftCredit } from "@/lib/providers/crs";
import { analyzeCashFlow } from "@/lib/providers/nessie";
import { searchLiveListings } from "@/lib/providers/apify";
import { explainAndRank } from "@/lib/providers/bitdeer";
import { ConsentError, consumeConsentToken, type VerifiedConsent } from "@/lib/consent";
import { ConsentConfigurationError, ConsentStorageError } from "@/lib/consent-store";
import { assertLiveCrsRequest, LiveCrsAccessError } from "@/lib/crs/guard";
import { CrsError, type CrsErrorKind } from "@/lib/crs/errors";
import { NessieError, type NessieErrorKind } from "@/lib/nessie/errors";
import { ApifyError, type ApifyErrorKind } from "@/lib/apify/errors";
import type { BuyerNeed, PipelineResult } from "@/lib/types";
import { assertRequestOrigin, getRequestIdentity, OriginConfigurationError } from "@/lib/request-identity";
import { getSessionId } from "@/lib/session";
import { enforceRateLimits, RateLimitError } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/monitoring";

const NESSIE_ERROR_STATUS: Record<NessieErrorKind, number> = {
  config: 503,
  auth: 502,
  timeout: 502,
  upstream: 502,
  invalid_response: 502,
  not_found: 422,
  insufficient_data: 422,
};

const CRS_ERROR_STATUS: Record<CrsErrorKind, number> = {
  config: 503,
  auth: 502,
  rate_limited: 503,
  quota: 429,
  timeout: 502,
  upstream: 502,
  invalid_response: 502,
  bureau_error: 502,
  no_file: 422,
  frozen: 422,
  no_score: 422,
  not_soft_pull: 502,
};

// A live Apify Actor run can take up to APIFY_RUN_TIMEOUT_SECS (at most 300 s).
export const maxDuration = 300;

const APIFY_ERROR_STATUS: Record<ApifyErrorKind, number> = {
  config: 503,
  auth: 502,
  not_found: 502,
  quota: 503,
  rate_limited: 503,
  timeout: 504,
  upstream: 502,
  invalid_response: 502,
  no_listings: 422,
  budget: 429,
};

export async function POST(req: NextRequest) {
  try {
    assertRequestOrigin(req);
  } catch (err) {
    if (err instanceof OriginConfigurationError) return NextResponse.json({ error: err.userMessage }, { status: 503 });
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  try {
    assertLiveCrsRequest(req);
  } catch (err) {
    if (err instanceof LiveCrsAccessError) return NextResponse.json({ error: err.userMessage }, { status: 403 });
    if (err instanceof CrsError) return NextResponse.json({ error: err.userMessage }, { status: 503 });
    throw err;
  }
  const sessionId = getSessionId(req);
  if (!sessionId && process.env.NODE_ENV !== "test") return NextResponse.json({ error: "A valid session is required." }, { status: 400 });
  const identity = getRequestIdentity(req);
  try {
    await enforceRateLimits("pipeline-ip", [identity.ipKey]);
    if (sessionId) await enforceRateLimits("pipeline-session", [sessionId]);
    await enforceRateLimits("pipeline-global", ["global"]);
  } catch (err) {
    if (err instanceof RateLimitError) return NextResponse.json({ error: err.userMessage }, { status: 429, headers: { "retry-after": String(err.retryAfterSeconds) } });
    if (err instanceof ConsentConfigurationError || err instanceof ConsentStorageError) return NextResponse.json({ error: err.userMessage }, { status: 503 });
    throw err;
  }
  recordSecurityEvent("pipeline_request");
  let need: BuyerNeed;
  let consentToken: unknown;
  try {
    const body = await req.json();
    need = normalizeNeed(body?.need);
    consentToken = body?.consentToken;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Consent comes first: no provider runs without a fresh, server-issued, unused token.
  let consent: VerifiedConsent;
  try {
    consent = await consumeConsentToken(consentToken, { ipAddress: identity.trustedIp ? identity.ipKey : undefined, userAgent: req.headers.get("user-agent") ?? undefined }, Date.now(), undefined, sessionId);
    if (process.env.CRS_MODE?.trim().toLowerCase() === "live") consent.liveAccessAuthorized = true;
  } catch (err) {
    if (err instanceof ConsentError) return NextResponse.json({ error: err.userMessage }, { status: 400 });
    if (err instanceof ConsentConfigurationError || err instanceof ConsentStorageError) {
      return NextResponse.json({ error: err.userMessage }, { status: 503 });
    }
    throw err;
  }

  if (!need.description || need.maxMonthlyPayment <= 0) {
    return NextResponse.json({ error: "A description and monthly budget are required." }, { status: 400 });
  }

  try {
    // Step 1: soft credit pull, with the verified consent.
    const credit = await pullSoftCredit(need, consent);

    // Step 2: affordability from cash flow.
    const affordability = await analyzeCashFlow(need, credit);

    // Step 3: search live listings.
    const listings = await searchLiveListings(need, affordability, credit);

    // Step 4: true-cost loan comparison (plain code).
    const analyses = analyzeCars(listings, affordability, credit, need);

    // Step 5: explain, rank, build dealer packet.
    const { rankedCars, dealerPacket, savingsHighlight } = await explainAndRank({
      need,
      credit,
      affordability,
      analyses,
    });

    const result: PipelineResult = {
      need,
      credit,
      affordability,
      listings,
      rankedCars,
      dealerPacket,
      savingsHighlight,
    };

    return NextResponse.json(result);
  } catch (err) {
    const known =
      err instanceof NessieError || err instanceof CrsError || err instanceof ApifyError;
    console.error("Pipeline failure", known ? `${err.name}[${err.kind}]: ${err.message}` : err);
    if (err instanceof NessieError) {
      return NextResponse.json({ error: err.userMessage }, { status: NESSIE_ERROR_STATUS[err.kind] });
    }
    if (err instanceof CrsError) {
      const headers = err.retryAfterSeconds ? { "retry-after": String(err.retryAfterSeconds) } : undefined;
      return NextResponse.json({ error: err.userMessage }, { status: CRS_ERROR_STATUS[err.kind], headers });
    }
    if (err instanceof ApifyError) {
      const headers = err.retryAfterSeconds ? { "retry-after": String(err.retryAfterSeconds) } : undefined;
      return NextResponse.json({ error: err.userMessage }, { status: APIFY_ERROR_STATUS[err.kind], headers });
    }
    if (err instanceof LiveCrsAccessError) return NextResponse.json({ error: err.userMessage }, { status: 403 });
    if (err instanceof ConsentConfigurationError || err instanceof ConsentStorageError) {
      return NextResponse.json({ error: err.userMessage }, { status: 503 });
    }
    return NextResponse.json({ error: "The pipeline hit a snag. Try again." }, { status: 500 });
  }
}

function normalizeNeed(raw: unknown): BuyerNeed {
  const input = (raw ?? {}) as Partial<BuyerNeed>;
  return {
    description: typeof input.description === "string" ? input.description.trim().slice(0, 300) : "",
    maxMonthlyPayment: clampNumber(input.maxMonthlyPayment, 100, 2000, 400),
    timeframeWeeks: clampNumber(input.timeframeWeeks, 1, 26, 4),
    downPayment: clampNumber(input.downPayment, 0, 50000, 0),
    zip: typeof input.zip === "string" && /^\d{5}$/.test(input.zip) ? input.zip : "43215",
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}
