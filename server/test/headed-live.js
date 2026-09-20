import assert from "node:assert/strict";
import { testDatabase } from "./database-helper.js";
import { getMetadata } from "../src/scraper/fetcher.js";
import { createScrapingService } from "../src/services/scraping.js";
const { db, repository } = await testDatabase();
try {
  const config = { SCRAPER_MAX_ATTEMPTS: 3, SCRAPER_TIMEOUT_MS: 60000 };
  const scraping = createScrapingService(repository, config);
  const product = await repository.track(await getMetadata("763"));
  for (const fault of ["fail-first", "slow"]) {
    console.log("VERIFYING DEVELOPMENT DEMONSTRATION FAULT INJECTION", fault);
    const result = await scraping.scrape(product, {
      trigger: "headed",
      headed: true,
      fault,
      progress: console.log,
    });
    assert.equal(result.status, "success");
    const logs = (await repository.logs(product.id)).filter(
      (l) => l.run_id === result.runId,
    );
    if (fault === "fail-first")
      assert.ok(
        logs.some(
          (l) => l.status === "retried" && l.error_type === "NETWORK_ERROR",
        ),
      );
    assert.equal(
      (await repository.history(product.id)).filter(
        (h) => h.run_id === result.runId,
      ).length,
      1,
    );
    console.log(
      JSON.stringify(
        {
          fault,
          result,
          attempts: logs.map((l) => ({
            status: l.status,
            attempt: l.attempt_number,
            error: l.error_type,
          })),
        },
        null,
        2,
      ),
    );
  }
  console.log(
    "PASS: headed fail-first and slow demonstrations, real INE observations, SQL attempt logs and exactly one observation per run",
  );
} finally {
  await db.close();
}
