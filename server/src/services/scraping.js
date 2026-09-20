import { scrapeProduct } from "../scraper/browser.js";
import { runScrape } from "../scraper/retry.js";
import { logger } from "../logger.js";
export function createScrapingService(
  repository,
  config,
  { extract = scrapeProduct } = {},
) {
  let draining = null;
  let rerun = false;
  async function scrape(
    product,
    {
      trigger = "manual",
      cronKey = null,
      headed = false,
      fault,
      progress = () => {},
    } = {},
  ) {
    const claim = await repository.claim(product.id, trigger, cronKey);
    if (claim.status !== "claimed") return claim;
    const expected = {
      id: Number(product.source_product_id),
      name: product.name,
      sku: product.sku,
    };
    return runScrape({
      product,
      repository,
      runId: claim.runId,
      maxAttempts: config.SCRAPER_MAX_ATTEMPTS,
      extract: (attempt) =>
        extract(expected, {
          attempt,
          headed,
          fault,
          timeout: config.SCRAPER_TIMEOUT_MS,
          progress,
        }),
      onAttempt: (event) =>
        logger.info(
          {
            runId: claim.runId,
            productId: product.id,
            url: product.product_url,
            ...event,
          },
          "Scrape attempt completed",
        ),
      progress: (message) => {
        progress(message);
        logger.info({
          runId: claim.runId,
          productId: product.id,
          url: product.product_url,
          message,
        });
      },
    });
  }
  async function scheduled(job) {
    const results = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: 2 }, async () => {
        while (next < job.product_ids.length) {
          const id = job.product_ids[next++],
            product = await repository.get(id);
          const result = product
            ? await scrape(product, { trigger: "cron", cronKey: job.slot })
            : { status: "inactive" };
          results.push({ productId: id, ...result });
        }
      }),
    );
    return results;
  }
  function drain() {
    if (draining) return draining;
    draining = (async () => {
      for (;;) {
        const job = await repository.claimCron();
        if (!job?.id) return;
        const results = await scheduled(job);
        const complete = !results.some((r) => r.status === "busy");
        await repository.finishCron(job, results, complete);
        if (!complete) await new Promise((r) => setTimeout(r, 2000));
      }
    })().finally(() => {
      draining = null;
      if (rerun) {
        rerun = false;
        kick();
      }
    });
    return draining;
  }
  function kick() {
    if (draining) {
      rerun = true;
      return;
    }
    void drain().catch((error) =>
      logger.error(
        { err: error },
        "Cron worker stopped; durable job will resume on a later wake after lease expiry.",
      ),
    );
  }
  async function enqueueScheduled() {
    const job = await repository.enqueueCron();
    kick();
    return { jobId: job.id, status: job.status, slot: job.slot };
  }
  return { scrape, scheduled, enqueueScheduled, drain, kick };
}
