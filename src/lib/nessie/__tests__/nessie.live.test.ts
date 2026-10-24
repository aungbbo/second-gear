import { describe, expect, it } from "vitest";
import { analyzeSnapshot } from "@/lib/nessie/cashflow";
import { fetchNessieSnapshot } from "@/lib/nessie/client";
import { getNessieConfig } from "@/lib/nessie/config";
import { NessieError } from "@/lib/nessie/errors";
import { NEED } from "./fixtures";

/**
 * Hits the real Nessie sandbox. Opt in with:
 *   NESSIE_LIVE_TEST=1 NESSIE_MODE=live NESSIE_API_KEY=... NESSIE_CUSTOMER_ID=... npm test
 */
describe.skipIf(process.env.NESSIE_LIVE_TEST !== "1")("Nessie sandbox (live)", () => {
  it("fetches a snapshot and produces an affordability result", { timeout: 30000 }, async () => {
    const cfg = getNessieConfig();
    if (cfg.mode !== "live") throw new Error("NESSIE_LIVE_TEST=1 requires NESSIE_MODE=live");

    const snapshot = await fetchNessieSnapshot(cfg);
    expect(snapshot.accounts.length).toBeGreaterThan(0);

    try {
      const result = analyzeSnapshot(snapshot, NEED);
      expect(result.maxSustainablePayment).toBeGreaterThanOrEqual(150);
      expect(typeof result.summary).toBe("string");
    } catch (err) {
      // A real but empty sandbox customer is a valid outcome — it must fail loudly, not fake numbers.
      expect(err).toBeInstanceOf(NessieError);
      expect((err as NessieError).kind).toBe("insufficient_data");
    }
  });
});
