import { parseArgs } from "node:util";
import { configFromEnv } from "./config.js";
import { getMetadata } from "./scraper/fetcher.js";
import { productId } from "./scraper/validators.js";
import { createRepository } from "./db/repository.js";
import { createScrapingService } from "./services/scraping.js";
const { values } = parseArgs({
  options: {
    product: { type: "string" },
    headed: { type: "boolean", default: false },
    fault: { type: "string" },
  },
});
if (!values.product)
  throw Error(
    "Usage: npm run scrape:headed -- --product=257 [--fault=fail-first|slow]",
  );
const fault = values.fault || process.env.DEMO_FAULT;
if (
  fault &&
  (!["slow", "fail-first"].includes(fault) ||
    !values.headed ||
    process.env.NODE_ENV === "production")
)
  throw Error(
    "Fault injection requires development headed mode and slow or fail-first.",
  );
const config = configFromEnv();
const repository = createRepository(config);
const metadata = await getMetadata(productId(values.product));
const product = await repository.track(metadata);
const result = await createScrapingService(repository, config).scrape(product, {
  headed: values.headed,
  fault,
  trigger: values.headed ? "headed" : "manual",
  progress: console.log,
});
console.log(JSON.stringify(result, null, 2));
if (result.status !== "success") process.exitCode = 1;
