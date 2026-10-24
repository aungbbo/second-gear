import type {
  AffordabilityResult,
  BuyerNeed,
  CarAnalysis,
  CreditReport,
  DealerPacket,
  RankedCar,
  SavingsHighlight,
} from "@/lib/types";

interface ExplainAndRankInput {
  need: BuyerNeed;
  credit: CreditReport;
  affordability: AffordabilityResult;
  analyses: CarAnalysis[];
}

interface ExplainAndRankOutput {
  rankedCars: RankedCar[];
  dealerPacket: DealerPacket;
  savingsHighlight: SavingsHighlight;
}

const BITDEER_ENDPOINT = "https://api-inference.bitdeer.ai/v1/chat/completions";
const BITDEER_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";
const BITDEER_TIMEOUT_MS = 45000;

const SYSTEM_PROMPT = `You are Second Gear's car-shopping co-pilot for a buyer with subprime or thin credit.
You will receive the buyer's stated need, a plain-language credit summary, an affordability summary, and a
list of candidate cars with loan numbers that have already been computed by other code (price, APR, monthly
payment, total interest, whether it fits their budget, months of negative equity, and any cost warnings).

Ground every claim strictly in that provided data — never invent a price, rate, mileage, or fact that wasn't
given to you. Select and rank the 4 to 6 strongest options. Prioritize total interest cost and negative-equity
risk over a merely low monthly payment, and prefer options that fit within budget over ones that don't.

For each selected car, write a short 2-5 word headline and a 2-3 sentence explanation that cites its actual
numbers. Then write 4 short, concrete negotiation tips for the buyer to use at the dealership, grounded in
their specific credit tier, APR ceiling, and budget. Keep any internal reasoning brief — this is a simple
ranking task, not a complex one — and call submit_ranking promptly once you've decided. Respond only by
calling submit_ranking.`;

const RANKING_TOOL = {
  type: "function",
  function: {
    name: "submit_ranking",
    description: "Submit the ranked shortlist of cars with explanations and dealer negotiation tips.",
    parameters: {
      type: "object",
      properties: {
        rankedCars: {
          type: "array",
          items: {
            type: "object",
            properties: {
              listingId: { type: "string", description: "Must exactly match a candidate listingId provided." },
              headline: { type: "string", description: "2-5 word label, e.g. 'Best overall fit'." },
              explanation: { type: "string", description: "2-3 sentences grounded only in the provided numbers." },
            },
            required: ["listingId", "headline", "explanation"],
          },
        },
        negotiationTips: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["rankedCars", "negotiationTips"],
    },
  },
} as const;

/**
 * Step 5 — explain, rank, and draft the dealer packet. Calls Bitdeer AI
 * Model Studio (DeepSeek-V4.1-Flash) when BITDEER_API_KEY is configured;
 * falls back to a deterministic local scorer/template if the key is
 * missing or the live call fails for any reason, so the pipeline never
 * breaks on a flaky request.
 */
export async function explainAndRank(input: ExplainAndRankInput): Promise<ExplainAndRankOutput> {
  const { need, credit, affordability, analyses } = input;

  const scored = analyses.map((analysis) => ({
    analysis,
    matchScore: scoreCar(analysis, affordability),
  }));
  const sorted = [...scored].sort((a, b) => b.matchScore - a.matchScore);
  const candidates = sorted.slice(0, Math.min(8, sorted.length));

  const live = await callBitdeerRanking({ need, credit, affordability, candidates });

  let ranked: RankedCar[];
  let negotiationTips: string[] | undefined;

  if (live) {
    ranked = live.rankedCars;
    negotiationTips = live.negotiationTips.length > 0 ? live.negotiationTips : undefined;
  } else {
    await simulateLatency(300, 600);
    ranked = sorted.slice(0, Math.min(6, sorted.length)).map(({ analysis, matchScore }, index): RankedCar => {
      const rank = index + 1;
      return {
        ...analysis,
        rank,
        matchScore,
        headline: buildHeadline(analysis, rank, affordability),
        explanation: buildExplanation(analysis),
      };
    });
  }

  const dealerPacket = buildDealerPacket(need, credit, affordability, ranked, negotiationTips);
  const savingsHighlight = buildSavingsHighlight(ranked);

  return { rankedCars: ranked, dealerPacket, savingsHighlight };
}

interface ScoredCandidate {
  analysis: CarAnalysis;
  matchScore: number;
}

async function callBitdeerRanking(params: {
  need: BuyerNeed;
  credit: CreditReport;
  affordability: AffordabilityResult;
  candidates: ScoredCandidate[];
}): Promise<{ rankedCars: RankedCar[]; negotiationTips: string[] } | null> {
  const apiKey = process.env.BITDEER_API_KEY;
  if (!apiKey) return null;

  const { need, credit, affordability, candidates } = params;
  const byId = new Map(candidates.map((c) => [c.analysis.listing.id, c]));

  const userPayload = {
    need: {
      description: need.description,
      maxMonthlyPayment: need.maxMonthlyPayment,
      timeframeWeeks: need.timeframeWeeks,
    },
    credit: {
      score: credit.score,
      tierLabel: credit.tierLabel,
      estimatedApr: credit.estimatedApr,
    },
    affordability: {
      recommendedPayment: affordability.recommendedPayment,
      maxSustainablePayment: affordability.maxSustainablePayment,
    },
    candidates: candidates.map(({ analysis, matchScore }) => ({
      listingId: analysis.listing.id,
      year: analysis.listing.year,
      make: analysis.listing.make,
      model: analysis.listing.model,
      trim: analysis.listing.trim,
      price: analysis.listing.price,
      mileage: analysis.listing.mileage,
      reliabilityScore: analysis.listing.reliabilityScore,
      mpgCombined: analysis.listing.mpgCombined,
      bestTermMonths: analysis.bestScenario.termMonths,
      apr: analysis.bestScenario.apr,
      monthlyPayment: analysis.bestScenario.monthlyPayment,
      totalInterest: analysis.bestScenario.totalInterest,
      withinBudget: analysis.bestScenario.withinBudget,
      negativeEquityMonths: analysis.bestScenario.negativeEquityMonths,
      warnings: analysis.warnings,
      deterministicFitScore: matchScore,
    })),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BITDEER_TIMEOUT_MS);

  try {
    const res = await fetch(BITDEER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: BITDEER_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        tools: [RANKING_TOOL],
        tool_choice: { type: "function", function: { name: "submit_ranking" } },
        max_tokens: 8000,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`Bitdeer API error ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }

    const data = await res.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("Bitdeer response had no tool call:", JSON.stringify(data).slice(0, 500));
      return null;
    }

    let parsed: {
      rankedCars?: { listingId: string; headline: string; explanation: string }[];
      negotiationTips?: string[];
    };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      console.error("Bitdeer tool call arguments were not valid JSON:", toolCall.function.arguments);
      return null;
    }

    const rankedCars: RankedCar[] = [];
    for (const item of parsed.rankedCars ?? []) {
      const candidate = byId.get(item?.listingId);
      if (!candidate || !item.headline || !item.explanation) continue;
      rankedCars.push({
        ...candidate.analysis,
        rank: rankedCars.length + 1,
        matchScore: candidate.matchScore,
        headline: item.headline,
        explanation: item.explanation,
      });
    }

    if (rankedCars.length === 0) {
      console.error("Bitdeer response had no valid ranked cars");
      return null;
    }

    const negotiationTips = (parsed.negotiationTips ?? []).filter(
      (t): t is string => typeof t === "string" && t.length > 0,
    );

    return { rankedCars, negotiationTips };
  } catch (err) {
    console.error("Bitdeer call failed:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function scoreCar(analysis: CarAnalysis, affordability: AffordabilityResult): number {
  const { bestScenario, listing, warnings } = analysis;
  let score = 100;

  if (!bestScenario.withinBudget) {
    const overBy = bestScenario.monthlyPayment - affordability.maxSustainablePayment;
    score -= Math.min(45, 20 + overBy / 5);
  }

  const interestRatio = bestScenario.totalInterest / Math.max(listing.price, 1);
  score -= Math.min(25, interestRatio * 55);

  score -= Math.min(20, (bestScenario.negativeEquityMonths / 36) * 20);
  score += (listing.reliabilityScore - 3) * 4;
  score += (listing.mpgCombined - 30) * 0.3;
  score -= Math.max(0, warnings.length - 1) * 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildHeadline(analysis: CarAnalysis, rank: number, affordability: AffordabilityResult): string {
  const { bestScenario, warnings } = analysis;
  if (rank === 1) return "Best overall fit";
  if (!bestScenario.withinBudget) return "Stretches past your safe budget";
  if (bestScenario.negativeEquityMonths >= 30) return "Fits budget, but resale risk is high";
  if (warnings.length === 0) return "Clean fit, no red flags";
  if (bestScenario.monthlyPayment <= affordability.recommendedPayment) return "Comfortably under budget";
  return "Solid option, worth a look";
}

function buildExplanation(analysis: CarAnalysis): string {
  const { listing, bestScenario, warnings } = analysis;
  const headlineFacts = `${listing.year} ${listing.make} ${listing.model} ${listing.trim} is listed at $${listing.price.toLocaleString()}. A ${bestScenario.termMonths}-month loan at ${bestScenario.apr}% APR runs $${bestScenario.monthlyPayment}/mo and totals $${bestScenario.totalInterest.toLocaleString()} in interest over the life of the loan.`;
  const reliability = `Rated ${listing.reliabilityScore}/5 for reliability at ${listing.mpgCombined} mpg combined, with ${listing.mileage.toLocaleString()} miles on the odometer.`;
  const caveat = warnings.length > 0 ? warnings[0] : "No major cost warnings on this one.";
  return `${headlineFacts} ${reliability} ${caveat}`;
}

function buildSavingsHighlight(ranked: RankedCar[]): SavingsHighlight {
  if (ranked.length === 0) {
    return { amount: 0, description: "Not enough listings in range yet to compare." };
  }

  const top = ranked[0];
  const scenario72 = top.allScenarios.find((s) => s.termMonths === 72);

  if (scenario72 && top.bestScenario.termMonths < 72) {
    const amount = Math.max(0, Math.round(scenario72.totalInterest - top.bestScenario.totalInterest));
    return {
      amount,
      description: `Taking the ${top.bestScenario.termMonths}-month loan on the ${top.listing.year} ${top.listing.make} ${top.listing.model} instead of stretching to 72 months saves $${amount.toLocaleString()} in interest.`,
    };
  }

  const priciest = [...ranked].sort((a, b) => b.bestScenario.totalInterest - a.bestScenario.totalInterest)[0];
  const amount = Math.max(0, Math.round(priciest.bestScenario.totalInterest - top.bestScenario.totalInterest));
  return {
    amount,
    description: `Choosing the ${top.listing.year} ${top.listing.make} ${top.listing.model} over the ${priciest.listing.year} ${priciest.listing.make} ${priciest.listing.model} saves $${amount.toLocaleString()} in total interest.`,
  };
}

function buildDealerPacket(
  need: BuyerNeed,
  credit: CreditReport,
  affordability: AffordabilityResult,
  ranked: RankedCar[],
  negotiationTips?: string[],
): DealerPacket {
  const topTargets = ranked.slice(0, 3);
  const recommendedDownPayment =
    need.downPayment > 0 ? need.downPayment : Math.round((affordability.cashAvailableForDown * 0.6) / 50) * 50;

  return {
    creditSummary: credit.summary,
    tierLabel: credit.tierLabel,
    maxApprovedPayment: affordability.recommendedPayment,
    recommendedDownPayment,
    targets: topTargets.map((car) => ({
      year: car.listing.year,
      make: car.listing.make,
      model: car.listing.model,
      trim: car.listing.trim,
      walkAwayPrice: computeWalkAwayPrice(car.listing.price, car.listing.daysOnMarket),
      maxApr: credit.estimatedApr.max,
    })),
    negotiationTips: negotiationTips ?? [
      `Lead with your target payment of $${affordability.recommendedPayment}/mo, not the price — dealers negotiate the number you bring up first.`,
      "Ask for the out-the-door price in writing before any financing conversation starts.",
      `You're already shopping pre-qualified. Only finance through the dealer if they beat ${credit.estimatedApr.max}% APR.`,
      `Walk away if add-ons push the payment past $${affordability.maxSustainablePayment}/mo — that's your hard ceiling, not a suggestion.`,
    ],
    generatedAt: new Date().toISOString(),
  };
}

function computeWalkAwayPrice(price: number, daysOnMarket: number): number {
  const marginPct = 0.03 + Math.min(daysOnMarket, 45) / 45 * 0.05;
  return Math.round((price * (1 - marginPct)) / 50) * 50;
}

function simulateLatency(minMs: number, maxMs: number) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
