# Pricewatch — INE Product Price Tracker

A React + Express application that searches the actual INE demo store, tracks products in Supabase PostgreSQL, and records validated prices, stock and every scrape attempt. The production application contains **no mock products or fallback prices**. Test-only fixtures are under `server/test/` and are excluded from the production Docker image.

**Submission links:** Live frontend: _add after deployment_ · Backend: _add after deployment_ · GitHub: _add repository URL_ · Recording: _add video URL_.

## What was actually verified

- Live catalog discovery reached all 1,000 advertised INE products; partial/full-name search passed.
- Real headless extraction passed for product 257. A real HTTP 503 in the storefront's internal flow was captured in diagnostics before successful extraction.
- Visible Chromium scraped product 763 with both `fail-first` and `slow` development faults. The aborted attempt was recorded as retried; the successful retry inserted exactly one real observation in an isolated PostgreSQL test database.
- Unit/database/API and offline browser/UI tests cover success, terminal failure, retries, no invalid history, cron authentication/deduplication, locks, lease recovery, RLS permissions, charts, empty/error states and mobile layout.
- Production frontend build and lint are checked. See [verification record](docs/VERIFICATION.md) for the exact boundary of testing.

Supabase hosting, Docker execution on Render, Vercel deployment and the actual external cron job require your accounts. They have not been represented as deployed or verified remotely.

## Architecture

```text
React / Vite (Vercel)
        | HTTP JSON
Express (Render Docker) ---- Supabase Postgres (service role, server only)
        |                         | products / runs / attempts / observations
        |                         | durable cron_jobs
        +-- HTTP: INE catalog and product metadata
        +-- Playwright: INE visible price/stock interaction

cron-job.org -- authenticated POST every 2 hours --> durable job + HTTP 202
                                                   two bounded scraper workers
```

React Router, Recharts, Express 5, Zod, Pino, Playwright Chromium and the Supabase JS client. Ordinary HTTP is used wherever it suffices. Prices genuinely need the storefront's browser interaction; Cheerio would only see an empty React shell. Read [reconnaissance](docs/SCRAPER_RECON.md), [design decisions](docs/DESIGN.md) and [real AI development corrections](docs/AI_NOTES.md).

## Project structure

```text
client/
  src/                  Dashboard, search, product detail, shared UI and data hooks
  .env.example          Public frontend API origin
server/
  src/
    scraper/            HTTP fetching, browser interaction, parsing, validation, retries
    services/           Shared manual/headed/scheduled execution and queue draining
    db/                 Supabase repository and transactional RPC calls
    middleware/         Cron authentication
    app.js              Validated REST API and central error handling
    server.js           Process entry point
    cli.js              Manual/headed CLI
  test/                 Offline unit, PostgreSQL, UI tests and opt-in live checks
supabase/schema.sql     Complete initial schema, indexes, RLS, locks and RPC functions
docs/                   Recon, design, AI notes, verification and video guide
Dockerfile              Node + matching Playwright Chromium and OS dependencies
render.yaml             Render service blueprint
vercel.json             Vercel root build and SPA routing
.github/workflows/ci.yml Offline checks only; never scrapes the live store
```

## Local setup

Requires Node 22.12+ and npm. Run commands from the repository root.

```powershell
npm ci
npx playwright install chromium
Copy-Item .env.example .env
Copy-Item client/.env.example client/.env
```

On Linux install browser dependencies with `npx playwright install --with-deps chromium`. On macOS/Linux use `cp` instead of `Copy-Item`.

### Supabase setup

1. Create a Supabase project and open its SQL Editor.
2. Paste **all of `supabase/schema.sql`** and run it once against a fresh project. It creates five tables, constraints, indexes and the transactional functions. It is an initial migration, not a script to rerun against populated tables.
3. Copy the project's URL and server-side `service_role` key into root `.env`. Do not use the anonymous key for this server. Do not put either server secret in Vercel frontend variables.
4. Set a random `CRON_SECRET` of at least 32 characters, and set `FRONTEND_URL=http://localhost:5173` for local development.
5. Tables have RLS enabled with no anonymous/authenticated access. The backend service role is the only application database access path.

No production runtime uses the embedded database from tests. No local fallback silently replaces Supabase.

Generate a cron secret locally if needed:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

In separate terminals:

```powershell
npm run dev:server
npm run dev:client
```

Open `http://localhost:5173`. Backend liveness: `http://localhost:3001/api/health`. The health route checks that Express is running; it does not assert database credentials are valid.

### Environment variables

| Variable                    | Where                     | Purpose                                                          |
| --------------------------- | ------------------------- | ---------------------------------------------------------------- |
| `SUPABASE_URL`              | Root `.env` / Render      | Project API URL                                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | Root `.env` / Render      | Server-only database credential                                  |
| `CRON_SECRET`               | Root `.env` / Render      | Server-only cron bearer secret, minimum 32 characters            |
| `FRONTEND_URL`              | Root `.env` / Render      | Exact frontend origin for CORS; no trailing slash/path           |
| `PORT`                      | Root `.env` / Render      | Backend port, default `3001`                                     |
| `NODE_ENV`                  | Root `.env` / Render      | `development` locally; `production` on Render                    |
| `SCRAPER_TIMEOUT_MS`        | Root `.env` / Render      | Attempt deadline, default `45000`, allowed `10000`–`60000`       |
| `SCRAPER_MAX_ATTEMPTS`      | Root `.env` / Render      | Total attempts, default `3`, allowed `1`–`3`                     |
| `VITE_API_BASE_URL`         | `client/.env` / Vercel    | Public backend origin, e.g. your Render URL; no `/api` suffix    |
| `DEMO_FAULT`                | Optional local shell only | `slow` or `fail-first`; only allowed with development headed CLI |

`PLAYWRIGHT_BROWSERS_PATH` is set by Docker internally. Headless mode is the server default; headed mode is an explicit local CLI option. There are no unused scraper/headless environment flags.

## Search and tracking

Search accepts 2–120 characters and performs case-insensitive name matching against real catalog records. The store reshuffles every page request and caps page size at 60. Initial discovery therefore takes a few minutes at a conservative request pace. The UI shows real results progressively, reports `loaded/total` coverage, and does not call an incomplete result set “no matches.” A completed catalog is cached for five minutes. Concurrent searches share one discovery task. A bounded failure is reported instead of returning an apparently complete catalog.

Tracking validates the ID against the store and performs an immediate scrape. Duplicate product URLs/IDs are prevented by database constraints. An initial scrape failure leaves the product tracked with honest logs and no price observation. Stop tracking preserves history. Re-select the same product from search to reactivate it. The shared demo caps active products at 20; use a small watchlist on free hosting.

## Manual and headed scraping

These commands **save to your configured Supabase project**, using the same pipeline as the API and cron:

```powershell
npm run scrape -- --product=257
npm run scrape:headed -- --product=257
npm run scrape:headed -- --product=https://demo.inelabteamdev.com/product/763
```

Development demonstrations:

```powershell
npm run scrape:headed -- --product=763 --fault=fail-first
npm run scrape:headed -- --product=763 --fault=slow
```

`fail-first` aborts the first real browser navigation, records a retried attempt, then permits normal scraping. `slow` delays the real product-metadata request by five seconds. Both print **DEVELOPMENT DEMONSTRATION FAULT INJECTION** and never manufacture prices or database successes. Production and headless fault injection are rejected.

The script uses `headless: false`, visible pointer motion and clear progress messages. Keep the browser unobstructed while recording. The INE cookie dialog may require repeated declines; the scraper handles this. [Video sequence](docs/VIDEO_GUIDE.md).

## Testing

```powershell
npm run lint
npm test
npm run test:browser
npm run build
```

`npm test` uses an isolated PGlite PostgreSQL engine to execute the actual SQL schema and transactional functions. Ordinary tests do not need Supabase credentials or an online store. Browser tests require installed Chromium and port 4175 to be available. Their fixtures are expressly test-only; UI screenshots are saved under ignored `test-results/`.

Opt-in live verification, only against INE:

```powershell
npm run test:scraper:live
npm run test:headed:live
```

The first checks real browser extraction and complete catalog discovery/full and partial search. It may take several minutes. The second opens visible browsers and tests both fault modes with real INE observations stored in an isolated test database, so it needs no Supabase credentials. It does not populate your dashboard. Use the normal headed CLI for your submission recording.

## API

| Method | Endpoint                    | Notes                                                                    |
| ------ | --------------------------- | ------------------------------------------------------------------------ |
| GET    | `/api/health`               | Process liveness                                                         |
| GET    | `/api/store/search?q=...`   | Results plus honest catalog coverage                                     |
| GET    | `/api/products`             | Active tracked products, last two observations                           |
| POST   | `/api/products`             | JSON `{ "sourceProductId": "257" }`; validate and initial scrape         |
| GET    | `/api/products/:id`         | Tracked UUID, not store ID                                               |
| DELETE | `/api/products/:id`         | Stop tracking; retain history                                            |
| GET    | `/api/products/:id/history` | `limit` 1–200, `offset`; newest first                                    |
| GET    | `/api/products/:id/logs`    | Same pagination; includes running/retried/success/failed                 |
| POST   | `/api/products/:id/scrape`  | Shared scraper; 409 if inactive/busy                                     |
| POST   | `/api/cron/scrape`          | Bearer-protected; 202 means durably queued, **not scraped successfully** |
| GET    | `/api/cron/jobs/:id`        | Same bearer secret; queued batch status/results                          |

A completed scrape operation can return HTTP 200 with `status: failed`; the UI explicitly reports that outcome. Invalid input is 400, missing products 404, bad cron credentials 401, upstream failures 502, database/service failures 503. Search is limited to 20 requests/minute/IP; mutation/manual endpoints to 8/minute/IP. The app is an intentionally shared assignment dashboard, not a multi-user account system. CORS is not authentication.

## Deployment

### Render backend

1. Push this repository to your GitHub account without `.env` or `node_modules`.
2. Create a Render Blueprint from the repository using `render.yaml`, or a Docker web service using the root `Dockerfile`.
3. Supply `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and your Vercel origin as `FRONTEND_URL`. The blueprint generates `CRON_SECRET`; copy it privately to cron-job.org. Set production variables as shown above.
4. Health check: `/api/health`. The image installs the exact lockfile Playwright version and its corresponding Chromium/OS dependencies; the runtime uses the unprivileged `node` user.
5. Test search and tracking after deployment. A Docker build has not been run in this Windows environment because Docker is unavailable.

Free Render services sleep after idle periods and can restart. Chromium is heavier than plain HTTP, but the actual store requires it. A small watchlist is suitable for an assignment demonstration. For reliable production timing, use an always-on service with adequate memory; no code can guarantee availability on a sleeping/restarted free instance. [Render limitations](https://render.com/docs/free), [Playwright browser installation](https://playwright.dev/docs/browsers).

### Vercel frontend

1. Import the same repository. Keep **Root Directory at the repository root**.
2. Root `vercel.json` sets the Vite build, `npm ci`, and output directory `client/dist`, including SPA deep-link routing.
3. Set `VITE_API_BASE_URL=https://YOUR_BACKEND.onrender.com` in Vercel before building. It is a public build-time value; redeploy after changes.
4. Copy the exact deployed Vercel origin into Render's `FRONTEND_URL`, then redeploy/restart the backend.
5. Open the dashboard and a direct `/products/<uuid>` link to check routing and CORS. [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).

### cron-job.org: every two hours

Create a job with:

- URL: `https://YOUR_BACKEND.onrender.com/api/cron/scrape`
- Method: **POST**
- Header name: `Authorization`
- Header value: `Bearer YOUR_CRON_SECRET`
- Timezone: **UTC**
- Schedule: `0 */2 * * *` (minute 0 of hours 0, 2, 4, …, 22)
- Request body: empty
- Enable failure notifications. Test that a correct secret gives 202 and a missing/wrong secret gives 401.

The endpoint first inserts a durable job and returns quickly because [cron-job.org has a 30-second request limit](https://cron-job.org/en/faq/). Two workers process the saved product IDs. Unique two-hour slots, per-product run keys and SQL locks prevent duplicate observations. The response includes `jobId`; inspect its protected status endpoint and product logs for actual scrape outcomes.

For **Render free**, configure a second wake-up job: GET `https://YOUR_BACKEND.onrender.com/api/health` at `55 1-23/2 * * *` UTC (five minutes before each scrape). Its first call may time out during a cold start but still wakes the service. This is a practical mitigation, not an uptime guarantee. The price-scraping job itself remains every two hours. No Express `setInterval` schedules scraping.

Interrupted product runs have five-minute leases; a later claim records `WORKER_INTERRUPTED` and preserves previous good observations. Interrupted cron batches have 30-minute leases and can resume on a later startup/cron wake. Workers don't retry an already completed slot. A resumed batch's observations record the **actual scrape time**, never its original scheduled time.

## Reliability and trade-offs

- Hidden price decoys, MRP, optional deal price, rotated classes, split/full-width digits, provisional prices and randomized cookie/click behavior were observed directly.
- Extraction accepts one visible selling-price candidate, checks page ID/title/SKU, rejects provisional states, and validates exact decimal/currency/stock data before committing.
- Three total attempts, exponential backoff and jitter. Each attempt exists before network work and has a shared run ID, timings and bounded diagnostics. Internal storefront HTTP outcomes are retained without tokens or response bodies.
- Only a successful SQL transaction inserts price history, marks the attempt successful and updates the product. A unique run ID prevents duplicate history after a replayed commit. Persistence failures do not trigger another product scrape.
- Browser requests are restricted to the INE origin and redirects are blocked before following them. HTTP helpers also reject redirects. Secrets never enter the client bundle.
- Measured browser/store clock skew is recorded and corrected only inside that browser context, bounded to five minutes; Windows time is never changed and challenges/fingerprints are not forged.
- The chart shows the selected 100-observation page. Older pages and every log remain accessible; mixed currencies are shown in the table rather than plotted together.
- No email alerts, multi-tenant accounts or configurable scheduling were added. Price changes are visible on the dashboard when two comparable observations exist.

## Screenshots

_Add screenshots from your configured real Supabase-backed app: watchlist, product history, and a retried/failed attempt log. The automated UI-test screenshots use isolated fixtures and should not be presented as deployed data._

## Before submission

Configure your Supabase/Render/Vercel/cron accounts, run the real hosted workflow, add the four submission links, and record the 2–4 minute demo using [VIDEO_GUIDE.md](docs/VIDEO_GUIDE.md). See [VERIFICATION.md](docs/VERIFICATION.md) for the remaining account-dependent checks.
