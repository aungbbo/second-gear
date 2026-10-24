# Apify: live used-car listings

Step 3 of the pipeline finds used cars for sale near the buyer. With `APIFY_MODE=live` it runs the AutoTrader listings Actor [`caffein.dev/autotrader-com-actor`](https://apify.com/caffein.dev/autotrader-com-actor) on Apify. With `APIFY_MODE=mock` it returns the seeded demo listings. There is no default, and a live failure never falls back to mock listings.

## Setup

Set these in `.env.local` (server-only; never `NEXT_PUBLIC_`):

| Variable | Notes |
|---|---|
| `APIFY_MODE` | `live` or `mock`. Required |
| `APIFY_API_TOKEN` | Required for `live`. Sent only in the `Authorization` header, never in a URL or log |
| `APIFY_LISTINGS_ACTOR_ID` | Optional, default `caffein.dev/autotrader-com-actor`. The mapper is written for this Actor's dataset schema; another Actor needs its own mapper |
| `APIFY_SEARCH_RADIUS_MILES` | Optional, default `50`. One of 10, 25, 50, 100, 200, 500 (see [Filter codes](#filter-codes)) |
| `APIFY_MAX_ITEMS` | Optional, default `25` (1–100). Listings per run, and the main driver of cost |
| `APIFY_MAX_CHARGE_USD` | Optional, default `0.25` (at most 5). Apify stops charging the run at this spend |
| `APIFY_RUN_TIMEOUT_SECS` | Optional, default `120` (1–240). Apify stops the run at this time; the app aborts it 10 s later if it is still going |
| `APIFY_MAX_RUNS_PER_HOUR` | Optional, default `10`. Paid runs started per rolling hour |
| `APIFY_DAILY_BUDGET_USD` | Optional, default `2` (at most 100, and at least `APIFY_MAX_CHARGE_USD`). Worst-case spend per rolling 24 h |
| `APIFY_MAX_CONCURRENT_RUNS` | Optional, default `2` (1–10) |
| `APIFY_CACHE_TTL_SECS` | Optional, default `900` (0–86400). An identical search within this window reuses the last result; `0` disables |

Invalid values fail the request with 503 and a config error; they are never replaced with defaults.

## Cost

The Actor charges per event: **$0.003 per listing** on Apify's free tier ($0.002–0.0027 on paid tiers) plus $0.00005 per run start, per its pricing on 2026-10-24. Apify bills platform usage (compute) separately. A default run of 25 listings costs about $0.08.

Cost protection, from outermost to innermost:

1. **Cache:** an identical search (same Actor and search input) within `APIFY_CACHE_TTL_SECS` reuses the last result, including an empty one, and starts no run. Identical searches already running share that run.
2. **Cost guard** (`src/lib/apify/guard.ts`): a new run starts only while all of these hold. Otherwise the pipeline answers **429** with `Retry-After`:
   - fewer than `APIFY_MAX_CONCURRENT_RUNS` runs in flight;
   - fewer than `APIFY_MAX_RUNS_PER_HOUR` runs started in the last hour;
   - the runs started in the last 24 h, each counted at its full `APIFY_MAX_CHARGE_USD`, leave room for one more within `APIFY_DAILY_BUDGET_USD`. With the defaults that is 8 runs a day.

   Failed runs count too: Apify may already have charged them.
3. **Per run, on Apify's side:** `maxItems` and `maxTotalChargeUsd` (billing caps), the Actor input's `maxItems` (result cap), and `timeout`.
4. **Deadline:** a run still going 10 s past its timeout is aborted, which stops further charges.

Runs are never retried. Keep public demos on `mock`.

## Flow

1. **Search input** (`src/lib/apify/search.ts`), built from the buyer's need and the earlier steps:
   - `zip` and `searchRadius`.
   - `maxPrice`: what the safe monthly payment (`affordability.maxSustainablePayment`) finances at the best estimated APR over 72 months, plus 20% headroom and the down payment. The headroom keeps a few over-budget cars in the results so the true-cost step has tradeoffs to flag, as with the mock. `minPrice` is $3,000.
   - Only explicit signals from the description: a single named make becomes `keyword`, a body style word becomes `vehicleStyleCode`, and "hybrid" or "electric" becomes `fuelTypeGroup`. The free text itself is never sent, so a vague description can't empty the results.
   - `listingType` is not set. It takes a single value, and `USED` alone may leave out certified pre-owned cars, so the mapper drops new cars instead.
2. **Run** (`src/lib/apify/client.ts`), using the asynchronous run API:
   1. `POST /v2/acts/{actor}/runs?timeout&maxItems&maxTotalChargeUsd&waitForFinish=60` with the search input as the body.
   2. While the run isn't finished: `GET /v2/actor-runs/{id}?waitForFinish=…`, up to the deadline; past it, `POST /v2/actor-runs/{id}/abort`.
   3. `GET /v2/datasets/{datasetId}/items?format=json&clean=true&limit=…`.

   `SUCCEEDED` returns all items. `TIMED-OUT`, or aborted at the deadline, returns the items collected so far (logged as partial), or a timeout error when there are none. `FAILED`, or aborted by someone else, is an error. The synchronous endpoint isn't used: it returns 408 after 300 s and its docs say nothing about the run's fate.
3. **Mapping** (`src/lib/apify/mapper.ts`) to `CarListing`. Items that can't be shown honestly are dropped and counted in a server warning (counts only):
   - **incomplete:** no listing id, year, make, model, sale price, mileage, or seller city/state
   - **notUsed:** a `listingType` other than `USED`, `CERTIFIED`, or `3P_CERT`; or no type and a title starting "New"
   - **noMpg:** no city MPG and the model isn't in the catalog
   - **duplicates:** same listing id or VIN

### Filter codes

The Actor publishes two different code lists. Its README table gives `SUV`, `TRUCK`, `VAN`, `MINIVAN` and `ELC`. Its **input schema** (latest build), which Apify validates every run's input against, accepts only these:

| Buyer says | Field | Code | Schema label |
|---|---|---|---|
| SUV, crossover | `vehicleStyleCode` | `SUVCROSS` | SUV / Crossover |
| truck, pickup | `vehicleStyleCode` | `TRUCKS` | Truck |
| van, minivan | `vehicleStyleCode` | `VANMV` | Van / Minivan |
| hatchback / wagon / convertible / coupe / sedan | `vehicleStyleCode` | `HATCH` / `WAGON` / `CONVERT` / `COUPE` / `SEDAN` | same |
| hybrid | `fuelTypeGroup` | `HYB` | Hybrid |
| electric, EV | `fuelTypeGroup` | `ELE` | Electric |

The app uses the schema codes. For `searchRadius`, the schema accepts 10, 25, 50, 75, 100, 200, 300, 400, 500 and 0 (nationwide), while the README lists only 10, 25, 50, 100, 200, 500 and 0. The app allows only the radii both list, and never nationwide.

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
| `mpgCombined` | `mpgCity`, `mpgHighway` | EPA combined (55% city / 45% highway); city only when highway is missing; else the catalog value. A highway-only figure is never used |
| `reliabilityScore` | — | AutoTrader has no reliability rating. Catalog score for the model, else the average for the make, else a neutral `3` |
| `vin` | `vin` | upper-cased; empty when missing |
| `accentHue` | — | derived from the listing id, cosmetic only |
| `listingUrl` | `url` | only an `https` link on `autotrader.com`; omitted otherwise. Shown as **View listing** (new tab) when a result is expanded. Mock listings have none |

Seller phone, images, and other personal or bulky fields are never read.

## Errors

| Situation | Kind | HTTP from `/api/pipeline` |
|---|---|---|
| `APIFY_MODE` unset or a setting invalid | `config` | 503 |
| cost guard refused a new run | `budget` | 429 + `Retry-After` |
| 401/403 from Apify (bad token) | `auth` | 502 |
| 404 (Actor not found) | `not_found` | 502 |
| 402 (usage limit or out of credit) | `quota` | 503 |
| 429 | `rate_limited` | 503 |
| 408, a request with no answer, or a run that timed out with no items | `timeout` | 504 |
| run `FAILED`, other non-2xx, network error | `upstream` | 502 |
| body not JSON, run object or dataset malformed | `invalid_response` | 502 |
| search came back empty, or no listing was usable | `no_listings` | 422 |

The buyer sees a fixed message: an empty search names the radius and ZIP and suggests a nearby ZIP or another budget; "none usable" says the listings lacked the details needed. Logs get the kind plus a scrubbed detail (HTTP status, Apify's error type, counts), never the token or request URL.

## Testing

```bash
npm test                                   # unit and route tests; no network
APIFY_LIVE_TEST=1 APIFY_MODE=live APIFY_API_TOKEN=... npm test -- apify.live   # ONE billed run (≈ $0.03)
```

The tests use a fake Apify API (`src/lib/apify/__tests__/fake-apify.ts`) for run start, polling, abort and dataset reads. The live test runs the Actor once with 10 listings and a $0.10 cap, and prints only counts. Vitest doesn't read `.env.local`, so export the variables in your shell.

## Limitations

- **Not yet checked against a real run.** The mapping follows the Actor's declared dataset schema and README sample; the filter codes follow its input schema. Run the live test once before a demo.
- **The cost guard and cache live in each server instance's memory.** On serverless hosting every instance has its own counters, so the real ceiling is the limits × the number of instances, and a cold start resets them. Move them to shared storage (for example the Upstash Redis that the CRS branch adds) before a public live deployment. Apify's per-run caps and your Apify account's usage limit apply regardless.
- Whether AutoTrader honours the radii only the schema lists (75, 300, 400) is unverified.
- Electric cars: whether the Actor fills `mpgCity` for EVs (for example with MPGe) is unknown. If it doesn't, EVs outside the catalog are dropped as `noMpg`, and an "electric" search can end in "none usable".
- New-car listings are still charged by the Actor before the mapper drops them; under a subprime price ceiling they should be few.
- `reliabilityScore` for models outside the catalog is an estimate, as described above.
- Listings are a snapshot at search time and can already be sold.
- Review AutoTrader's terms before any production use.
