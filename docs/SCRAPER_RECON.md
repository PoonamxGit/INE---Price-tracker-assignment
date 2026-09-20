# Scraper reconnaissance

Inspected only https://demo.inelabteamdev.com/ on 2026-09-19. These are development observations, not promises that the store will never change. No retailer or third-party product source was used.

## Rendering and metadata

The homepage returned HTTP 200 with a 459-byte document: title `INE Store`, empty `#root`, and module `/assets/index-B9UiQq4X.js`. No products, prices or structured product JSON existed in that initial HTML. The served JavaScript was inspected before implementing extraction.

Observed application requests:

| Endpoint                             | Observed behavior                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `GET /api/catalog?page=N&pageSize=N` | Catalog metadata, total, pages, pageSize, items                                                 |
| `GET /api/product/257`               | Stable numeric ID, slug, name, SKU, brand, category, description, specs, reviews; no live price |
| `GET /api/product/999999`            | HTTP 404, `{"error":"not_found"}`                                                               |
| `GET /api/layout`                    | Rotating class mapping, price tag/carrier, facet order, revision and expiry                     |
| `GET /api/challenge`                 | Timestamp and session challenge material                                                        |
| `POST /api/session`                  | Challenge exchange performed by the site's own browser code; observed both 401 and 200          |
| `GET /api/products/257/price`        | Browser's authenticated quote request; observed 200 and actual 503 responses                    |

Tokens and challenge bodies are not stored. The scraper does not call or decode the protected price endpoint itself. It lets the store's JavaScript perform its normal exchange and extracts the final visible result.

The store route is `/product/:id`, not its slug. Product 257 was `Ironwood Smartwatch Max`, SKU `IRO-10257`; 763 was `Cobalt Charging Pad X`, SKU `COB-10763`. Catalog thumbnails are rendered category artwork rather than image URLs. We return `imageUrl: null` and do not invent product photos.

## Catalog/search behavior

The frontend's listing uses pagination; source inspection found no name-search endpoint. `/api/catalog?page=1&pageSize=2` advertised 1,000 total products and 500 pages. Requesting pageSize=100 returned pageSize=60 and 17 pages. Page 17 had 40 items.

A live test disproved the assumption that ordinary pagination enumerates the catalog: two immediate requests to **the same page** returned different product IDs. Every request is reshuffled. A single pass produces duplicates and misses products. A faster repeat-discovery implementation hit actual HTTP 429 responses.

Final strategy: one shared, sequential discovery task, 1.2-second spacing, bounded retries (30-second cooldown for 429), deduplication by observed ID, and completion only when unique count equals the advertised total. Search returns progressively discovered real matches plus coverage/loading/error fields. The frontend polls every five seconds while discovery is running. It never reports a definitive empty result for an incomplete catalog. Completed metadata is cached for five minutes. The live verification reached 1,000/1,000 and passed full/partial-name searches.

## Price interaction and waiting

Observed in both source and rendered browser:

- Price is initially hidden. The `Reveal price` button is disabled until pointer movement/dwell requirements are met (source: eight moves and 600 ms).
- Click handlers sometimes intentionally drop or delay a click. A cookie dialog can appear later and require repeated accept/decline clicks.
- Buttons have useful accessible names: `Reveal price`, `Refresh price`, `Try again`, `Decline cookies`.
- A successful-looking price block can still contain `Updating…` with a low-opacity provisional quote. Such a quote is rejected; the scraper requests a refresh and waits for a completed result.
- Store JavaScript may internally retry HTTP failures. These network outcomes are preserved in each application attempt's diagnostics; they are not hidden by final success.
- A 401 `challenge_failed` occurred in both headless and headed modes. The local clock was approximately 18.2 seconds ahead of the store. Aligning only the browser clock to the validated store timestamp fixed it without changing challenges, fingerprints or trusted events. Actual offset is measured each attempt and recorded.

## Extraction signals

The observed `price-main` container includes:

1. A hidden `.price-value[aria-hidden=true]` decoy.
2. Struck-through MRP.
3. Optional text beginning `Deal price`.
4. The actual selling price, using a rotating class and sometimes an `output` tag with split character spans.
5. A percentage discount badge.
6. A second hidden `.amount[data-price=true]` decoy.

Example real DOM values from product 257: hidden `₹45,810`, MRP `₹38,205`, visible selling price `₹36,295`, second hidden `₹25,215`, stock `42 in stock`. A minimized fixture is stored in `server/test/fixtures/price-ready.html` for offline regression testing.

We examine **visible direct children** of `.price-main`, excluding hidden/aria-hidden nodes and line-through text, and require exactly one currency-prefixed numeric selling price. The current layout mapping corroborates the chosen candidate when present; extraction survives a rotated/missing mapping through the independently checked visible DOM. Ambiguity fails closed. We do not choose the first price-looking attribute, the lowest price, or the first currency string in the document.

Product ID from URL, heading and SKU must match validated product metadata. Stock uses one visible `.stock-badge` inside `.price-facets`. Missing/unrecognized stock fails instead of becoming zero.

Stock variants in source: `In stock · N left`, `Only N left`, `N in stock`, `Selling fast — N left`, `Hurry, just N left`, and `Out of stock`. Scarcity wording becomes `limited`, regardless of quantity; this preserves the store's wording rather than imposing an invented threshold. Explicit unknown remains null quantity.

Observed/source-confirmed price formats include Unicode/full-width digits, zero-width separators, NBSP, Indian grouping, dot-thousands/comma-decimals, and a taxes suffix. Price is normalized to a two-decimal string with currency, then validated before SQL persistence.

## Choice and failure modes

HTTP handles public metadata. Playwright is required for current prices/stock. No HTTP-only fallback is used for prices because no reliable public price source was observed. The fallback is a second visible-DOM extraction signal, not an invented API.

Failure categories include network/timeout/HTTP errors, missing product, identity mismatch, missing or invalid price/stock, provisional quote, and structure changes. Diagnostics include source version `ine-visible-v1`, final URL, document title, HTTP status, extraction strategy, measured clock skew and bounded network path/status/timing entries. No huge HTML dumps, tokens or stack traces are returned to users.

Live proof: headless product 257 returned a validated INR observation with 36 units in a later run; headed product 763 returned INR 4231.00 and 99 units. Values change on the store, so these are evidence only, never seeded application data. Fail-first and slow headed tests used the same production pipeline and real SQL schema.
