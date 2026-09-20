# Verification record

Development date: 2026-09-19. Local environment: Windows, Node 22.18, Chromium installed through Playwright 1.63.0.

## Passed locally

| Check                           | Evidence / scope                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INE site inspection             | Initial HTML, actual application bundle, catalog/product/layout JSON and real browser network/DOM                                                        |
| Partial/full product search     | Opt-in live test reached 1,000 unique IDs and matched full and partial names                                                                             |
| Real price and stock            | Product 257 headless; product 763 headed; values validated through the shared production extractor                                                       |
| Temporary live upstream failure | Real HTTP 503 captured inside the store's price flow; successful completed quote accepted afterward                                                      |
| Headed mode                     | Visible Chromium opened; normal browser interactions succeeded                                                                                           |
| Fail-first demo                 | First navigation aborted, attempt 1 retried with NETWORK_ERROR, attempt 2 success, exactly one real observation persisted in isolated PostgreSQL         |
| Slow demo                       | Real product request delayed five seconds; validated price/stock persisted                                                                               |
| Parser/validator coverage       | Unicode, currency, grouping/decimal variants, zero, malformed/missing prices, missing/unknown stock, identity mismatch                                   |
| Failure persistence             | Timeout and extraction failures log retries; terminal failure inserts no history                                                                         |
| SQL integrity                   | Actual schema/RPC execution in PGlite; invalid observation rollback, idempotent commit, duplicate product prevention                                     |
| Concurrency/recovery            | Two-slot admission, per-product guard, duplicate cron slot, expired worker logging, stale worker rejection                                               |
| Cron security                   | Missing/wrong bearer secret rejected; authorized requests persist jobs; duplicate job requests do not add observations                                   |
| Offline DOM regression          | Real minimized HTML fixture: hidden decoys/MRP ignored, rotated mapping fallback, pending/missing prices rejected                                        |
| Frontend                        | Empty state, search/track, one/two-point chart, manual scrape, terminal failure and retry logs, unchanged good history, backend failure and 390px layout |
| Build/lint                      | npm run build and npm run lint                                                                                                                           |

Unit/API tests inject controlled fixtures to prove failure paths. The headed live test uses real observations and an isolated PostgreSQL engine. Neither substitutes for an actual Supabase-hosted end-to-end deployment test.

## Requires your accounts / environment

- Apply schema to a real Supabase project and configure its server-only credentials.
- Start the normal server against Supabase; track an actual search result; verify initial/history/log rows through that connection.
- Build/run the Docker image on Render. Docker is not installed here, so the Linux container/runtime has not been executed locally.
- Deploy Vercel, set its build-time API URL, verify deployed CORS and deep-link routing.
- Configure cron-job.org, test authenticated enqueue and job status, and observe an actual two-hour scheduled cycle.
- Record the normal headed CLI against your Supabase project so its attempts appear in your dashboard.
- Add real deployment, repository, recording links and screenshots to README.

The hosted workflow is not marked complete until these are verified. The final application never auto-seeds the observed values or uses a mock database when credentials are absent.
