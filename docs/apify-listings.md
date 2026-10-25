# Apify: live used-car listings

Step 3 of the pipeline finds cars for sale near the buyer. With `APIFY_MODE=live` it runs ParseForge's CARFAX listings Actor [`parseforge/carfax-scraper`](https://apify.com/parseforge/carfax-scraper) on Apify. With `APIFY_MODE=mock` it returns seeded demo listings. There is no default, and a live failure never falls back to mock listings.

The Actor input uses the user's ZIP; radius (`50`), item cap (up to `10`), and history options are fixed by the app. The direct `startUrl` field is omitted because CARFAX treats it as overriding the ZIP search. Bitdeer only ranks and explains listings after Apify returns them. See [bitdeer-search-plan.md](bitdeer-search-plan.md) for the data flow.

## Setup

Set these in `.env.local` (server-only; never `NEXT_PUBLIC_`):

| Variable | Notes |
|---|---|
| `APIFY_MODE` | `live` or `mock`. Required |
| `APIFY_API_TOKEN` | Required for `live`. Sent only in the `Authorization` header, never in a URL or log |
| `APIFY_LISTINGS_ACTOR_ID` | Optional, default `parseforge/carfax-scraper`. The search input and mapper target this Actor |
| `APIFY_MAX_ITEMS` | Optional, default `10` (1–10). Listings per run, and the main driver of cost |
| `APIFY_MAX_CHARGE_USD` | Optional, default `1` (at most 5). Apify stops charging the run at this spend |
| `APIFY_RUN_TIMEOUT_SECS` | Optional, default `240` (1–240). Apify stops the run at this time; the app aborts it 10 s later if it is still going. CARFAX history enrichment can take longer |
| `APIFY_MAX_RUNS_PER_HOUR` | Optional, default `10`. Paid runs started per rolling hour |
| `APIFY_DAILY_BUDGET_USD` | Optional, default `2` (at most 100, and at least `APIFY_MAX_CHARGE_USD`). Worst-case spend per rolling 24 h |
| `APIFY_MAX_CONCURRENT_RUNS` | Optional, default `2` (1–10) |
| `APIFY_CACHE_TTL_SECS` | Optional, default `900` (0–86400). An identical search within this window reuses the last result; `0` disables |

Invalid values fail the request with 503 and a config error; they are never replaced with defaults.

## Cost

The Actor currently lists a base price of **$0.03066 per result**, so 10 listings cost about $0.31 before optional paid extras. Vehicle history adds requests and runtime. Check [the Actor's current pricing](https://apify.com/parseforge/carfax-scraper) before a demo; the per-run maximum spend remains capped by `APIFY_MAX_CHARGE_USD`.

Cost protection, from outermost to innermost:

1. **Cache:** an identical search (same Actor, search input and post-scrape filters) within `APIFY_CACHE_TTL_SECS` reuses the last result and starts no run. Only searches that produced listings are cached. Identical searches already running share that run.
2. **Cost guard** (`src/lib/apify/guard.ts`): a new run starts only while all of these hold. Otherwise the pipeline answers **429** with `Retry-After`:
   - fewer than `APIFY_MAX_CONCURRENT_RUNS` runs in flight;
   - fewer than `APIFY_MAX_RUNS_PER_HOUR` runs started in the last hour;
   - the runs started in the last 24 h, each counted at its full `APIFY_MAX_CHARGE_USD`, leave room for one more within `APIFY_DAILY_BUDGET_USD`. With the defaults that is 8 runs a day.

   Failed and empty runs count too: Apify may already have charged them.
3. **Per run, on Apify's side:** `maxTotalChargeUsd` (billing cap), the Actor input's `maxItems` (result cap, at most 10), and `timeout`. The `maxItems` run option is sent too, but Apify applies it only to pay-per-result Actors.
4. **Deadline:** a run still going 10 s past its timeout is aborted, which stops further charges.

Runs are never retried. Keep public demos on `mock`.

## Flow

1. **Build Actor input** (`src/lib/apify/search.ts`): use the submitted ZIP and hardcode the other Actor fields. History is enabled; paid dealer-contact, payment-estimate, and price-history extras are disabled.
2. **Search input** (`src/lib/apify/search.ts`): the app uses the submitted ZIP and a result cap of at most 10. Monthly cash flow alone is not converted into `maxPrice`, because that would require an APR and loan term. The app evaluates individual listings against the buyer's monthly payment capacity afterward.
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

The mapper consumes CARFAX rows; the historical Cars.com fixtures remain for compatibility.

| `CarListing` | From the Actor | Notes |
|---|---|---|
| `id` | `carfaxId`, VIN, stock number, or URL | prefixed `cf_` |
| `year`, `make`, `model` | same names | required |
| `price` | `currentPrice`, then `listPrice` | required, > 0 |
| `mileage` | `mileage` | required |
| `trim` | `trim` | empty when missing |
| `bodyStyle` | `bodyStyle` | else catalog, else `Vehicle` |
| `dealerName` | `dealerName` | else `Dealer details unavailable` |
| `city`, `state` | `dealerCity`, `dealerState` | required |
| `daysOnMarket` | `firstSeen` | calculated from listing age; `0` when missing |
| `mpgCombined` | `mpgCombined`, then city/highway MPG | else the vehicle catalog |
| `reliabilityScore` | — | Catalog score for the model, else the average for the make, else a neutral `3` |
| `vin` | `vin` | upper-cased; empty when missing |
| `accentHue` | — | derived from the listing id, cosmetic only |
| `listingUrl` | `url` | only an `https` link on CARFAX; omitted otherwise |
| `carfaxHistory` | accident, owner, and service history fields | passed to Bitdeer; absent signals remain unknown |

Dealer phone and address, photos, the Actor's `agentMarkdown`, and other bulky fields are never read.

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

- CARFAX input/output is wired to the current Actor schema; a live run is still needed to validate the account's actual response shape.
- History enrichment adds per-vehicle requests and runtime. The per-run spend cap is set to $1 by default so a 10-result run can fit the Actor's current base pricing.
- **The cost guard and cache live in each server instance's memory.** On serverless hosting every instance has its own counters, so the real ceiling is the limits × the number of instances, and a cold start resets them. Move them to shared storage before a public live deployment. Apify's per-run caps and your Apify account's usage limit apply regardless.
- `reliabilityScore` for models outside the catalog is an estimate, as described above.
- Listings are a snapshot at search time and can already be sold.
- Review CARFAX's and Apify's terms before any production use.
