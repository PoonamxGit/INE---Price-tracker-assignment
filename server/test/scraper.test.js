import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePrice,
  parseStock,
  extractSnapshot,
} from "../src/scraper/extractor.js";
import { productId, observationSchema } from "../src/scraper/validators.js";
import { storeJson, collectCatalog } from "../src/scraper/fetcher.js";
import { ScrapeError } from "../src/scraper/errors.js";
import { runScrape, backoff } from "../src/scraper/retry.js";
const expected = { id: 257, name: "Ironwood Smartwatch Max", sku: "IRO-10257" };
const snapshot = {
  id: "257",
  heading: expected.name,
  skuText: `Ironwood · SKU ${expected.sku}`,
  container: true,
  pending: false,
  prices: ["₹​3​6​,​2​9​5"],
  stock: "42 in stock",
};
for (const [text, price, currency = "INR"] of [
  ["₹36,295", "36295.00"],
  ["₹３６,２９５", "36295.00"],
  ["Rs.1,23,456.78", "123456.78"],
  ["₹36.295,00", "36295.00"],
  ["₹36 295", "36295.00"],
  ["₹​3​6​,​2​9​5", "36295.00"],
  ["₹36,295/- (incl. of all taxes)", "36295.00"],
  ["₹0", "0.00"],
  ["₹0.01", "0.01"],
  ["$123.45", "123.45", "USD"],
  ["€123,45", "123.45", "EUR"],
])
  test(`price ${text}`, () =>
    assert.deepEqual(parsePrice(text), { price, currency }));
for (const text of [
  null,
  "",
  "₹-1",
  "₹NaN",
  "₹Infinity",
  "123",
  "₹12,34,5",
  "₹1.999",
  "₹9999999999999",
  "₹1.00 garbage",
])
  test(`reject price ${text}`, () =>
    assert.throws(() => parsePrice(text), ScrapeError));
for (const text of [
  "In stock · 42 left",
  "Only 42 left",
  "42 in stock",
  "Selling fast — 42 left",
  "Hurry, just 42 left",
])
  test(`stock ${text}`, () =>
    assert.equal(parseStock(text).stock_quantity, 42));
test("stock zero is observed; unknown is not zero", () => {
  assert.deepEqual(parseStock("Out of stock"), {
    stock_status: "out_of_stock",
    stock_quantity: 0,
  });
  assert.deepEqual(parseStock("unknown"), {
    stock_status: "unknown",
    stock_quantity: null,
  });
  assert.throws(() => parseStock(""));
  assert.throws(() => parseStock("0 in stock"));
});
test("valid snapshot and identity checks", () => {
  assert.equal(extractSnapshot(snapshot, expected).price, "36295.00");
  assert.throws(() => extractSnapshot({ ...snapshot, id: "763" }, expected), {
    code: "INVALID_PRODUCT_PAGE",
  });
  assert.throws(
    () => extractSnapshot({ ...snapshot, heading: "Wrong" }, expected),
    { code: "INVALID_PRODUCT_PAGE" },
  );
});
test("structure, ambiguity, stock and pending failures", () => {
  assert.throws(
    () => extractSnapshot({ ...snapshot, container: false }, expected),
    { code: "STRUCTURE_CHANGED" },
  );
  assert.throws(
    () => extractSnapshot({ ...snapshot, prices: ["₹12", "₹13"] }, expected),
    { code: "STRUCTURE_CHANGED" },
  );
  assert.throws(
    () => extractSnapshot({ ...snapshot, pending: true }, expected),
    { code: "EXTRACTION_ERROR" },
  );
  assert.throws(() => extractSnapshot({ ...snapshot, stock: "" }, expected), {
    code: "STOCK_NOT_FOUND",
  });
});
test("observation validation rejects numeric null and inconsistent stock", () => {
  const valid = extractSnapshot(snapshot, expected);
  assert.equal(observationSchema.safeParse(valid).success, true);
  for (const bad of [
    { price: null },
    { price: 0 },
    { price: "-1.00" },
    { stock_quantity: -1 },
    { currency: "bad" },
    { stock_status: "in_stock", stock_quantity: 0 },
  ])
    assert.equal(
      observationSchema.safeParse({ ...valid, ...bad }).success,
      false,
    );
});
test("allowlist rejects external hosts, ports, credentials and query redirects", () => {
  assert.equal(productId("https://demo.inelabteamdev.com/product/257"), "257");
  for (const bad of [
    "http://demo.inelabteamdev.com/product/257",
    "https://evil.test/product/257",
    "https://demo.inelabteamdev.com.evil.test/product/257",
    "https://u:p@demo.inelabteamdev.com/product/257",
    "https://demo.inelabteamdev.com:123/product/257",
    "https://demo.inelabteamdev.com/product/257?url=http://localhost",
    "0",
    "../257",
  ])
    assert.throws(() => productId(bad));
});
test("HTTP helper prevents redirect following and reports 404/429", async () => {
  let options;
  await storeJson("/api/catalog", {
    fetchImpl: async (_url, o) => {
      options = o;
      return { ok: true, json: async () => ({}) };
    },
  });
  assert.equal(options.redirect, "error");
  for (const status of [404, 429])
    await assert.rejects(
      storeJson("/api/catalog", {
        fetchImpl: async () => ({ ok: false, status }),
      }),
      (error) =>
        error.diagnostics.http_status === status &&
        error.retryable === (status === 429),
    );
  await assert.rejects(storeJson("https://evil.test"), {
    code: "INVALID_PRODUCT_PAGE",
  });
});
test("shuffled catalog deduplicates and never accepts incomplete coverage", async () => {
  const p = (id) => ({
    id,
    name: `Observed ${id}`,
    sku: `S-${id}`,
    slug: `p-${id}`,
    brand: "Test",
    category: "Test",
    description: "Test fixture",
  });
  let count = 0;
  const request = async () => ({
    page: 1,
    pageSize: 60,
    pages: 1,
    total: 3,
    items: ++count === 1 ? [p(1), p(2)] : [p(2), p(3)],
  });
  assert.equal(
    (await collectCatalog({ request, sleep: async () => {}, maxRequests: 3 }))
      .length,
    3,
  );
  await assert.rejects(
    collectCatalog({
      request: async () => ({
        page: 1,
        pageSize: 60,
        pages: 1,
        total: 3,
        items: [p(1)],
      }),
      sleep: async () => {},
      maxRequests: 2,
    }),
    { code: "CATALOG_INCOMPLETE" },
  );
});
function memory() {
  return {
    events: [],
    observations: [],
    async startAttempt(_run, _id, n) {
      this.events.push(["running", n]);
    },
    async failAttempt(v) {
      this.events.push([v.status, v.attempt]);
    },
    async succeedAttempt(v) {
      this.events.push(["success", v.attempt]);
      this.observations.push(v.observation);
    },
  };
}
test("timeout, extraction failure, then success records every attempt and one observation", async () => {
  const repository = memory();
  const result = await runScrape({
    product: { id: "test" },
    repository,
    sleep: async () => {},
    extract: async (n) => {
      if (n === 1) throw new ScrapeError("TIMEOUT", "timeout");
      if (n === 2) throw new ScrapeError("PRICE_NOT_FOUND", "missing");
      return { observation: extractSnapshot(snapshot, expected) };
    },
  });
  assert.equal(result.status, "success");
  assert.deepEqual(repository.events, [
    ["running", 1],
    ["retried", 1],
    ["running", 2],
    ["retried", 2],
    ["running", 3],
    ["success", 3],
  ]);
  assert.equal(repository.observations.length, 1);
});
test("terminal extraction failure never inserts history", async () => {
  const repository = memory();
  const result = await runScrape({
    product: { id: "test" },
    repository,
    sleep: async () => {},
    extract: async () => {
      throw new ScrapeError("INVALID_PRICE", "bad");
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(repository.observations.length, 0);
  assert.equal(repository.events.at(-1)[0], "failed");
});
test("permanent errors do not retry and persistence failure is not a scrape retry", async () => {
  const repository = memory();
  await runScrape({
    product: { id: "test" },
    repository,
    extract: async () => {
      throw new ScrapeError("PRODUCT_NOT_FOUND", "missing", {
        retryable: false,
      });
    },
  });
  assert.equal(repository.events.length, 2);
  let calls = 0;
  repository.succeedAttempt = async () => {
    throw Error("commit unavailable");
  };
  await assert.rejects(
    runScrape({
      product: { id: "test" },
      repository,
      extract: async () => {
        calls++;
        return { observation: extractSnapshot(snapshot, expected) };
      },
    }),
    /commit unavailable/,
  );
  assert.equal(calls, 1);
});
test("bounded exponential jitter", () => {
  assert.equal(
    backoff(1, () => 0),
    1000,
  );
  assert.equal(
    backoff(2, () => 0),
    2000,
  );
  assert.equal(
    backoff(3, () => 0.999),
    4499,
  );
});
