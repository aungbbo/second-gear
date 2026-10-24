import type { CreditTier } from "@/lib/types";

/**
 * Score band → tier and an application-generated APR range. The APR range is
 * Second Gear's own estimate for the band, not a lender offer or approval.
 * Moved verbatim from providers/crs.ts.
 */
export function classify(score: number): {
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
