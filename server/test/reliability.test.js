import test from "node:test";
import assert from "node:assert/strict";
import { createScrapingService } from "../src/services/scraping.js";
import { storeJson } from "../src/scraper/fetcher.js";
test("a cron enqueue racing with an idle worker is not lost", async () => {
  let resolveIdle,
    queued = false,
    finished = false,
    calls = 0;
  const repository = {
    async claimCron() {
      calls++;
      if (calls === 1)
        return new Promise((resolve) => {
          resolveIdle = resolve;
        });
      if (queued) {
        queued = false;
        return { id: "test-job", product_ids: [], slot: "test-slot" };
      }
      return null;
    },
    async enqueueCron() {
      queued = true;
      return { id: "test-job", status: "pending", slot: "test-slot" };
    },
    async finishCron() {
      finished = true;
    },
  };
  const service = createScrapingService(repository, {});
  service.kick();
  await service.enqueueScheduled();
  resolveIdle(null);
  for (let i = 0; i < 30 && !finished; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(finished, true);
  await service.drain();
});
test("a response-body timeout remains TIMEOUT rather than structure change", async () => {
  await assert.rejects(
    storeJson("/api/catalog", {
      timeout: 1,
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          await new Promise((r) => setTimeout(r, 10));
          throw new DOMException("aborted", "AbortError");
        },
      }),
    }),
    { code: "TIMEOUT" },
  );
});
