import { configFromEnv } from "./config.js";
import { createRepository } from "./db/repository.js";
import { createScrapingService } from "./services/scraping.js";
import { createApp } from "./app.js";
import { logger } from "./logger.js";
const config = configFromEnv();
const repository = createRepository(config);
const scraping = createScrapingService(repository, config);
const app = createApp({ repository, config, scraping });
scraping.kick();
const server = app.listen(config.PORT, "0.0.0.0", () =>
  logger.info({ port: config.PORT }, "Price tracker listening"),
);
server.requestTimeout = 0;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    logger.info({ signal }, "Draining requests");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 25000).unref();
  });
