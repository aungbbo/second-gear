import { analyzeSnapshotWithStats } from "@/lib/nessie/cashflow";
import { fetchNessieSnapshot } from "@/lib/nessie/client";
import { getNessieConfig } from "@/lib/nessie/config";
import { mockCashFlow } from "@/lib/nessie/mock";
import type { AffordabilityResult, BuyerNeed, CreditReport } from "@/lib/types";

/**
 * Step 2 — affordability from the buyer's Capital One Nessie accounts,
 * deposits, withdrawals, purchases, bills, and loans. NESSIE_MODE picks live
 * sandbox data or the demo mock explicitly; a live failure throws a
 * NessieError and never falls back to mock numbers.
 */
export async function analyzeCashFlow(
  need: BuyerNeed,
  credit: CreditReport,
): Promise<AffordabilityResult> {
  const cfg = getNessieConfig();
  if (cfg.mode === "mock") return mockCashFlow(need, credit);

  const snapshot = await fetchNessieSnapshot(cfg);
  const { result, stats } = analyzeSnapshotWithStats(snapshot, need);
  // Counts only — never ids, amounts, or the key.
  if (stats.malformed + stats.invalidDates + stats.duplicates > 0) {
    console.warn(
      `[nessie] ignored records: malformed=${stats.malformed} invalidDates=${stats.invalidDates} duplicates=${stats.duplicates}`,
    );
  }
  return result;
}
