import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { authCron } from "./middleware/authCron.js";
import { z } from "zod";
import { searchStore, getMetadata } from "./scraper/fetcher.js";
import { productId } from "./scraper/validators.js";
import { ScrapeError } from "./scraper/errors.js";
import { logger } from "./logger.js";
const uuid = z.uuid();
const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});
export function createApp({
  repository,
  scraping,
  config,
  search = searchStore,
  metadata = getMetadata,
}) {
  const app = express();
  app.disable("x-powered-by");
  if (config.NODE_ENV === "production") app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: config.FRONTEND_URL }));
  app.use(express.json({ limit: "8kb" }));
  const searchLimit = rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many searches. Please wait a minute." },
  });
  const actionLimit = rateLimit({
    windowMs: 60000,
    limit: 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many actions. Please wait a minute." },
  });
  async function requireProduct(id) {
    const product = await repository.get(uuid.parse(id));
    if (!product) {
      const e = new Error("Product not found.");
      e.status = 404;
      throw e;
    }
    return product;
  }
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/store/search", searchLimit, async (req, res) => {
    const q = z.string().trim().min(2).max(120).parse(req.query.q);
    res.json(await search(q));
  });
  app.get("/api/products", async (_req, res) =>
    res.json({ products: await repository.list() }),
  );
  app.post("/api/products", actionLimit, async (req, res) => {
    const input = z
      .object({ sourceProductId: z.string().min(1).max(200) })
      .strict()
      .parse(req.body);
    const product = await repository.track(
      await metadata(productId(input.sourceProductId)),
    );
    const result = await scraping.scrape(product, { trigger: "initial" });
    res
      .status(201)
      .json({ product: await repository.get(product.id), scrape: result });
  });
  app.get("/api/products/:id", async (req, res) =>
    res.json({ product: await requireProduct(req.params.id) }),
  );
  app.delete("/api/products/:id", actionLimit, async (req, res) => {
    await requireProduct(req.params.id);
    await repository.deactivate(req.params.id);
    res.status(204).end();
  });
  for (const resource of ["history", "logs"])
    app.get(`/api/products/:id/${resource}`, async (req, res) => {
      await requireProduct(req.params.id);
      const { limit, offset } = paging.parse(req.query);
      const rows = await repository[resource](req.params.id, limit, offset);
      res.json({
        [resource]: rows,
        limit,
        offset,
        hasMore: rows.length === limit,
      });
    });
  app.post("/api/products/:id/scrape", actionLimit, async (req, res) => {
    const result = await scraping.scrape(await requireProduct(req.params.id));
    res
      .status(["busy", "inactive"].includes(result.status) ? 409 : 200)
      .json(result);
  });
  app.use("/api/cron", authCron(config.CRON_SECRET));
  app.get("/api/cron/jobs/:id", async (req, res) => {
    const job = await repository.getCron(uuid.parse(req.params.id));
    if (!job) return res.status(404).json({ error: "Job not found." });
    res.json({ job });
  });
  app.post("/api/cron/scrape", async (_req, res) => {
    const result = await scraping.enqueueScheduled();
    res.status(202).json(result);
  });
  app.use((_req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: "Invalid request. Check the supplied fields." });
    if (error.type === "entity.parse.failed")
      return res
        .status(400)
        .json({ error: "Request body must be valid JSON." });
    if (error.type === "entity.too.large")
      return res.status(413).json({ error: "Request body is too large." });
    if (error instanceof ScrapeError)
      return res
        .status(
          error.code === "PRODUCT_NOT_FOUND"
            ? 404
            : error.code === "INVALID_PRODUCT_PAGE"
              ? 400
              : 502,
        )
        .json({ error: error.message, code: error.code });
    if (error.cause?.message?.includes("TRACKING_LIMIT"))
      return res.status(409).json({
        error:
          "This shared demo supports 20 active products. Stop tracking one before adding another.",
      });
    if (error.status === 404)
      return res.status(404).json({ error: "Product not found." });
    logger.error({ err: error }, "Request failed");
    res.status(503).json({
      error: "The service could not complete the request. Please try again.",
    });
  });
  return app;
}
