# Bitdeer search plan → Apify listings

How a buyer's request becomes a live listings search, and the interface a Bitdeer AI planner must implement. **Status:** only the deterministic mock planner exists. Nothing here calls Bitdeer yet, and the Next.js runtime does **not** use Apify MCP: it calls the Apify REST API directly through `src/lib/apify/client.ts`. Apify MCP was used only to investigate and test the Actor during development.

## Flow

```
buyer need ──► SearchPlanner ──► VehicleSearchPlan ─┐
                (mock today,                        ├─► buildSearchInput ─► Apify Actor run ─► mapper ─► CarListing[]
                 Bitdeer later)                     │   (src/lib/apify/search.ts)
affordability assessment ─► AffordableSearchConstraints ┘
```

1. `POST /api/pipeline` calls `getSearchPlanner()({ need })` **first**, before the credit pull.
2. `assertSearchablePlan(plan)` stops a live search with no make (`missing_make`, HTTP 422) before any credit pull or paid run.
3. After the credit pull and cash-flow analysis, `searchLiveListings(need, affordability, credit, { constraints, plan })` builds the Actor input from the plan **and** the affordability constraints. When the assessment's maximum affordable price is $3,000 or less, it stops with `no_affordable_price` (HTTP 422) and starts no paid run.

## Financial limits are deterministic

Price ceiling, minimum price, ZIP and radius come only from `BuyerNeed` and `AffordableSearchConstraints`, which `assessAffordability` and `buildAffordableSearchConstraints` compute in code from the buyer's own numbers. The plan type has no field for any of them, and `normalizePlan` (`src/lib/search-plan/index.ts`) rebuilds every plan from its known fields before use, so anything extra a model returns (a `priceMax`, a ZIP, an unknown body style, an out-of-range year) is dropped. A plan's year and mileage limits can only narrow the search. No AI output can raise the price ceiling or turn a no-room result into a search.

## The interface

Defined in `src/lib/search-plan/types.ts`:

```ts
export type PlanBodyStyle = "sedan" | "suv" | "truck" | "van" | "hatchback" | "wagon" | "convertible" | "coupe";
export type PlanFuelType = "hybrid" | "electric";

export interface VehicleSearchPlan {
  source: "mock" | "bitdeer";
  make: string | null;        // one manufacturer, e.g. "Toyota"; null when none or several are named
  model: string | null;       // e.g. "Corolla"; null searches every model of the make
  bodyStyles: PlanBodyStyle[];// kept after the scrape; [] keeps all
  fuelTypes: PlanFuelType[];  // kept after the scrape; [] keeps all
  minYear: number | null;
  maxMileage: number | null;
}

export interface SearchPlanInput {
  need: BuyerNeed;
}

export type SearchPlanner = (input: SearchPlanInput) => Promise<VehicleSearchPlan>;
```

## Rules for a Bitdeer planner

- **Implement `SearchPlanner`** (for example `bitdeerSearchPlanner` in `src/lib/search-plan/bitdeer.ts`) and return it from `getSearchPlanner()` in `src/lib/search-plan/index.ts`. Nothing else in the pipeline needs to change.
- **Make.** When the buyer names exactly one make, use it. When they name none, the Bitdeer planner **may recommend** one that fits the request (for example a reliable, cheap-to-run commuter), returned with `source: "bitdeer"`; otherwise return `make: null` and the app asks the buyer. When they name several, pick at most one and only if the request supports it. The code itself never fills in a default: the Actor's own default is BMW. The mock planner never recommends: it returns `make: null` (→ `missing_make`) whenever the buyer names no single make.
- **Telling the buyer.** `VehicleSearchPlan` has no field yet that marks a make as recommended rather than requested. If the UI should say "we searched Toyota because…", add an optional field (for example `makeRecommended: boolean` plus a short reason) to the type and to `normalizePlan`; that is an additive change.
- **Don't set money or location.** The plan has no price, ZIP or radius fields on purpose, and extra fields are discarded (see above).
- **Year and mileage only narrow.** Where the plan and the buyer's search preferences both set one, the stricter wins.
- **Use only the enum values above** for body style and fuel type; they are matched against each listing after the scrape.
- **Don't throw for a vague request.** Return an empty plan (`make: null`, empty arrays, nulls). Throw only for a real failure (timeout, bad response), which the route reports as an error. Never fall back to the mock silently.
- Set `source: "bitdeer"`.

### Example

Buyer: *"I need a reliable used Toyota Corolla for commuting around Sacramento. I prefer a sedan from 2017 or newer, under 100,000 miles, and something affordable to maintain."*

```json
{
  "source": "bitdeer",
  "make": "Toyota",
  "model": "Corolla",
  "bodyStyles": ["sedan"],
  "fuelTypes": [],
  "minYear": 2017,
  "maxMileage": 100000
}
```

With ZIP 95823, a $17,000 maximum affordable price and the default 50-mile radius, this becomes the Actor input that was tested live (run `fW2UhtNyQQmOJGGL9`, 5 of 5 listings mapped):

```json
{ "make": "Toyota", "model": "Corolla", "yearMin": 2017, "yearMax": 2027, "priceMax": 17000,
  "mileageMax": 100000, "zip": "95823", "searchRadius": 50, "condition": "USED", "maxItems": 25 }
```

"Reliable" and "affordable to maintain" have no Actor field. Ranking already weighs reliability (catalog score) and ownership cost after the search.

## Tests a Bitdeer planner should pass

`src/lib/search-plan/__tests__/mock.test.ts` shows the expected behaviour: the Corolla request above, `make: null` for a vague request and for several makes, and body style and fuel mapping. Run `npm test -- search-plan apify pipeline`.
