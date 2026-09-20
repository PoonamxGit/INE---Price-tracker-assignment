# Suggested 2–4 minute recording

Before recording, configure the real Supabase-backed app, wake Render if deployed, and warm search until catalog coverage is complete. Do not spend the video waiting for randomized catalog discovery. Keep your `.env` and any secret-bearing terminal commands out of view.

| Time      | Show                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:25 | Dashboard, then search for part of a real INE name such as `Smartwatch`; point out that results come from the actual store.                                                     |
| 0:25–0:55 | Track one product. Show its first validated price, stock and successful attempt. Open the source store for comparison if useful; prices can change between requests.            |
| 0:55–1:20 | Open details: price chart, timestamped stock/history table and shared run IDs in the attempt log. Trigger a manual scrape to add a real second observation.                     |
| 1:20–2:20 | Run the command below with the tracked store ID. Show the visible browser, DEVELOPMENT DEMONSTRATION FAULT INJECTION notice, first navigation failure, retry, and real success. |
| 2:20–2:50 | Refresh dashboard logs. Show `RETRIED` followed by `SUCCESS` under the same run ID and exactly one new history row.                                                             |
| 2:50–3:20 | Briefly show the protected cron configuration and two-hour schedule with the secret obscured. Explain that HTTP 202 acknowledges a durable job; logs show actual outcomes.      |
| 3:20–3:45 | Summarize the decoy-price/pending-state protection and one genuine AI correction from AI_NOTES.md.                                                                              |

Normal command (requires your root `.env`):

```powershell
npm run scrape:headed -- --product=763 --fault=fail-first
```

Use the numeric store ID for the same product you tracked, not the dashboard's UUID. An alternative slow-response clip:

```powershell
npm run scrape:headed -- --product=763 --fault=slow
```

The failure is deliberately injected and clearly labelled. Prices, stock, retry behavior and successful database writes are real. If the real store fails all attempts, show that honestly; do not describe it as success. Previous good history should remain unchanged.
