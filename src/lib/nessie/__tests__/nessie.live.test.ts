import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeSnapshot, analyzeSnapshotWithStats } from "@/lib/nessie/cashflow";
import { fetchNessieSnapshot } from "@/lib/nessie/client";
import { getNessieConfig } from "@/lib/nessie/config";
import { NessieError } from "@/lib/nessie/errors";
import { buildSeedDataset } from "../../../../scripts/nessie-seed/dataset.mjs";
import { NEED, seedSnapshot } from "./fixtures";

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

/**
 * After `npm run nessie:seed -- --apply`: checks the live sandbox matches the
 * seed dataset exactly, analyzed as of the seed date. Opt in with
 *   NESSIE_LIVE_TEST=1 NESSIE_LIVE_SEED_MANIFEST=.nessie-seed.local.json ...
 * Failures name fields and numbers only — never ids.
 */
const manifestPath = process.env.NESSIE_LIVE_SEED_MANIFEST;
describe.skipIf(process.env.NESSIE_LIVE_TEST !== "1" || !manifestPath)("Nessie sandbox (seeded persona)", () => {
  it("matches the seed dataset through the analyzer", { timeout: 60000 }, async () => {
    const cfg = getNessieConfig();
    if (cfg.mode !== "live") throw new Error("NESSIE_LIVE_SEED_MANIFEST requires NESSIE_MODE=live");
    const manifest = JSON.parse(readFileSync(manifestPath!, "utf8")) as {
      persona: string;
      asOf: string;
      customerId: string;
      loansSupported: boolean;
      complete: boolean;
    };
    expect(manifest.complete, "manifest records a complete seed").toBe(true);
    expect(cfg.customerId === manifest.customerId, "NESSIE_CUSTOMER_ID matches the manifest").toBe(true);

    const asOfNoon = new Date(`${manifest.asOf}T12:00:00Z`);
    const expected = analyzeSnapshotWithStats(
      seedSnapshot(buildSeedDataset({ asOf: manifest.asOf, personaId: manifest.persona }), {
        loansSupported: manifest.loansSupported,
      }),
      NEED,
      asOfNoon,
    );
    const live = analyzeSnapshotWithStats(await fetchNessieSnapshot(cfg), NEED, asOfNoon);

    expect(live.stats).toEqual({ malformed: 0, invalidDates: 0, duplicates: 0 });
    expect(live.result).toEqual(expected.result);
  });
});
