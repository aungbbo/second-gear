# Apify: live used-car listings

Step 3 of the pipeline finds used cars for sale near the buyer. With `APIFY_MODE=live` it runs the AutoTrader listings Actor [`caffein.dev/autotrader-com-actor`](https://apify.com/caffein.dev/autotrader-com-actor) on Apify. With `APIFY_MODE=mock` it returns the seeded demo listings. There is no default, and a live failure never falls back to mock listings.

## Setup

Set these in `.env.local` (server-only; never `NEXT_PUBLIC_`):

| Variable | Notes |
|---|---|
| `APIFY_MODE` | `live` or `mock`. Required |
| `APIFY_API_TOKEN` | Required for `live`. Sent only in the `Authorization` header, never in a URL or log |
| `APIFY_LISTINGS_ACTOR_ID` | Optional, default `caffein.dev/autotrader-com-actor`. The mapper is written for this Actor's dataset schema; another Actor needs its own mapper |
| `APIFY_SEARCH_RADIUS_MILES` | Optional, default `50`. One of the Actor's values: 10, 25, 50, 75, 100, 200, 300, 400, 500 |
| `APIFY_MAX_ITEMS` | Optional, default `25` (1–100). Listings per run, and the main driver of cost |
| `APIFY_MAX_CHARGE_USD` | Optional, default `0.25` (at most 5). Apify stops the run at this spend |
| `APIFY_RUN_TIMEOUT_SECS` | Optional, default `120` (1–300). Apify's synchronous endpoint stops at 300 s |

Invalid values fail the request with 503 and a config error; they are never replaced with defaults.

## Cost

The Actor charges per event: about **$0.003 per listing** plus $0.00005 per run start (per its pricing on 2026-10-24). A default run of 25 listings costs about $0.08, and `APIFY_MAX_CHARGE_USD` caps it. **Every pipeline run in live mode starts a billed Actor run**, and runs are never retried. Keep public demos on `mock`.

## Flow

1. **Search input** (`src/lib/apify/search.ts`), built from the buyer's need and the earlier steps:
   - `zip` and `searchRadius`.
   - `maxPrice`: what the safe monthly payment (`affordability.maxSustainablePayment`) finances at the best estimated APR over 72 months, plus 20% headroom and the down payment. The headroom keeps a few over-budget cars in the results so the true-cost step has tradeoffs to flag, as with the mock. `minPrice` is $3,000.
   - Only explicit signals from the description: a single named make becomes `keyword`, a body style word (SUV, truck, minivan, hatchback, wagon, convertible, coupe, sedan) becomes `vehicleStyleCode`, and "hybrid" or "electric" becomes `fuelTypeGroup`. The free text itself is never sent, so a vague description can't empty the results.
2. **Run** (`src/lib/apify/client.ts`): `POST /v2/acts/{actor}/run-sync-get-dataset-items` with `timeout`, `maxItems`, `maxTotalChargeUsd`, `format=json` and `clean=true`. One call, never retried.
3. **Mapping** (`src/lib/apify/mapper.ts`) to `CarListing`. Items that can't be shown honestly are dropped and counted in a server warning (counts only):
   - **incomplete:** no listing id, year, make, model, sale price, mileage, or seller city/state
   - **notUsed:** `listingType` is `NEW`
   - **noMpg:** no city/highway MPG and the model isn't in the catalog
   - **duplicates:** same listing id or VIN

   If nothing survives, the pipeline answers 422 with "We couldn't find used cars for sale near your ZIP code in your price range."

### Field mapping

| `CarListing` | From the Actor | Notes |
|---|---|---|
| `id` | `listingId` | prefixed `at_` |
| `year`, `make`, `model`, `mileage` | same names | required |
| `price` | `salePrice` | required, > 0 |
| `trim` | `trim` | empty when missing |
| `bodyStyle` | `bodyStyle` | else catalog, else `Vehicle` |
| `dealerName` | `sellerName` | else `Private seller` |
| `city`, `state` | `sellerCity`, `sellerState` | required |
| `daysOnMarket` | `daysOnSite` | `0` when missing, which keeps the walk-away margin at its most conservative |
| `mpgCombined` | `mpgCity`, `mpgHighway` | EPA combined (55% city / 45% highway); else the catalog value |
| `reliabilityScore` | — | AutoTrader has no reliability rating. Catalog score for the model, else the average for the make, else a neutral `3` |
| `vin` | `vin` | upper-cased; empty when missing |
| `accentHue` | — | derived from the listing id, cosmetic only |

Seller phone, images, and other personal or bulky fields are never read.

## Errors

| Situation | Kind | HTTP from `/api/pipeline` |
|---|---|---|
| `APIFY_MODE` unset or a setting invalid | `config` | 503 |
| 401/403 from Apify (bad token) | `auth` | 502 |
| 404 (Actor not found) | `not_found` | 502 |
| 402 (usage limit or out of credit) | `quota` | 503 |
| 429 | `rate_limited` | 503 |
| 408, or no answer within the timeout | `timeout` | 504 |
| other non-2xx, network error | `upstream` | 502 |
| body not JSON, or not an array | `invalid_response` | 502 |
| no usable listings | `no_listings` | 422 |

The buyer sees a fixed message. Logs get the kind plus a scrubbed detail (HTTP status and Apify's error type), never the token or request URL.

## Testing

```bash
npm test                                   # unit tests; no network
APIFY_LIVE_TEST=1 APIFY_MODE=live APIFY_API_TOKEN=... npm test -- apify.live   # ONE billed run (≈ $0.03)
```

The live test runs the Actor once with 10 listings and a $0.10 cap. Vitest doesn't read `.env.local`, so export the variables in your shell.

## Limitations

- The dataset schema comes from the Actor's declared schema; the mapping has been checked against it, not yet against a real run. Run the live test once before a demo.
- `reliabilityScore` for models outside the catalog is an estimate, as described above.
- Listings are a snapshot at search time and can already be sold.
- Review AutoTrader's terms before any production use.
