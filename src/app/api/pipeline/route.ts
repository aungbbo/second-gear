import { NextRequest, NextResponse } from "next/server";
import { analyzeCars } from "@/lib/analysis";
import { pullSoftCredit } from "@/lib/providers/crs";
import { analyzeCashFlow } from "@/lib/providers/nessie";
import { searchLiveListings } from "@/lib/providers/apify";
import { explainAndRank } from "@/lib/providers/bitdeer";
import { ApifyError, type ApifyErrorKind } from "@/lib/apify/errors";
import type { BuyerNeed, PipelineResult } from "@/lib/types";

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
};

export async function POST(req: NextRequest) {
  let need: BuyerNeed;
  try {
    const body = await req.json();
    need = normalizeNeed(body?.need);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!need.description || need.maxMonthlyPayment <= 0) {
    return NextResponse.json({ error: "A description and monthly budget are required." }, { status: 400 });
  }

  try {
    // Step 1: consent + soft credit pull.
    const credit = await pullSoftCredit(need);

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
    console.error("Pipeline failure", err instanceof ApifyError ? `${err.name}[${err.kind}]: ${err.message}` : err);
    if (err instanceof ApifyError) {
      return NextResponse.json({ error: err.userMessage }, { status: APIFY_ERROR_STATUS[err.kind] });
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
