# Nessie sandbox: demo data

Second Gear reads cash flow from the Capital One Nessie sandbox (`NESSIE_MODE=live`). A fresh sandbox key has no data, so the pipeline answers 422 until a customer is seeded. `scripts/nessie-seed.mjs` creates one demo persona. It is development-only: the app never imports it, and the app itself only ever reads from Nessie.

## Seeding

```bash
npm run nessie:seed                    # 1. dry run: no network; prints the plan and every payload
npm run nessie:seed -- --preflight     # 2. read-only: duplicate-persona and merchant checks
npm run nessie:seed -- --apply         # 3. writes: creates a NEW customer and its data
```

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
- **Canary.** Before the bulk of the writes, the script posts one back-dated deposit and reads it back. If Nessie changed its date, amount or description, the script stops with exit code 3.
- **Read-back.** After writing, every collection is fetched again and compared with the dataset. Mismatches are reported by field name.
- **Loans are required.** `POST`/`GET /accounts/{id}/loans` are documented Nessie endpoints. A failed loan POST stops the seed. On the app side, a failed loans read (a 404 included) fails the pipeline with 502 "We couldn't load your loan details…" rather than assuming zero debt. Only a successful empty list means "no loans".
- **No identifiers printed.** The key, customer ID, account IDs and merchant IDs never appear in output. Full IDs go only to `.nessie-seed.local.json`, which is gitignored with mode 600.

### Data aging

Transactions are dated relative to the seed day (2–80 days old). The analyzer uses a rolling 90-day window, so results are exact only on the seed day. After about 5 days, records shift buckets, and the oldest leave the window soon after. To refresh, seed again with `--allow-duplicate` (a new customer) and update `NESSIE_CUSTOMER_ID`. Don't try to delete the old customer.

## Persona `sg-demo-subprime-01`

| | |
|---|---|
| Nessie customer | `SecondGear Demo sg-demo-subprime-01`, 1200 Demo Ave, Columbus OH 43215. The ID lives only in `.nessie-seed.local.json` and `.env.local` |
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
