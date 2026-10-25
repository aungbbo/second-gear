import type {
  AffordabilityAssessment,
  AffordabilityResult,
  BuyerNeed,
  CarAnalysis,
  CreditReport,
  DealerPacket,
  RankedCar,
  SavingsHighlight,
} from "@/lib/types";
import { applyOwnershipCostEstimates } from "@/lib/analysis";
import { DEFAULT_OWNERSHIP_COST_ASSUMPTIONS } from "@/lib/affordability/ownership";

interface ExplainAndRankInput {
  need: BuyerNeed;
  credit: CreditReport;
  affordability: AffordabilityResult;
  assessment: AffordabilityAssessment;
  analyses: CarAnalysis[];
}

interface ExplainAndRankOutput {
  rankedCars: RankedCar[];
  dealerPacket: DealerPacket;
  savingsHighlight: SavingsHighlight;
  rankingSource: "bitdeer" | "bitdeer_with_fallback" | "local_fallback";
}

const BITDEER_ENDPOINT = "https://api-inference.bitdeer.ai/v1/chat/completions";
const BITDEER_MODEL = "zai-org/GLM-5.3-Flash";
const BITDEER_TIMEOUT_MS = 45000;

const SYSTEM_PROMPT = `You are Second Gear's vehicle-affordability ranking agent. You will receive the buyer's stated
vehicle needs and budget, identity-free CRS credit-profile data, aggregate banking cash-flow data, and every
usable vehicle listing returned by the listings provider. The app provides loan calculations and provisional
non-insurance ownership-cost baselines; you must return car-specific monthly planning estimates for insurance, fuel, and
maintenance for every listing.

Before ranking, estimate monthly insurance, fuel, and maintenance for each exact car using its year, make,
model, trim, body style, mileage, reliability, fuel type, combined MPG, listing location, buyer ZIP, and the
provided baseline assumptions. Return whole-dollar USD monthly amounts. Treat these as cautious planning
estimates, not quotes or verified live market prices. Insurance cannot be personalized without driver age,
driving history, coverage, and garaging details: do not invent those facts, and do not use CRS score, credit
tier, or banking information to estimate insurance. For fuel, use the provided MPG, monthly-miles assumption,
and fuel-price assumption; use $0 only for an explicitly electric vehicle. For maintenance, account for age,
mileage, reliability, powertrain, and likely repair/service needs; do not simply repeat the baseline. If a
buyer-provided cost exists for a category, echo that exact amount rather than replacing it. Use the new
estimates (and any buyer-provided amounts) when comparing all-in monthly ownership costs and ranking cars.
Estimate a broad typical insurance amount for each vehicle from its class, approximate replacement value, age,
and location even though driver-specific details are unavailable. Do not use a flat placeholder or repeat the
same amount across materially different vehicles merely because driver details are missing. Use the same amount
only for genuinely similar vehicles in similar locations, and treat every amount as uncertain rather than a quote.

Rank EVERY provided candidate from best fit to worst fit, exactly once. Return all candidate listingIds in
rankedCars in the desired order; do not shortlist, omit, or invent a listing. Optimize for the buyer's stated
priorities while balancing all-in monthly ownership cost against the buyer's monthly payment target. Consider APR,
total interest, term length, negative-equity exposure,
reliability, fuel economy, stated use, and CARFAX history when supplied. Prefer verified clean history, but
unknown history is unknown and must never be treated as clean. Credit score or tier alone must not decide rank.

Ground every explanation only in supplied data. Do not claim lender approval, guarantee affordability, or
invent facts. Give each listing a brief 2-5 word headline and one concise sentence explaining its fit or main
tradeoff with concrete values when useful. Then provide four practical negotiation tips grounded in the buyer's
credit and budget. Keep reasoning concise and call submit_ranking. Respond only by calling submit_ranking.`;

const RANKING_TOOL = {
  type: "function",
  function: {
    name: "submit_ranking",
    description: "Return every supplied listing exactly once, ordered best-to-worst, with monthly vehicle-cost estimates, a concise evidence-based reason, and practical negotiation tips.",
    parameters: {
      type: "object",
      properties: {
        rankedCars: {
          type: "array",
          items: {
            type: "object",
            properties: {
              listingId: { type: "string", description: "Must exactly match a candidate listingId provided." },
              headline: { type: "string", description: "Brief 2-5 word fit label." },
              explanation: { type: "string", description: "One concise sentence grounded only in the provided data." },
              monthlyOwnershipEstimates: {
                type: "object",
                properties: {
                  insuranceMonthly: { type: "number", description: "Car-specific monthly insurance planning estimate in whole USD dollars." },
                  fuelMonthly: { type: "number", description: "Monthly fuel estimate in whole USD dollars." },
                  maintenanceMonthly: { type: "number", description: "Car-specific monthly maintenance and repair reserve in whole USD dollars." },
                },
                required: ["insuranceMonthly", "fuelMonthly", "maintenanceMonthly"],
              },
            },
            required: ["listingId", "headline", "explanation", "monthlyOwnershipEstimates"],
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
 * Step 5 — rank every usable listing, explain the order, and draft the dealer packet. Calls Bitdeer AI
 * Model Studio (GLM-5.3-Flash) when BITDEER_API_KEY is configured;
 * falls back to a deterministic local scorer/template if the key is
 * missing or the live call fails for any reason, so the pipeline never
 * breaks on a flaky request.
 */
export async function explainAndRank(input: ExplainAndRankInput): Promise<ExplainAndRankOutput> {
  const { need, credit, affordability, analyses } = input;

  const scored = analyses.map((analysis) => ({
    analysis,
    matchScore: scoreCar(analysis),
  }));
  const sorted = [...scored].sort((a, b) => b.matchScore - a.matchScore);
  const candidates = scored;

  const live = await callBitdeerRanking({ need, credit, affordability, assessment: input.assessment, candidates, fallbackOrder: sorted });

  let ranked: RankedCar[];
  let negotiationTips: string[] | undefined;
  let rankingSource: ExplainAndRankOutput["rankingSource"];

  if (live) {
    ranked = live.rankedCars;
    negotiationTips = live.negotiationTips.length > 0 ? live.negotiationTips : undefined;
    rankingSource = live.complete ? "bitdeer" : "bitdeer_with_fallback";
  } else {
    ranked = sorted.map(({ analysis, matchScore }, index): RankedCar => {
      const rank = index + 1;
      return {
        ...analysis,
        rank,
        matchScore,
        headline: buildHeadline(analysis, rank, affordability),
        explanation: buildExplanation(analysis),
        ownershipEstimateSource: "app",
      };
    });
    rankingSource = "local_fallback";
  }

  const dealerPacket = buildDealerPacket(need, credit, affordability, ranked, negotiationTips);
  const savingsHighlight = buildSavingsHighlight(ranked);

  return { rankedCars: ranked, dealerPacket, savingsHighlight, rankingSource };
}

interface ScoredCandidate {
  analysis: CarAnalysis;
  matchScore: number;
}

async function callBitdeerRanking(params: {
  need: BuyerNeed;
  credit: CreditReport;
  affordability: AffordabilityResult;
  assessment: AffordabilityAssessment;
  candidates: ScoredCandidate[];
  fallbackOrder: ScoredCandidate[];
}): Promise<{ rankedCars: RankedCar[]; negotiationTips: string[]; complete: boolean } | null> {
  const apiKey = process.env.BITDEER_API_KEY;
  if (!apiKey) return null;

  const { need, credit, affordability, assessment, candidates, fallbackOrder } = params;
  const byId = new Map(candidates.map((c) => [c.analysis.listing.id, c]));

  const userPayload = {
    buyer: {
      description: need.description,
      maxMonthlyPayment: need.maxMonthlyPayment,
      timeframeWeeks: need.timeframeWeeks,
      downPayment: need.downPayment,
      zip: need.zip,
      selectedSortPriority: need.searchSortBy ?? "deal_score",
      searchPreferences: need.searchPreferences,
      buyerProvidedMonthlyOwnershipCosts: need.ownershipCostOverrides,
      ownershipCostBaselineAssumptions: {
        monthlyMiles: DEFAULT_OWNERSHIP_COST_ASSUMPTIONS.monthlyMiles,
        fuelPricePerGallon: DEFAULT_OWNERSHIP_COST_ASSUMPTIONS.fuelPricePerGallon,
        defaultMpg: DEFAULT_OWNERSHIP_COST_ASSUMPTIONS.defaultMpg,
        maintenanceMonthlyFloor: DEFAULT_OWNERSHIP_COST_ASSUMPTIONS.maintenanceMonthlyFloor,
        maintenanceAnnualRate: DEFAULT_OWNERSHIP_COST_ASSUMPTIONS.maintenanceAnnualRate,
        registrationAndTaxesAnnualRate: DEFAULT_OWNERSHIP_COST_ASSUMPTIONS.registrationAndTaxesAnnualRate,
      },
    },
    credit: {
      score: credit.score,
      tierLabel: credit.tierLabel,
      summary: credit.summary,
      estimatedApr: credit.estimatedApr,
      hardInquiriesLast6mo: credit.hardInquiriesLast6mo,
      bureauScoreFactors: credit.bureauScoreFactors?.slice(0, 8),
      insights: credit.insights ? {
        revolvingUtilizationPercent: credit.insights.revolvingUtilizationPercent,
        accountCount: credit.insights.accountCount,
        latePayments: credit.insights.latePayments,
        collections: credit.insights.collections,
        chargeOffs: credit.insights.chargeOffs,
        publicRecords: credit.insights.publicRecords,
        inquiriesLast6Months: credit.insights.inquiriesLast6Months,
        creditHistoryYears: credit.insights.creditHistoryYears,
      } : undefined,
      factors: credit.factors.slice(0, 8),
    },
    bankingCashFlow: {
      monthlyIncome: affordability.avgMonthlyIncome,
      livingExpenses: affordability.essentialExpenses,
      existingDebtPayments: affordability.existingDebtPayments,
      discretionaryCashFlow: affordability.discretionaryBuffer,
      cashFlowPaymentCapacity: affordability.maxSustainablePayment,
      recommendedPayment: affordability.recommendedPayment,
      savingsBalance: affordability.savingsBalance,
      cashAvailableForDownPayment: affordability.cashAvailableForDown,
      incomeVolatility: affordability.incomeVolatility,
      summary: affordability.summary,
    },
    candidates: candidates.map(({ analysis }) => ({
      listingId: analysis.listing.id,
      year: analysis.listing.year,
      make: analysis.listing.make,
      model: analysis.listing.model,
      trim: analysis.listing.trim,
      bodyStyle: analysis.listing.bodyStyle,
      city: analysis.listing.city,
      state: analysis.listing.state,
      price: analysis.listing.price,
      mileage: analysis.listing.mileage,
      reliabilityScore: analysis.listing.reliabilityScore,
      mpgCombined: analysis.listing.mpgCombined,
      fuelType: analysis.listing.fuelType,
      carfaxHistory: analysis.listing.carfaxHistory,
      bestTermMonths: analysis.bestScenario.termMonths,
      apr: analysis.bestScenario.apr,
      monthlyPayment: analysis.bestScenario.monthlyPayment,
      totalInterest: analysis.bestScenario.totalInterest,
      totalLoanPayments: analysis.bestScenario.totalCost,
      loanPaymentWithinBuyerTarget: analysis.bestScenario.withinBudget,
      provisionalNonInsuranceOwnershipCosts: {
        fuelMonthly: analysis.ownershipCosts.fuelMonthly,
        maintenanceMonthly: analysis.ownershipCosts.maintenanceMonthly,
        registrationAndTaxesMonthly: analysis.ownershipCosts.registrationAndTaxesMonthly,
        otherMonthly: analysis.ownershipCosts.otherMonthly,
      },
      buyerProvidedMonthlyOwnershipCosts: need.ownershipCostOverrides,
      totalMonthlyOwnershipCost: analysis.ownershipCosts.totalMonthlyCost,
      affordabilityStatus: analysis.affordabilityDecision.status,
      negativeEquityMonths: analysis.bestScenario.negativeEquityMonths,
      warnings: analysis.warnings,
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
        max_tokens: 10000,
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
      rankedCars?: {
        listingId: string;
        headline: string;
        explanation: string;
        monthlyOwnershipEstimates?: {
          insuranceMonthly?: number | string;
          fuelMonthly?: number | string;
          maintenanceMonthly?: number | string;
        };
      }[];
      negotiationTips?: string[];
    };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      console.error("Bitdeer tool call arguments were not valid JSON:", toolCall.function.arguments);
      return null;
    }

    const rankedCars: RankedCar[] = [];
    const seenIds = new Set<string>();
    let modelEstimateCount = 0;
    for (const item of parsed.rankedCars ?? []) {
      const candidate = byId.get(item?.listingId);
      if (!candidate || seenIds.has(item.listingId) || !item.headline?.trim() || !item.explanation?.trim()) continue;
      seenIds.add(item.listingId);
      const estimates = item.monthlyOwnershipEstimates;
      const validEstimates = {
        insuranceMonthly: validMonthlyEstimate(estimates?.insuranceMonthly),
        fuelMonthly: validMonthlyEstimate(estimates?.fuelMonthly),
        maintenanceMonthly: validMonthlyEstimate(estimates?.maintenanceMonthly),
      };
      const hasAllEstimates = Object.values(validEstimates).every((value) => value !== undefined);
      if (hasAllEstimates) modelEstimateCount++;
      const ownershipOverrides = { ...validEstimates, ...need.ownershipCostOverrides };
      const analysis = applyOwnershipCostEstimates(candidate.analysis, ownershipOverrides, assessment);
      rankedCars.push({
        ...analysis,
        rank: rankedCars.length + 1,
        matchScore: candidate.matchScore,
        headline: item.headline.trim().slice(0, 80),
        explanation: item.explanation.trim().slice(0, 500),
        ownershipEstimateSource: hasAllEstimates ? "ai" : "app",
      });
    }

    const modelRankedCount = rankedCars.length;
    if (modelRankedCount === 0 && candidates.length > 0) {
      console.error("Bitdeer response contained no valid candidate rankings");
      return null;
    }
    for (const candidate of fallbackOrder) {
      const id = candidate.analysis.listing.id;
      if (seenIds.has(id)) continue;
      const rank = rankedCars.length + 1;
      rankedCars.push({
        ...candidate.analysis,
        rank,
        matchScore: candidate.matchScore,
        headline: buildHeadline(candidate.analysis, rank, affordability),
        explanation: buildExplanation(candidate.analysis),
        ownershipEstimateSource: "app",
      });
    }

    const negotiationTips = (parsed.negotiationTips ?? []).filter(
      (t): t is string => typeof t === "string" && t.length > 0,
    );

    return {
      rankedCars,
      negotiationTips,
      complete: modelRankedCount === candidates.length && modelEstimateCount === candidates.length,
    };
  } catch (err) {
    console.error("Bitdeer call failed:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function validMonthlyEstimate(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\$?\d+(?:\.\d{1,2})?$/.test(value.trim())
      ? Number(value.trim().replace(/^\$/, ""))
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 3000
    ? Math.round(parsed)
    : undefined;
}

function scoreCar(analysis: CarAnalysis): number {
  const { bestScenario, listing, warnings } = analysis;
  let score = 100;

  if (!bestScenario.withinBudget) {
    const overBy = bestScenario.monthlyPayment - analysis.affordabilityDecision.maxSustainableMonthlyCost;
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
  if (!bestScenario.withinBudget) return "Stretches past your monthly target";
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
      `Walk away if add-ons push the payment past $${need.maxMonthlyPayment}/mo — that's your monthly target.`,
    ],
    generatedAt: new Date().toISOString(),
  };
}

function computeWalkAwayPrice(price: number, daysOnMarket: number): number {
  const marginPct = 0.03 + Math.min(daysOnMarket, 45) / 45 * 0.05;
  return Math.round((price * (1 - marginPct)) / 50) * 50;
}
