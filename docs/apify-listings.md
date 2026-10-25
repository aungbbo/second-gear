# Apify: live used-car listings

Step 3 of the pipeline finds used cars for sale near the buyer. With `APIFY_MODE=live` it runs the Cars.com listings Actor [`skootle/cars-com-scraper`](https://apify.com/skootle/cars-com-scraper) on Apify. With `APIFY_MODE=mock` it returns the seeded demo listings. There is no default, and a live failure never falls back to mock listings.

What to search for comes from a **search plan** (`src/lib/search-plan/`), produced today by a deterministic mock planner and later by Bitdeer AI. See [bitdeer-search-plan.md](bitdeer-search-plan.md) for that handoff.

The Actor replaced `caffein.dev/autotrader-com-actor`, which stopped extracting listings: its run `LsvDXEItj2oKxpThV` (2026-10-25) succeeded with 0 items and logged `__NEXT_DATA__ script tag not found — page may be blocked or empty` on a 1.3 MB AutoTrader page.

## Setup

Set these in `.env.local` (server-only; never `NEXT_PUBLIC_`):

| Variable | Notes |
|---|---|
| `APIFY_MODE` | `live` or `mock`. Required |
| `APIFY_API_TOKEN` | Required for `live`. Sent only in the `Authorization` header, never in a URL or log |
| `APIFY_LISTINGS_ACTOR_ID` | Optional, default `skootle/cars-com-scraper`. The search input and mapper are written for this Actor; another Actor needs its own |
| `APIFY_SEARCH_RADIUS_MILES` | Optional, default `50`. One of 10, 25, 50, 100, 200, 500. Used when the buyer gives no radius |
| `APIFY_MAX_ITEMS` | Optional, default `25` (1–100). Listings per run, and the main driver of cost |
| `APIFY_MAX_CHARGE_USD` | Optional, default `0.25` (at most 5). Apify stops charging the run at this spend |
| `APIFY_RUN_TIMEOUT_SECS` | Optional, default `120` (1–240). Apify stops the run at this time; the app aborts it 10 s later if it is still going |
| `APIFY_MAX_RUNS_PER_HOUR` | Optional, default `10`. Paid runs started per rolling hour |
| `APIFY_DAILY_BUDGET_USD` | Optional, default `2` (at most 100, and at least `APIFY_MAX_CHARGE_USD`). Worst-case spend per rolling 24 h |
| `APIFY_MAX_CONCURRENT_RUNS` | Optional, default `2` (1–10) |
| `APIFY_CACHE_TTL_SECS` | Optional, default `900` (0–86400). An identical search within this window reuses the last result; `0` disables |

Invalid values fail the request with 503 and a config error; they are never replaced with defaults.

## Cost

The Actor charges per event: **$0.006 per listing record** on Apify's free tier ($0.004–0.0055 on paid tiers) plus **$0.005 per run start**, per its pricing on 2026-10-25. A default run of 25 listings costs about $0.155, within the default $0.25 cap. The one test run (5 listings) cost about $0.035.

Cost protection, from outermost to innermost:

1. **Cache:** an identical search (same Actor, search input and post-scrape filters) within `APIFY_CACHE_TTL_SECS` reuses the last result and starts no run. Only searches that produced listings are cached. Identical searches already running share that run.
2. **Cost guard** (`src/lib/apify/guard.ts`): a new run starts only while all of these hold. Otherwise the pipeline answers **429** with `Retry-After`:
   - fewer than `APIFY_MAX_CONCURRENT_RUNS` runs in flight;
   - fewer than `APIFY_MAX_RUNS_PER_HOUR` runs started in the last hour;
   - the runs started in the last 24 h, each counted at its full `APIFY_MAX_CHARGE_USD`, leave room for one more within `APIFY_DAILY_BUDGET_USD`. With the defaults that is 8 runs a day.

   Failed and empty runs count too: Apify may already have charged them.
3. **Per run, on Apify's side:** `maxTotalChargeUsd` (billing cap), the Actor input's `maxItems` (result cap), and `timeout`. The `maxItems` run option is sent too, but Apify applies it only to pay-per-result Actors.
4. **Deadline:** a run still going 10 s past its timeout is aborted, which stops further charges.

Runs are never retried. Keep public demos on `mock`.

## Flow

1. **Search plan** (`src/lib/search-plan/`), read from the buyer's description before the credit pull and rebuilt by `normalizePlan`, which drops unknown values and any extra field: one make, an optional model, body styles, fuel types, a minimum year and a mileage cap. In live mode a plan with no make stops the request with `missing_make` (422) before the credit pull or any paid run. Mock mode doesn't need a make.
2. **Search input** (`src/lib/apify/search.ts`). Every field is always sent, because the Actor fills missing ones with its own defaults (`make: "BMW"`, `model: "3 Series"`, years 2020–2024):
   - `make`, `model` from the plan; `model` is `""` when the plan has none.
   - `priceMax`: the affordability assessment's `maxAffordableVehiclePrice` (via `AffordableSearchConstraints.maxPrice`), which already allows for ownership costs, the emergency reserve and dealer fees. It is computed in code; no plan can change it. When it is $3,000 or less, the search stops with `no_affordable_price` and **no paid run starts**. There is no looser fallback ceiling.
   - `yearMin`, `mileageMax`: the stricter of the plan and the buyer's search preferences; otherwise 1990 and `0` (no cap). `yearMax` is next year.
   - `zip`; `searchRadius`: the buyer's radius, else `APIFY_SEARCH_RADIUS_MILES`.
   - `condition: "USED"`, `maxItems`.
3. **Run** (`src/lib/apify/client.ts`), using the asynchronous run API:
   1. `POST /v2/acts/{actor}/runs?timeout&maxItems&maxTotalChargeUsd&waitForFinish=60` with the search input as the body.
   2. While the run isn't finished: `GET /v2/actor-runs/{id}?waitForFinish=…`, up to the deadline; past it, `POST /v2/actor-runs/{id}/abort`.
   3. `GET /v2/datasets/{datasetId}/items?format=json&clean=true&limit=…`.

   `SUCCEEDED` returns all items. `TIMED-OUT`, or aborted at the deadline, returns the items collected so far (logged as partial), or a timeout error when there are none. `FAILED`, or aborted by someone else, is an error.
4. **Mapping** (`src/lib/apify/mapper.ts`) to `CarListing`. Items that can't be shown honestly are dropped and counted in a server warning (counts only):
   - **incomplete:** no listing id, year, make, model, numeric price, numeric mileage, or dealer city/state
   - **filtered:** priced under $3,000 (the Actor has no minimum price), or not one of the plan's body styles or fuel types (the Actor has no filter for either)
   - **noMpg:** no city MPG and the model isn't in the catalog
   - **duplicates:** same listing id or VIN

### Field mapping

Checked against the dataset of test run `fW2UhtNyQQmOJGGL9` (5 of 5 mapped; kept in `src/lib/apify/__tests__/carscom-run.ts`).

| `CarListing` | From the Actor | Notes |
|---|---|---|
| `id` | `listingId` | prefixed `cc_` |
| `year`, `make`, `model` | same names | required |
| `price` | `priceUsd` | required, > 0. The string `price` is never read |
| `mileage` | `mileageMiles` | required. The string `mileage` is never read |
| `trim` | `trim` | empty when missing |
| `bodyStyle` | `bodyStyle` | else catalog, else `Vehicle` |
| `dealerName` | `dealer.name` | else `Private seller` |
| `city`, `state` | `dealer.city`, `dealer.state` | required |
| `daysOnMarket` | `listedAt` | whole days since; `0` when missing, which keeps the walk-away margin at its most conservative |
| `mpgCombined` | `mpgCity`, `mpgHighway` | EPA combined (55% city / 45% highway); city only when highway is missing; else the catalog value. A highway-only figure is never used |
| `reliabilityScore` | — | Catalog score for the model, else the average for the make, else a neutral `3` |
| `vin` | `vin` | upper-cased; empty when missing |
| `accentHue` | — | derived from the listing id, cosmetic only |
| `listingUrl` | `listingUrl` | only an `https` link on `cars.com`; omitted otherwise. Shown as **View listing** (new tab) when a result is expanded. Mock listings have none |

Dealer phone and address, photos, the Actor's `agentMarkdown`, and other bulky fields are never read.

## Errors

| Situation | Kind | HTTP from `/api/pipeline` |
|---|---|---|
| `APIFY_MODE` unset or a setting invalid | `config` | 503 |
| live search plan names no single make | `missing_make` | 422 |
| assessment leaves no price above $3,000 | `no_affordable_price` | 422 |
| cost guard refused a new run | `budget` | 429 + `Retry-After` |
| 401/403 from Apify (bad token) | `auth` | 502 |
| 404 (Actor not found) | `not_found` | 502 |
| 402 (usage limit or out of credit) | `quota` | 503 |
| 429 | `rate_limited` | 503 |
| 408, a request with no answer, or a run that timed out with no items | `timeout` | 504 |
| run `FAILED`, other non-2xx, network error | `upstream` | 502 |
| body not JSON, run object or dataset malformed | `invalid_response` | 502 |
| run finished with 0 items | `empty_result` | 503, not cached |
| items came back but none was usable or matched the plan | `no_listings` | 422 |

An empty run is reported as inconclusive ("we can't tell yet whether matching cars are for sale"), never as "no cars for sale": a broken scraper and a search with no matches look identical. Logs get the kind plus a scrubbed detail (HTTP status, Apify's error type, counts), never the token or request URL.

## Testing

```bash
npm test                                   # unit and route tests; no network
APIFY_LIVE_TEST=1 APIFY_MODE=live APIFY_API_TOKEN=... npm test -- apify.live   # ONE billed run (≈ $0.065)
```

The tests use a fake Apify API (`src/lib/apify/__tests__/fake-apify.ts`) and the real dataset from run `fW2UhtNyQQmOJGGL9`. The live test runs the Actor once with 10 listings and a $0.10 cap, and prints only counts. Vitest doesn't read `.env.local`, so export the variables in your shell.

## Limitations

- **One live run so far** (Toyota Corolla near 95823). Searches with no model (`model: ""`), other makes, other radii, and EVs are untested against the real Actor.
- `condition: "USED"` may leave out certified pre-owned cars, which the Actor lists under a separate `CPO` value; the input takes one value.
- The Actor returns no vehicle history, deal rating, or distance (`dealer.distanceMi` was null). Its `drivetrain` can be wrong (two front-wheel-drive Corollas came back as "Rear-wheel Drive"); the app doesn't use it.
- Body style and fuel type are filtered after the scrape, so filtered-out listings are still charged.
- A buyer whose assessment leaves $3,000 or less gets no live listings at all (by design, no paid run starts), only the no-room message.
- **The cost guard and cache live in each server instance's memory.** On serverless hosting every instance has its own counters, so the real ceiling is the limits × the number of instances, and a cold start resets them. Move them to shared storage before a public live deployment. Apify's per-run caps and your Apify account's usage limit apply regardless.
- `reliabilityScore` for models outside the catalog is an estimate, as described above.
- Listings are a snapshot at search time and can already be sold.
- Review Cars.com's terms before any production use.
