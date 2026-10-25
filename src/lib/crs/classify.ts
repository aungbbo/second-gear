import type { CreditTier } from "@/lib/types";

/**
 * Score band → Experian tier and average used-car APR from the chart provided
 * for this app. The APR is a market average estimate, not a lender offer.
 */
export function classify(score: number): {
  tier: CreditTier;
  tierLabel: string;
  scoreRangeLabel: string;
  aprMin: number;
  aprMax: number;
} {
  if (score <= 500) {
    return {
      tier: "deep-subprime",
      tierLabel: "Deep subprime",
      scoreRangeLabel: "300–500",
      aprMin: 21.62,
      aprMax: 21.62,
    };
  }
  if (score <= 600) {
    return {
      tier: "subprime",
      tierLabel: "Subprime",
      scoreRangeLabel: "501–600",
      aprMin: 19.1,
      aprMax: 19.1,
    };
  }
  if (score <= 660) {
    return {
      tier: "near-prime",
      tierLabel: "Near prime",
      scoreRangeLabel: "601–660",
      aprMin: 13.93,
      aprMax: 13.93,
    };
  }
  if (score <= 780) {
    return {
      tier: "prime",
      tierLabel: "Prime",
      scoreRangeLabel: "661–780",
      aprMin: 8.81,
      aprMax: 8.81,
    };
  }
  return {
    tier: "super-prime",
    tierLabel: "Super prime",
    scoreRangeLabel: "781+",
    aprMin: 6.29,
    aprMax: 6.29,
  };
}
