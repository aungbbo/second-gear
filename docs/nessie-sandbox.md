# Nessie sandbox: demo data

Second Gear reads cash flow from the Capital One Nessie sandbox (`NESSIE_MODE=live`). A fresh sandbox key has no data, so the pipeline answers 422 until a customer is seeded. `scripts/nessie-seed.mjs` creates one demo persona. It is development-only: the app never imports it. The app's only writes are the Banking tab's "+ Deposit / + Transaction / + Recurring bill" buttons (see below).

## Seeding

```bash
npm run nessie:seed                    # 1. dry run: no network; prints the plan and every payload
npm run nessie:seed -- --preflight     # 2. read-only: duplicate-persona and merchant checks
npm run nessie:seed -- --apply --canary-only   # 3. writes: NEW customer + accounts + 5 canaries (one per record shape), then stop
npm run nessie:seed -- --apply --resume        # 4. writes: the remaining records
```

If an apply stops partway, the manifest keeps `complete: false` and the ids it created. Don't start over; resume in place:

```bash
npm run nessie:seed -- --resume                          # read-only: verifies the partial seed, shows what's missing
npm run nessie:seed -- --apply --resume --canary-only    # at most 5 POSTs: one record of each shape, listed back, then stop
npm run nessie:seed -- --apply --resume                  # posts only the missing records
```

Resume never creates a customer, account or merchant. It refuses when the manifest is complete or belongs to another persona, when its customer or accounts aren't visible with this key, or when the partial seed holds duplicate or unrecognised records. Records are matched by their `sg-seed:` label, so nothing is posted twice.

`--apply` never overwrites an existing `.nessie-seed.local.json`, not even with `--allow-duplicate`. Resume it, or archive it first, for example `mv .nessie-seed.local.json .nessie-seed.<persona>.broken.local.json`. Archives match the gitignore pattern `/.nessie-seed*.local.json`.

### What the live sandbox actually enforces

The deployed API is stricter than the SDKs. These rules were learned the hard way and are now covered by the mock server's tests:

**`status` is required on transaction creates.** The SDKs mark it optional, but the live sandbox rejects a deposit without it: `HTTP 400 — "1 validation error for DepositCreate / status / field required"`. Deposits, withdrawals and purchases therefore send `status: "completed"`, and the canary and read-back check that it round-trips. Payloads are also kept ASCII-only. Failed requests print Nessie's scrubbed, clipped response body and record it as `lastError` in the manifest.

**Bills: send `recurring_date`, never `upcoming_payment_date`, and seed only recurring bills.** The sandbox's bill rules don't fit together:
- `GET /accounts/{id}/bills` (and `/customers/{id}/bills`) validates every stored bill and answers `HTTP 400 — "2 validation errors for Bill / recurring_date / upcoming_payment_date field required"` for the whole collection if even one bill lacks them.
- `POST /bills` refuses `upcoming_payment_date` (`"1 validation error for BillCreate / upcoming_payment_date / extra fields not permitted"`). The server computes it, evidently only for bills that recur.

So the seed posts just the two recurring bills (rent, internet) with `recurring_date` (the due day) and `payment_date` (the last due date). The canary and read-back check that the server returns an `upcoming_payment_date` that is a real date on the due day, after `payment_date`. The three one-off electric payments are seeded as **checking ACH withdrawals** (same dates and amounts). The analyzer averages withdrawals over the 90-day window exactly as it does one-off bills, so essentials stay $1,530/mo and affordability is unchanged.

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
- **Canaries for every record shape.** Before any bulk write, the script posts one deposit, one withdrawal, one recurring bill, one purchase and one loan. After each, it lists that collection back. If the list fails, any sent field (date, amount, label, status…) changed, or a bill's server-computed `upcoming_payment_date` is missing or off its due day, it stops with exit code 3. This is what would have caught the bill issue before it broke a customer.
- **Every created id is saved.** `manifest.recordIds` holds the id of each transaction, keyed by stream and `sg-seed:` label, alongside the customer, account and merchant ids.
- **Read-back.** After writing, every collection is fetched again and compared with the dataset. Mismatches are reported by field name.
- **Loans are required.** `POST`/`GET /accounts/{id}/loans` are documented Nessie endpoints. A failed loan POST stops the seed. On the app side, a failed loans read (a 404 included) fails the pipeline with 502 "We couldn't load your loan details…" rather than assuming zero debt. Only a successful empty list means "no loans".
- **No identifiers printed.** The key, customer ID, account IDs and merchant IDs never appear in output. Full IDs go only to `.nessie-seed.local.json`, which is gitignored with mode 600.

### Data aging

Transactions are dated relative to the seed day (2–80 days old). The analyzer uses a rolling 90-day window, so results are exact only on the seed day. After about 5 days, records shift buckets, and the oldest leave the window soon after. To refresh, seed again with `--allow-duplicate` (a new customer) and update `NESSIE_CUSTOMER_ID`. Don't try to delete the old customer.

## Banking tab writes and balances

The Banking tab posts deposits, withdrawals, transfers and recurring bills to the customer's checking account (`POST /api/nessie/accounts/{deposit,withdrawal,transfer,bill}`). Each is a single, never-retried POST. Transfers go checking → savings only.

**`GET /accounts/{id}/transfers` answers 404 "No transfers found for this account" instead of `200 []` when an account has none yet, and each listed record is keyed `id`, not `_id` like every other resource** (both verified 2026-10-24). `getAccountTransfers` in `src/lib/nessie/client.ts` treats that specific 404 as an empty list and remaps `id` → `_id` before validating — otherwise every transfer gets silently dropped as unidentifiable.

**`POST /accounts/{id}/transfers` has no field for the destination account** (verified 2026-10-24). `TransferCreate` accepts `status`, `transaction_date`, `amount` and `description`, but rejects `medium`, `payee_id`, `transfer_to_id` and `toAccountId` as extra fields, and a destination passed as a `?payee_id=` query param is silently ignored — `GET /transfers/{id}` afterward shows no trace of it. So a transfer record never says where the money went. Since this demo customer has exactly one savings account and `postTransfer` only ever moves checking → savings, `withPostedActivity` and `buildAccountsView` in `src/lib/nessie/account-view.ts` credit that single savings account by convention whenever a transfer's `payee_id` is absent, rather than relying on the sandbox to record it.

**The sandbox never moves an account's `balance` after the account is created.** A new deposit or withdrawal shows up in the ledger, but `balance` stays put. `PUT /accounts/{id}` can't fix it: without `nickname` it answers `HTTP 400 — "1 validation error for AccountUpdate / nickname / field required"`, and with `nickname` it answers 202 but silently ignores `balance` (verified 2026-10-24). So the app treats the stored balance as the opening balance and adds every deposit, withdrawal and purchase that isn't labeled `sg-seed:` (seeded history is already in the opening balance) and isn't `cancelled` (`withPostedActivity` in `src/lib/nessie/account-view.ts`). Total balance counts checking and savings only. Card balances are shown as owed. Withdrawals larger than the checking balance are refused before anything is posted. Deposits and withdrawals take whole dollars only, because the [OpenAPI spec](https://prod.nessieisreal.com/nessie-openapi-spec.yaml) types their `amount` as an integer (bill amounts are floats). The spec also confirms that `AccountUpdate` has a single field, `nickname`. The default host is the spec's production server, `https://prod-api.nessieisreal.com`, which serves the same data as the older `api.nessieisreal.com`.

## Personas in the sandbox

| Persona | State | Manifest |
|---|---|---|
| `sg-demo-subprime-01` | **Broken, do not use.** Fully posted (9 deposits, 3 withdrawals, 5 bills, 24 purchases, 1 loan), but its bills were posted without `upcoming_payment_date` (and the one-off ones also without `recurring_date`), so its bill list returns 400 forever (no PUT/DELETE allowed). The app correctly fails closed (502) on it | `.nessie-seed.sg-demo-subprime-01.broken.local.json` |
| `sg-demo-subprime-02` | **Seeded and verified (asOf 2026-10-24).** 9 deposits, 6 withdrawals, 2 recurring bills (server-computed `upcoming_payment_date` present), 24 purchases, 1 loan; read-back matches the dataset, and `/api/pipeline` returned 200 with $400 → 400/350 and $600 → 440/385. Results are exact only around the seed date (see Data aging) | `.nessie-seed.local.json` |

## Persona profile (`sg-demo-subprime-02`)

Records: 9 deposits, 6 withdrawals, 2 bills, 24 purchases, 1 loan.

| | |
|---|---|
| Nessie customer | `SecondGear Demo sg-demo-subprime-02`, 1200 Demo Ave, Columbus OH 43215. The ID lives only in `.nessie-seed.local.json` and `.env.local` |
| Accounts | Checking 1850 · Savings 2400 · Credit Card 1800 balance (all activity on checking) |
| Income | Payroll $1,650 biweekly + rideshare $150 monthly ≈ $3,450/mo, low volatility |
| Essentials | Rent $1,250 + internet $60 (recurring bills); electric ACH ~$98/mo and ATM cash $120/mo (withdrawals) ≈ $1,530/mo |
| Debt | Equipment loan $140/mo + card minimum ≈ $180/mo |
| Discretionary | Groceries, gas, diner ≈ $500/mo |
| Expected affordability | $400 budget → max $400 / recommended $350; $600 budget → max $440 / recommended $385 |

### Future CRS link

CRS integration is not implemented yet. When it is, the persona ID is the join key:

- The Nessie customer's `last_name` and the manifest's `persona` field both carry it.
- A future `CRS_TEST_PERSONA` setting will select the CRS sandbox identity for the same persona. That identity should be in the subprime band (580–619) and use the same name and address, so the soft pull and the cash-flow read describe one person.
- No IDs belong in this file or in git; keep them in `.env.local` and the manifest.
