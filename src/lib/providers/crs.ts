import { SeededRandom } from "@/lib/random";
import type { BuyerNeed, CreditFactor, CreditReport, CreditTier } from "@/lib/types";

/**
 * Mock of the CRS Credit API soft-pull endpoint. Swap the body of this
 * function for a real `fetch()` to CRS once sandbox credentials are wired
 * up — the return shape (CreditReport) is the contract the rest of the
 * pipeline depends on.
 */
export async function pullSoftCredit(need: BuyerNeed): Promise<CreditReport> {
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
    summary: `Score of ${score} puts you in ${tierLabel.toLowerCase()} territory. Lenders in this range typically price auto loans between ${aprMin}% and ${aprMax}% APR — the single biggest lever on what this car actually costs you.`,
  };
}

function classify(score: number): {
  tier: CreditTier;
  tierLabel: string;
  scoreRangeLabel: string;
  aprMin: number;
  aprMax: number;
} {
  if (score < 580) {
    return {
      tier: "deep-subprime",
      tierLabel: "Deep subprime",
      scoreRangeLabel: "300–579",
      aprMin: 18,
      aprMax: 24,
    };
  }
  if (score < 620) {
    return {
      tier: "subprime",
      tierLabel: "Subprime",
      scoreRangeLabel: "580–619",
      aprMin: 15,
      aprMax: 20,
    };
  }
  if (score < 660) {
    return {
      tier: "nonprime",
      tierLabel: "Nonprime",
      scoreRangeLabel: "620–659",
      aprMin: 11,
      aprMax: 16,
    };
  }
  if (score < 700) {
    return {
      tier: "near-prime",
      tierLabel: "Near-prime",
      scoreRangeLabel: "660–699",
      aprMin: 8,
      aprMax: 12,
    };
  }
  return {
    tier: "prime",
    tierLabel: "Prime",
    scoreRangeLabel: "700+",
    aprMin: 5,
    aprMax: 8,
  };
}

function simulateLatency(minMs: number, maxMs: number) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
