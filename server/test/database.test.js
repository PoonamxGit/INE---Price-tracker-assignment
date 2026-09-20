import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { testDatabase } from "./database-helper.js";
import { createApp } from "../src/app.js";
import { createScrapingService } from "../src/services/scraping.js";
import { runScrape } from "../src/scraper/retry.js";
import { ScrapeError } from "../src/scraper/errors.js";
const metadata = { id: 257, name: "Ironwood Smartwatch Max", sku: "IRO-10257" };
const observation = {
  price: "36295.00",
  currency: "INR",
  stock_status: "in_stock",
  stock_quantity: 42,
  scraped_at: "2026-09-19T06:04:00.000Z",
};
const config = {
  CRON_SECRET: "test-secret-32-characters-long-for-tests",
  FRONTEND_URL: "http://localhost:5173",
  SCRAPER_MAX_ATTEMPTS: 3,
  SCRAPER_TIMEOUT_MS: 10000,
  NODE_ENV: "test",
};
test("real PostgreSQL schema: retry transactions, unique observations, locks, recovery and API", async (t) => {
  const { db, repository } = await testDatabase();
  t.after(() => db.close());
  const product = await repository.track(metadata);
  assert.equal((await repository.track(metadata)).id, product.id);
  const claim = await repository.claim(product.id, "manual");
  assert.equal(claim.status, "claimed");
  assert.equal((await repository.claim(product.id, "manual")).status, "busy");
  const result = await runScrape({
    product,
    repository,
    runId: claim.runId,
    sleep: async () => {},
    extract: async (attempt) => {
      if (attempt === 1) throw new ScrapeError("TIMEOUT", "injected timeout");
      if (attempt === 2)
        throw new ScrapeError("PRICE_NOT_FOUND", "injected missing price");
      return { observation, diagnostics: { http_status: 200 } };
    },
  });
  assert.equal(result.status, "success");
  assert.equal((await repository.history(product.id)).length, 1);
  assert.deepEqual(
    (await repository.logs(product.id)).map((l) => l.status).sort(),
    ["retried", "retried", "success"],
  );
  await repository.succeedAttempt({
    runId: claim.runId,
    attempt: 3,
    observation,
    duration_ms: 1,
    diagnostics: {},
  });
  assert.equal(
    (await repository.history(product.id)).length,
    1,
    "replayed commit is idempotent",
  );
  const bad = await repository.claim(product.id, "manual");
  await repository.startAttempt(bad.runId, product.id, 1);
  await assert.rejects(
    repository.succeedAttempt({
      runId: bad.runId,
      attempt: 1,
      observation: { ...observation, price: null },
      duration_ms: 1,
      diagnostics: {},
    }),
  );
  assert.equal(
    (await repository.history(product.id)).length,
    1,
    "invalid commit rolled back",
  );
  await repository.failAttempt({
    runId: bad.runId,
    attempt: 1,
    status: "failed",
    error_type: "INVALID_PRICE",
    error_message: "invalid",
    duration_ms: 1,
  });
  const stale = await repository.claim(product.id, "manual");
  await repository.startAttempt(stale.runId, product.id, 1);
  await db.query(
    "update scrape_runs set lease_until=now()-interval '1 second' where id=$1",
    [stale.runId],
  );
  const fresh = await repository.claim(product.id, "manual");
  assert.equal(fresh.status, "claimed");
  assert.ok(
    (await repository.logs(product.id)).some(
      (l) => l.error_type === "WORKER_INTERRUPTED",
    ),
  );
  await assert.rejects(
    repository.succeedAttempt({
      runId: stale.runId,
      attempt: 1,
      observation,
      duration_ms: 1,
      diagnostics: {},
    }),
  );
  await repository.startAttempt(fresh.runId, product.id, 1);
  await repository.failAttempt({
    runId: fresh.runId,
    attempt: 1,
    status: "failed",
    error_type: "TEST",
    error_message: "test",
    duration_ms: 1,
  });
  const second = await repository.track({
    ...metadata,
    id: 763,
    sku: "COB-10763",
  });
  const third = await repository.track({
    ...metadata,
    id: 117,
    sku: "FIXTURE-117",
  });
  const locks = await Promise.all([
    repository.claim(product.id, "cron", "slot"),
    repository.claim(second.id, "cron", "slot"),
    repository.claim(third.id, "cron", "slot"),
  ]);
  assert.equal(
    locks.filter((l) => l.status === "claimed").length,
    2,
    "global concurrency limited to two",
  );
  assert.equal(
    (await repository.claim(product.id, "cron", "slot")).status,
    "duplicate",
  );
  for (const lock of locks.filter((l) => l.status === "claimed")) {
    await repository.startAttempt(lock.runId, null, 1);
    await repository.succeedAttempt({
      runId: lock.runId,
      attempt: 1,
      observation,
      duration_ms: 1,
    });
  }
  const scraping = createScrapingService(repository, config, {
    extract: async () => ({ observation, diagnostics: { http_status: 200 } }),
  });
  const app = createApp({
    repository,
    scraping,
    config,
    metadata: async () => metadata,
    search: async () => ({
      products: [{ sourceProductId: "257", name: metadata.name }],
      catalog: { complete: true, loaded: 1, total: 1 },
    }),
  });
  await request(app).get("/api/store/search?q=I").expect(400);
  await request(app).get("/api/store/search?q=Iron").expect(200);
  await request(app).post("/api/cron/scrape").expect(401);
  await request(app)
    .post("/api/cron/scrape")
    .set("Authorization", "Bearer wrong")
    .expect(401);
  await request(app).get("/api/products/not-a-uuid/history").expect(400);
  await request(app)
    .post("/api/products")
    .send({ sourceProductId: "https://evil.test/product/257" })
    .expect(400);
  await request(app)
    .post("/api/products")
    .send({ sourceProductId: "257" })
    .expect(201);
  await request(app).post(`/api/products/${product.id}/scrape`).expect(200);
  await request(app)
    .get(`/api/products/${product.id}/history`)
    .expect(200)
    .expect((r) => assert.ok(r.body.history.length));
  await request(app)
    .get(`/api/products/${product.id}/logs`)
    .expect(200)
    .expect((r) => assert.ok(r.body.logs.some((l) => l.status === "retried")));
  const cron = await request(app)
    .post("/api/cron/scrape")
    .set("Authorization", `Bearer ${config.CRON_SECRET}`)
    .expect(202);
  await scraping.drain();
  assert.ok(cron.body.jobId);
  await request(app)
    .get("/api/cron/jobs/" + cron.body.jobId)
    .expect(401);
  await request(app)
    .get("/api/cron/jobs/" + cron.body.jobId)
    .set("Authorization", "Bearer " + config.CRON_SECRET)
    .expect(200)
    .expect((r) => assert.equal(r.body.job.status, "completed"));
  const count = (await db.query("select count(*)::int as n from price_history"))
    .rows[0].n;
  const duplicate = await request(app)
    .post("/api/cron/scrape")
    .set("Authorization", `Bearer ${config.CRON_SECRET}`)
    .expect(202);
  await scraping.drain();
  assert.equal(duplicate.body.jobId, cron.body.jobId);
  assert.equal(
    (await db.query("select count(*)::int as n from price_history")).rows[0].n,
    count,
  );
  await request(app).delete(`/api/products/${product.id}`).expect(204);
  assert.equal((await repository.get(product.id)).is_active, false);
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from price_history"));
  await assert.rejects(db.query("select track_product($1)", [metadata]));
  await db.exec("reset role");
});
