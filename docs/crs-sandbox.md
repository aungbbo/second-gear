# CRS sandbox: soft-pull credit

Step 1 of the pipeline pulls a **prequalification (soft-pull)** credit report from the CRS Credit API sandbox when `CRS_MODE=live`, and uses the seeded demo mock when `CRS_MODE=mock`. There is no default, and a live failure never falls back to mock numbers.

The source of truth is the "CRS Credit API — CalHacks Sandbox" OpenAPI spec and the guides in `@crscreditapi/crs-calhacks-mcp-server`.

## Setup

Set these in `.env.local` (server-only; never `NEXT_PUBLIC_`):

| Variable | Notes |
|---|---|
| `CRS_MODE` | `live` or `mock` |
| `CRS_USERNAME`, `CRS_PASSWORD` | Sandbox credentials from the CRS team. **Quote the password.** |
| `CRS_TEST_PERSONA` | `P05` (the only allowlisted persona) |
| `CRS_PERSONA_SSN` | P05's 9-digit sandbox SSN from the CRS persona list. Not committed |
| `CRS_BUREAU`, `CRS_CONFIG`, `CRS_BASE_URL` | Optional. Defaults: `experian`, `exp-prequal-vantage4`, `https://api-sandbox.stitchcredit.com/api` |
| `CONSENT_SIGNING_SECRET` | Optional, 32+ chars. Otherwise each server process uses a random secret |

The account needs the bureau role for the bureau you call:

| Bureau | Role |
|---|---|
| Experian | `ROLE_EXP_CP` |
| TransUnion | `ROLE_TU_CR` |
| Equifax | `ROLE_EFX` |

Without the role, calls fail with 401 `CRS111`.

## Flow

1. **Consent.** The buyer approves on the consent step, and the browser `POST`s `/api/consent` with `{ softPullAuthorized: true, textVersion: "soft-pull-v1" }`.
   - The server mints an HMAC-signed token stamped with **its own clock**. The client never supplies a timestamp.
   - `/api/pipeline` refuses (400) unless the token is validly signed, uses the current text version, is under 15 minutes old, and has not been used before.
   - No provider (CRS, Nessie, listings, ranking) runs before this check.
2. **Login.** `POST /users/login` happens **at most once per server process**, and concurrent requests share it.
   - **A failed login is never retried.** CRS disables an account after repeated failed logins (`CRS113` then `CRS114`), so the process latches the failure. Fix the credentials and restart.
   - The token is cached in memory only and refreshed only within 60 s of expiry (an earlier refresh returns `CRS117`).
3. **Report.** `POST /experian/credit-report/standard/exp-prequal-vantage4` with the persona's documented body, fields at the root. Never retried.
4. **Outcome checks** happen in this order, because CRS answers 200 even for failures:
   1. `errorMessages` (`E1005` means the wrong config or no access to the bureau)
   2. `creditFiles[].creditFileDetail` (no file, or a frozen file)
   3. **`responseDetail.creditPullType` must be `"Soft"`.** Anything else is discarded and the pipeline stops
   4. `scores[]`: no numeric score means "couldn't be scored". A score is never invented.

## What reaches the browser

`CreditReport` carries:
- the score
- the tier
- factors (utilization, payment history, collections/charge-offs, public records, inquiries, history length, account mix, and up to two bureau reason codes)
- an estimated APR range
- a summary

It never includes names, SSNs, dates of birth, addresses, account numbers, creditor names, or CRS request ids.

- **Estimated APR** comes from Second Gear's own table for the score band (`src/lib/crs/classify.ts`). It is an application-generated estimate, **not a lender offer or approval**, and is labelled that way wherever it's shown.
- **`hardInquiriesLast6mo` is `null`** for CRS reports. The CRS inquiry records don't say which inquiries were hard pulls, so the app doesn't invent a count. The inquiries factor reports the total and says so.

## Persona P05 (Ricky Dalton) and the Nessie persona

- **P05** is the CRS sandbox's "Subprime" applicant: maxed-out cards, late payments, two collections, heavy recent credit shopping. The sandbox documents a **540** score on all three bureaus and an expected `DECLINE` decision. Its identity is fake, lives server-side, and is never accepted from the browser.
- **P05 and the Nessie demo persona `sg-demo-subprime-02` are independently simulated sandbox identities.** They are not the same person, and their names and addresses differ: P05 is in Orlando, FL; the Nessie customer is in Columbus, OH. The demo combines them to show both data sources working together:
  - credit comes from CRS
  - cash flow comes from Nessie
  - affordability depends only on the Nessie data
  - the CRS score sets the estimated APR band (540 → deep subprime, 18–24%)
- Sandbox requests that don't match a persona reach a real vendor and are billable (`billable: true` in `GET /users/logs`). That is why only allowlisted personas can be pulled.
