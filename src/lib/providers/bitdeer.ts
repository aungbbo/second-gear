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

/**
 * Mock of a Bitdeer AI Model Studio call (DeepSeek-V4.1-Flash) that explains
 * the credit factors, ranks the shortlist with structured output, and
 * drafts the dealer packet. Swap the body for a real chat-completion call
 * later — the output shape (ExplainAndRankOutput) is the contract the UI
 * renders.
 */
export async function explainAndRank(input: ExplainAndRankInput): Promise<ExplainAndRankOutput> {
  await simulateLatency(900, 1400);

  const { need, credit, affordability, analyses } = input;

  const scored = analyses.map((analysis) => ({
    analysis,
    matchScore: scoreCar(analysis, affordability),
  }));

  const ranked = scored
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, Math.min(6, scored.length))
    .map(({ analysis, matchScore }, index): RankedCar => {
      const rank = index + 1;
      return {
        ...analysis,
        rank,
        matchScore,
        headline: buildHeadline(analysis, rank, affordability),
        explanation: buildExplanation(analysis),
      };
    });

  const dealerPacket = buildDealerPacket(need, credit, affordability, ranked);
  const savingsHighlight = buildSavingsHighlight(ranked);

  return { rankedCars: ranked, dealerPacket, savingsHighlight };
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
    negotiationTips: [
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
