import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { readSnapshot } from "../src/scraper/browser.js";
import { extractSnapshot } from "../src/scraper/extractor.js";
const product = { id: 257, name: "Ironwood Smartwatch Max", sku: "IRO-10257" };
test("offline browser extraction ignores real decoys, survives rotated classes, rejects missing/pending values", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const html = await readFile(
      new URL("./fixtures/price-ready.html", import.meta.url),
      "utf8",
    );
    await page.route("**/*", (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
    await page.goto("https://demo.inelabteamdev.com/product/257");
    let snapshot = await readSnapshot(page, "pv-m4");
    assert.equal(snapshot.method, "layout-and-visible-dom");
    assert.equal(extractSnapshot(snapshot, product).price, "36295.00");
    await page.locator("output").evaluate((el) => (el.className = "rotated"));
    snapshot = await readSnapshot(page, "pv-m4");
    assert.equal(snapshot.method, "visible-dom");
    assert.equal(extractSnapshot(snapshot, product).price, "36295.00");
    await page.locator("output").evaluate((el) => (el.style.opacity = "0.45"));
    assert.throws(() =>
      extractSnapshot({ ...snapshot, pending: true }, product),
    );
    assert.equal((await readSnapshot(page)).pending, true);
    await page.locator("output").evaluate((el) => el.remove());
    assert.throws(() => extractSnapshot({ ...snapshot, prices: [] }, product), {
      code: "STRUCTURE_CHANGED",
    });
    assert.equal((await readSnapshot(page)).prices.length, 0);
    await page.locator(".price-main").evaluate((el) => el.remove());
    assert.equal((await readSnapshot(page)).container, false);
  } finally {
    await browser.close();
  }
});
