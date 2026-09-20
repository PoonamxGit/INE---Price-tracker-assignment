import { mkdir } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";
import { testDatabase } from "./database-helper.js";
import { createApp } from "../src/app.js";
import { createScrapingService } from "../src/services/scraping.js";
import { ScrapeError } from "../src/scraper/errors.js";
const metadata = { id: 257, name: "Ironwood Smartwatch Max", sku: "IRO-10257" };
// An observed recon value, injected only into this isolated offline UI test.
const observation = {
  price: "36295.00",
  currency: "INR",
  stock_status: "in_stock",
  stock_quantity: 42,
  scraped_at: "2026-09-19T06:04:00.000Z",
};
test("UI empty, search, track, chart, retry/failure logs, backend error, mobile layout", async () => {
  const { db, repository } = await testDatabase();
  let fail = false,
    attempt = 0;
  const config = {
    CRON_SECRET: "test-secret-32-characters-long-for-tests",
    FRONTEND_URL: "http://127.0.0.1:4175",
    SCRAPER_MAX_ATTEMPTS: 3,
    SCRAPER_TIMEOUT_MS: 10000,
    NODE_ENV: "test",
  };
  const scraping = createScrapingService(repository, config, {
    extract: async () => {
      attempt++;
      if (fail)
        throw new ScrapeError("PRICE_NOT_FOUND", "Test missing selling price.");
      return {
        observation: {
          ...observation,
          scraped_at: new Date(Date.now() + attempt).toISOString(),
        },
      };
    },
  });
  const app = createApp({
    repository,
    scraping,
    config,
    metadata: async () => metadata,
    search: async () => ({
      products: [
        { sourceProductId: "257", name: metadata.name, sku: metadata.sku },
      ],
      catalog: { loaded: 1, total: 1, complete: true },
    }),
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  process.env.VITE_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  const vite = await createServer({
    root: new URL("../../client", import.meta.url).pathname.replace(
      /^\/([A-Z]:)/,
      "$1",
    ),
    server: { host: "127.0.0.1", port: 4175, strictPort: true },
  });
  await vite.listen();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:4175");
    await page.getByText("Your watchlist starts here").waitFor();
    await page.getByLabel("Product name").fill("Ironwood");
    await page.getByRole("button", { name: "Search store" }).click();
    await page.getByRole("button", { name: "+ Track product" }).click();
    await page.getByRole("link", { name: "View details" }).click();
    await page.getByRole("heading", { name: metadata.name }).waitFor();
    await page.getByRole("cell", { name: "₹36,295.00", exact: true }).waitFor();
    assert.equal(
      (await repository.history((await repository.active())[0].id)).length,
      1,
    );
    await page.getByRole("button", { name: "Scrape now" }).click();
    await page.getByText("2 observations on this page").waitFor();
    await mkdir("test-results", { recursive: true });
    await page.screenshot({
      path: "test-results/product-desktop.png",
      fullPage: true,
    });
    fail = true;
    await page.getByRole("button", { name: "Scrape now" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Scrape failed" })
      .waitFor({ timeout: 15000 });
    await page
      .getByRole("cell", { name: "failed", exact: true })
      .first()
      .waitFor();
    assert.equal(
      (await repository.history((await repository.active())[0].id)).length,
      2,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/product-mobile.png",
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.route("**/api/products", (route) => route.abort());
    await page.getByRole("link", { name: "Back to watchlist" }).click();
    await page.getByRole("alert").filter({ hasText: "Cannot reach" }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await vite.close();
    await new Promise((r) => server.close(r));
    await db.close();
  }
});
