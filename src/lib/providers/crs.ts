import type { VerifiedConsent } from "@/lib/consent";
import { orderCreditReport } from "@/lib/crs/client";
import { getCrsConfig } from "@/lib/crs/config";
import { mapCrsReport } from "@/lib/crs/mapper";
import { mockSoftCredit } from "@/lib/crs/mock";
import type { BuyerNeed, CreditReport } from "@/lib/types";

/**
 * Step 1 — soft credit pull. CRS_MODE picks a real CRS sandbox prequalification
 * report or the demo mock explicitly; a live failure throws a CrsError and
 * never falls back to mock numbers. Callers must pass verified consent.
 */
export async function pullSoftCredit(need: BuyerNeed, consent: VerifiedConsent): Promise<CreditReport> {
  const cfg = getCrsConfig();
  if (cfg.mode === "mock") return mockSoftCredit(need);

  const report = await orderCreditReport(cfg, consent);
  return mapCrsReport(report, { bureau: cfg.bureau });
}
