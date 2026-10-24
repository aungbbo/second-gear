import { describe, expect, it } from "vitest";
import { analyzeSnapshot } from "@/lib/nessie/cashflow";
import { fetchNessieSnapshot } from "@/lib/nessie/client";
import { getNessieConfig } from "@/lib/nessie/config";
import { NessieError } from "@/lib/nessie/errors";
import { NEED } from "./fixtures";

/**
 * Hits the real Nessie sandbox (read-only). Opt in with:
 *   NESSIE_LIVE_TEST=1 NESSIE_MODE=live NESSIE_API_KEY=... NESSIE_CUSTOMER_ID=... npm test
 *
 * A verified customer with no accounts or no recent deposits passes as
 * `insufficient_data` — the pipeline must fail loudly there, not fake
 * numbers. Add NESSIE_LIVE_EXPECT_DATA=1 to require real affordability
 * data instead (e.g. after seeding). An unknown customer or invalid key is
 * `not_found` and always fails.
 */
describe.skipIf(process.env.NESSIE_LIVE_TEST !== "1")("Nessie sandbox (live)", () => {
  it("fetches a snapshot and produces an affordability result", { timeout: 30000 }, async () => {
    const cfg = getNessieConfig();
    if (cfg.mode !== "live") throw new Error("NESSIE_LIVE_TEST=1 requires NESSIE_MODE=live");
    const expectData = process.env.NESSIE_LIVE_EXPECT_DATA === "1";

    try {
      const snapshot = await fetchNessieSnapshot(cfg);
      const result = analyzeSnapshot(snapshot, NEED);
      expect(snapshot.accounts.length).toBeGreaterThan(0);
      expect(result.maxSustainablePayment).toBeGreaterThanOrEqual(150);
      expect(typeof result.summary).toBe("string");
    } catch (err) {
      if (expectData || !(err instanceof NessieError) || err.kind !== "insufficient_data") throw err;
    }
  });
});
