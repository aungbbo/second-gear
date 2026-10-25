import { classify } from "@/lib/crs/classify";
import { SeededRandom } from "@/lib/random";
import type { BuyerNeed, CreditFactor, CreditReport } from "@/lib/types";

/**
 * Demo-only stand-in for a CRS soft pull, used only when CRS_MODE=mock. The
 * return shape (CreditReport) is what the rest of the pipeline consumes.
 * Moved verbatim from providers/crs.ts.
 */
export async function mockSoftCredit(need: BuyerNeed): Promise<CreditReport> {
  await simulateLatency(500, 900);

  const rand = new SeededRandom(`crs:${need.zip}:${need.description}:${need.maxMonthlyPayment}`);
  const score = Math.round(rand.between(560, 650));
  const { tier, tierLabel, scoreRangeLabel, aprMin, aprMax } = classify(score);

  const allFactors: CreditFactor[] = [
    {
      label: "Revolving utilization",
      impact: "negative",
      detail: `Using ${rand.int(58, 86)}% of available revolving credit — lenders prefer under 30%.`,
    },
    {
      label: "On-time payments, last 12 months",
      impact: rand.next() > 0.35 ? "positive" : "negative",
      detail: `${rand.int(82, 97)}% of payments made on time over the last year.`,
    },
    {
      label: "Credit history length",
      impact: "neutral",
      detail: `Oldest open account is ${rand.int(2, 6)} years old — still building.`,
    },
    {
      label: "Hard inquiries",
      impact: "negative",
      detail: `${rand.int(1, 4)} inquiries in the last 6 months, which trims the score slightly.`,
    },
    {
      label: "Collections on file",
      impact: rand.next() > 0.5 ? "negative" : "neutral",
      detail:
        rand.next() > 0.5
          ? "One past-due medical collection, paid, still reporting."
          : "No collections currently reporting.",
    },
    {
      label: "Account mix",
      impact: "positive",
      detail: "Mix of installment and revolving accounts, which lenders like to see.",
    },
  ];

  const factors = rand.shuffle(allFactors).slice(0, 4);

  return {
    score,
    tier,
    tierLabel,
    scoreRangeLabel,
    factors,
    estimatedApr: { min: aprMin, max: aprMax },
    hardInquiriesLast6mo: rand.int(1, 4),
    summary: `Score of ${score} puts you in the ${tierLabel.toLowerCase()} used-car tier. The average used-car APR shown for this score band is ${aprMin.toFixed(2)}% — a planning estimate based on the provided Experian chart, not a lender offer.`,
  };
}

function simulateLatency(minMs: number, maxMs: number) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
