# Bitdeer AI ranking

Bitdeer is called once after Apify returns listings. It receives every usable listing (up to the Actor's 25-item cap), the buyer's request and budget, identity-free CRS credit factors, bank-derived cash-flow aggregates, and the app's per-car loan and ownership-cost calculations. It returns the full best-to-worst order with a concise explanation for each listing. It is not involved in constructing the Apify Actor input.

```text
Buyer ZIP ──► fixed CARFAX input ──► Apify Actor
                                                                  │
CRS + bank aggregates + listing analyses ◄────────────────────────┘
                 │
                 ▼
           Bitdeer ranking ──► all listings ordered with explanations
```

`POST /api/pipeline` pulls CRS and Nessie aggregates, runs Apify, evaluates listing costs in application code, and then calls Bitdeer once to rank all usable results. If the model omits a candidate, application code appends it using the deterministic fallback order so no listing is lost. The UI initially shows the top three and lets the buyer expand the complete ranking.

## Financial data boundary

Bitdeer receives high-level credit and banking fields, plus the listing analyses needed to rank results. It does not receive SSN, names, account numbers, raw bureau payloads, or individual bank transactions.

The CARFAX input uses the user's ZIP. The app hardcodes item count (`25`), radius (`50`), and history options. No vehicle price is inferred from monthly payment capacity.

## CARFAX input construction

Live mode defaults to `parseforge/carfax-scraper`. The app builds this input directly from the ZIP:

```json
{
  "includeDealerContact": false,
  "includeHistory": true,
  "includePaymentEstimate": false,
  "includePriceHistory": false,
  "maxItems": 25,
  "radius": "50",
  "zipCode": "10001"
}
```

The Actor caps returned rows with `maxResults`. Returned listings are normalized and evaluated against the buyer's monthly payment capacity downstream.

## Important limits

- CARFAX's response depends on the postal code; it cannot guarantee availability or a price.
- Listings are a point-in-time snapshot and can change or sell.
- For current Actor input fields and billing, see the [CARFAX Actor page](https://apify.com/parseforge/carfax-scraper).
