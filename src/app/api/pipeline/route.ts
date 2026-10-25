import { NextRequest, NextResponse } from "next/server";
import { analyzeCars } from "@/lib/analysis";
import { pullSoftCredit } from "@/lib/providers/crs";
import { analyzeCashFlow } from "@/lib/providers/nessie";
import { searchLiveListings } from "@/lib/providers/apify";
import { explainAndRank } from "@/lib/providers/bitdeer";
import { ConsentError, consumeConsentToken, type VerifiedConsent } from "@/lib/consent";
import { ConsentConfigurationError, ConsentStorageError } from "@/lib/consent-store";
import { assertLiveCrsRequest } from "@/lib/crs/guard";
import { CrsError, type CrsErrorKind } from "@/lib/crs/errors";
import { NessieError, NESSIE_ERROR_STATUS } from "@/lib/nessie/errors";
import { ApifyError, type ApifyErrorKind } from "@/lib/apify/errors";
import type { BuyerNeed, PipelineResult } from "@/lib/types";
import { assertRequestOrigin, getRequestIdentity, OriginConfigurationError } from "@/lib/request-identity";
import { getSessionId } from "@/lib/session";
import { enforceRateLimits, RateLimitError } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/monitoring";
import { assessAffordability } from "@/lib/affordability/assessment";
import { buildAffordableSearchConstraints } from "@/lib/affordability/constraints";

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
  empty_result: 503,
  missing_make: 422,
  no_affordable_price: 422,
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
    assertLiveCrsRequest();
  } catch (err) {
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
    // Step 1: read the CRS report and banking aggregates for affordability and ranking.
    const credit = await pullSoftCredit(need, consent);
    const affordability = await analyzeCashFlow(need, credit);
    const affordabilityAssessment = assessAffordability(need, credit, affordability);
    const searchConstraints = buildAffordableSearchConstraints(need, affordabilityAssessment);

    // Step 2: search with the buyer's ZIP and selected sort order. The remaining
    // Actor fields are fixed by the app; Bitdeer is reserved for ranking results.
    const listings = await searchLiveListings(need, affordability, credit, { constraints: searchConstraints });

    // Step 4: true-cost loan comparison (plain code).
    const analyses = analyzeCars(listings, affordability, credit, need, affordabilityAssessment);

    // Step 5: explain, rank, build dealer packet.
    const { rankedCars, dealerPacket, savingsHighlight, rankingSource } = await explainAndRank({
      need,
      credit,
      affordability,
      assessment: affordabilityAssessment,
      analyses,
    });

    const result: PipelineResult = {
      need,
      credit,
      affordability,
      affordabilityAssessment,
      searchConstraints,
      listings,
      rankedCars,
      dealerPacket,
      savingsHighlight,
      rankingSource,
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
    searchSortBy: normalizeSortBy(input.searchSortBy),
    ownershipCostOverrides: normalizeOwnershipCostOverrides(input.ownershipCostOverrides),
    searchPreferences: normalizeSearchPreferences(input.searchPreferences),
  };
}

function normalizeSortBy(value: unknown): BuyerNeed["searchSortBy"] {
  const allowed: NonNullable<BuyerNeed["searchSortBy"]>[] = ["deal_score", "price_asc", "price_desc", "mileage_asc", "year_desc", "distance"];
  return typeof value === "string" && allowed.includes(value as NonNullable<BuyerNeed["searchSortBy"]>)
    ? value as NonNullable<BuyerNeed["searchSortBy"]>
    : "deal_score";
}

function normalizeOwnershipCostOverrides(raw: unknown) {
  const input = (raw ?? {}) as Record<string, unknown>;
  const result = {
    insuranceMonthly: optionalMoney(input.insuranceMonthly),
    fuelMonthly: optionalMoney(input.fuelMonthly),
    maintenanceMonthly: optionalMoney(input.maintenanceMonthly),
    registrationAndTaxesMonthly: optionalMoney(input.registrationAndTaxesMonthly),
    otherMonthly: optionalMoney(input.otherMonthly),
    dealerFees: optionalMoney(input.dealerFees),
  };
  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
}

function normalizeSearchPreferences(raw: unknown) {
  const input = (raw ?? {}) as Record<string, unknown>;
  const vehicleTypes = Array.isArray(input.vehicleTypes)
    ? input.vehicleTypes
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 8)
    : undefined;
  const result = {
    radiusMiles: optionalInteger(input.radiusMiles, 1, 500),
    maxMileage: optionalInteger(input.maxMileage, 0, 500000),
    minYear: optionalInteger(input.minYear, 1900, new Date().getFullYear() + 1),
    vehicleTypes,
  };
  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
}

function optionalMoney(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100000 ? value : undefined;
}

function optionalInteger(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}
