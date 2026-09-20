import { getMetadata, searchStore } from "../src/scraper/fetcher.js";
import { scrapeProduct } from "../src/scraper/browser.js";
const metadata = await getMetadata(process.env.LIVE_PRODUCT_ID || "257");
const result = await scrapeProduct(metadata, { progress: console.log });
console.log(JSON.stringify(result, null, 2));
let full;
for (let i = 0; i < 90; i++) {
  full = await searchStore(metadata.name);
  if (full.catalog.complete) break;
  if (full.catalog.error) throw Error(full.catalog.error);
  console.log("Catalog progress", full.catalog);
  await new Promise((r) => setTimeout(r, 5000));
}
if (
  !full?.catalog.complete ||
  !full.products.some((p) => p.sourceProductId === String(metadata.id))
)
  throw Error("Full-name search failed or catalog incomplete");
if (!(await searchStore(metadata.name.split(" ")[0])).products.length)
  throw Error("Partial-name search failed");
console.log(
  "PASS: real browser extraction, full catalog coverage, full and partial search",
);
