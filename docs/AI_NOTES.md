# AI development notes — actual corrections

These are mistakes and discoveries from this development session, recorded from real commands/test failures. They are not hypothetical interview anecdotes.

## 1. Treating the host clock as trustworthy

**Initial implementation:** the first Playwright recon script used the normal local browser clock and normal pointer/click interaction.

**Failure/discovery:** both headless and headed runs reached `/api/challenge` but `/api/session` returned HTTP 401 with `challenge_failed`. Merely switching to headed mode did not fix it.

**Root cause:** comparison of the store's challenge timestamp with local time measured about 18.2 seconds of skew. Browser interaction timestamps were outside the store's accepted window.

**Correction:** measure the store clock, validate a bounded offset, and align the browser context clock only. Preserve the actual page's challenge computation, trusted clicks and browser properties.

**Evidence:** the same real product then produced successful session/price responses and a visible price/stock observation. The final scraper records the measured offset rather than hardcoding 18 seconds.

## 2. Assuming one catalog pagination pass was complete

**Initial implementation:** fetch each advertised page once, then verify the number of unique product IDs equals `total`.

**Failure/discovery:** the first live full-search test failed with `STRUCTURE_CHANGED: The catalog is incomplete or contains duplicate products`. Two back-to-back requests to page 1 returned different ID lists.

**Root cause:** the store reshuffles the catalog independently on every request. Pagination does not provide a stable snapshot.

**Correction:** accumulate/deduplicate actual observed records and explicitly track unique coverage. Do not infer IDs or seed products. A catalog is complete only at the advertised total.

**Evidence:** the live test reached all 1,000 IDs and passed full/partial name matching. The original consistency check prevented an incomplete catalog from silently looking valid.

## 3. Collecting shuffled catalog pages too quickly

**Initial correction:** repeated discovery with 150 ms between requests and short normal retries.

**Failure/discovery:** a live run received repeated HTTP 429 and stopped.

**Root cause:** completing a randomly shuffled catalog requires substantially more requests than a single pass; the original pace was too aggressive.

**Correction:** one shared discovery operation, 1.2-second spacing, a 30-second cooldown on 429, bounded collection, and progressive UI results with visible coverage. A completed cache lasts five minutes. Empty results are definitive only after completion.

**Evidence:** the subsequent live run completed the entire catalog at the slower pace. No fake local search data was introduced.

## 4. Windows encoding and an overbroad cleanup

**Initial implementation:** PowerShell `Set-Content -Encoding UTF8` generated BOM-prefixed files.

**Failure/discovery:** Vite/PostCSS rejected JSON with `Unexpected token` at the BOM, and the PostgreSQL schema test failed with a syntax error at the same character.

**Root cause:** Windows PowerShell's UTF-8 output behavior differs from the BOM-free text expected by those parsers. The first cleanup command also relied on implicit ignore behavior and included dependency files.

**Correction:** stop that cleanup, explicitly exclude dependencies/build output, write source as BOM-free UTF-8, and restore dependencies with `npm ci` before trusting tests. Formatting is scoped to source files.

**Evidence:** the database tests and production frontend build passed afterward. A later mechanical module split also briefly produced `async export function`; the formatter caught it, and the nested function was corrected before the build.

## 5. Losing the UI's failure message during refresh

**Initial implementation:** after a scrape, reload product data and display a full loading view while the request runs.

**Failure/discovery:** the browser test created a terminal `PRICE_NOT_FOUND` run, verified the backend logged it, but timed out waiting for the UI's `Scrape failed` notice.

**Root cause:** refreshing product state unmounted the detail subtree and its scrape button, destroying the newly set error message.

**Correction:** retain the already loaded view during refresh. Show the full loading view only when there is no existing product data.

**Evidence:** the browser test now sees the error notice, retried/failed rows and unchanged history count, including at a mobile viewport. Previous good observations remain visible alongside the latest failure status.

## Deployment review correction

The first cron route waited synchronously for every product scrape. Reviewing the actual cron-job.org documentation revealed its 30-second request limit. Before deployment, this was replaced by a durable PostgreSQL job plus prompt HTTP 202 acknowledgement and a shared worker. This was a design review correction, **not** an invented claim of an observed production outage.
