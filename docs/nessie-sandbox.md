# Nessie sandbox: demo data

Second Gear reads cash flow from the Capital One Nessie sandbox (`NESSIE_MODE=live`). A fresh sandbox key has no data, so the pipeline answers 422 until a customer is seeded. `scripts/nessie-seed.mjs` creates one demo persona. It is development-only: the app never imports it, and the app itself only ever reads from Nessie.

## Seeding

```bash
npm run nessie:seed                    # 1. dry run: no network; prints the plan and every payload
npm run nessie:seed -- --preflight     # 2. read-only: duplicate-persona and merchant checks
npm run nessie:seed -- --apply --canary-only   # 3. writes: NEW customer + accounts + 6 canaries (one per record shape), then stop
npm run nessie:seed -- --apply --resume        # 4. writes: the remaining records
```

If an apply stops partway, the manifest keeps `complete: false` and the ids it created. Don't start over; resume in place:

```bash
npm run nessie:seed -- --resume                          # read-only: verifies the partial seed, shows what's missing
npm run nessie:seed -- --apply --resume --canary-only    # at most 6 POSTs: one record of each shape, listed back, then stop
npm run nessie:seed -- --apply --resume                  # posts only the missing records
```

Resume never creates a customer, account or merchant. It refuses when the manifest is complete or belongs to another persona, when its customer or accounts aren't visible with this key, or when the partial seed holds duplicate or unrecognised records. Records are matched by their `sg-seed:` label, so nothing is posted twice.

`--apply` never overwrites an existing `.nessie-seed.local.json`, not even with `--allow-duplicate`. Resume it, or archive it first, for example `mv .nessie-seed.local.json .nessie-seed.<persona>.broken.local.json`. Archives match the gitignore pattern `/.nessie-seed*.local.json`.

### What the live sandbox actually enforces

The deployed API is stricter than the SDKs. These rules were learned the hard way and are now covered by the mock server's tests:

**`status` is required on transaction creates.** The SDKs mark it optional, but the live sandbox rejects a deposit without it: `HTTP 400 — "1 validation error for DepositCreate / status / field required"`. Deposits, withdrawals and purchases therefore send `status: "completed"`, and the canary and read-back check that it round-trips. Payloads are also kept ASCII-only. Failed requests print Nessie's scrubbed, clipped response body and record it as `lastError` in the manifest.

**Every bill needs `recurring_date` and `upcoming_payment_date`, or the bill list breaks.** `POST /bills` accepts a bill without them, but `GET /accounts/{id}/bills` (and `/customers/{id}/bills`) then answers `HTTP 400 — "2 validation errors for Bill / recurring_date / upcoming_payment_date field required"` for the whole collection. The seed now sends both fields on every bill, following the SDK convention:
- **Recurring bills** (rent, internet): `recurring_date` is the due day, `payment_date` the last due date, `upcoming_payment_date` the next one.
- **One-off bills** (electric): `recurring_date: 0`, and `upcoming_payment_date` equals the date already paid, so no future obligation is invented.

The analyzer reads only `status`, `payment_date` and `payment_amount`, so affordability is unchanged.

After `--apply`:

1. Copy `customerId` from `.nessie-seed.local.json` into `.env.local` as `NESSIE_CUSTOMER_ID`, and set `NESSIE_MODE=live`.
2. Restart `npm run dev`.
3. Verify the seed:
   ```bash
   NESSIE_LIVE_TEST=1 NESSIE_LIVE_EXPECT_DATA=1 NESSIE_LIVE_SEED_MANIFEST=.nessie-seed.local.json npm test -- nessie.live
   ```
   The `NESSIE_*` variables must be exported in your shell. Vitest does not read `.env.local`.

### Safeguards

- **Read-only unless `--apply`.** Without the flag, the client refuses any POST. There is no PUT or PATCH, and **never `DELETE /data`**, which wipes everything under the key.
- **Always a new customer.** The script never writes into an existing customer.
- **Refuses to re-seed** when a customer named for the persona exists, or when the manifest already records a complete seed. Override with `--allow-duplicate`.
- **No retries on POST,** so a retry can never create a duplicate. A failure stops the run and leaves a `complete: false` manifest. There is no rollback, and a partial customer is harmless.
- **Canaries for every record shape.** Before any bulk write, the script posts one deposit, one withdrawal, one recurring bill, one one-off bill, one purchase and one loan. After each, it lists that collection back. If the list fails, or any sent field (date, amount, label, status, bill dates…) changed, it stops with exit code 3. This is what would have caught the bill issue before it broke a customer.
- **Every created id is saved.** `manifest.recordIds` holds the id of each transaction, keyed by stream and `sg-seed:` label, alongside the customer, account and merchant ids.
- **Read-back.** After writing, every collection is fetched again and compared with the dataset. Mismatches are reported by field name.
- **Loans are required.** `POST`/`GET /accounts/{id}/loans` are documented Nessie endpoints. A failed loan POST stops the seed. On the app side, a failed loans read (a 404 included) fails the pipeline with 502 "We couldn't load your loan details…" rather than assuming zero debt. Only a successful empty list means "no loans".
- **No identifiers printed.** The key, customer ID, account IDs and merchant IDs never appear in output. Full IDs go only to `.nessie-seed.local.json`, which is gitignored with mode 600.

### Data aging

Transactions are dated relative to the seed day (2–80 days old). The analyzer uses a rolling 90-day window, so results are exact only on the seed day. After about 5 days, records shift buckets, and the oldest leave the window soon after. To refresh, seed again with `--allow-duplicate` (a new customer) and update `NESSIE_CUSTOMER_ID`. Don't try to delete the old customer.

## Personas in the sandbox

| Persona | State | Manifest |
|---|---|---|
| `sg-demo-subprime-01` | **Broken, do not use.** Fully posted (9 deposits, 3 withdrawals, 5 bills, 24 purchases, 1 loan), but its bills were posted without `upcoming_payment_date` (and the one-off ones also without `recurring_date`), so its bill list returns 400 forever (no PUT/DELETE allowed). The app correctly fails closed (502) on it | `.nessie-seed.sg-demo-subprime-01.broken.local.json` |
| `sg-demo-subprime-02` | The default persona; seed with the fixed bill payloads | `.nessie-seed.local.json` once seeded |

## Persona profile (`sg-demo-subprime-02`, same data as -01)

| | |
|---|---|
| Nessie customer | `SecondGear Demo sg-demo-subprime-02`, 1200 Demo Ave, Columbus OH 43215. The ID lives only in `.nessie-seed.local.json` and `.env.local` |
| Accounts | Checking 1850 · Savings 2400 · Credit Card 1800 balance (all activity on checking) |
| Income | Payroll $1,650 biweekly + rideshare $150 monthly ≈ $3,450/mo, low volatility |
| Essentials | Rent $1,250 + internet $60 (recurring), electric ~$98/mo, ATM cash $120/mo ≈ $1,530/mo |
| Debt | Equipment loan $140/mo + card minimum ≈ $180/mo |
| Discretionary | Groceries, gas, diner ≈ $500/mo |
| Expected affordability | $400 budget → max $400 / recommended $350; $600 budget → max $440 / recommended $385 |

### Future CRS link

CRS integration is not implemented yet. When it is, the persona ID is the join key:

- The Nessie customer's `last_name` and the manifest's `persona` field both carry it.
- A future `CRS_TEST_PERSONA` setting will select the CRS sandbox identity for the same persona. That identity should be in the subprime band (580–619) and use the same name and address, so the soft pull and the cash-flow read describe one person.
- No IDs belong in this file or in git; keep them in `.env.local` and the manifest.
