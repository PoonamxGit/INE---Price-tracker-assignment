import { chromium } from "playwright";
import {
  ORIGIN,
  productUrl,
  observationSchema,
  validateIdentity,
} from "./validators.js";
import { storeJson, getMetadata } from "./fetcher.js";
import { extractSnapshot } from "./extractor.js";
import { ScrapeError, classify } from "./errors.js";
export const SOURCE_VERSION = "ine-visible-v1";
export async function readSnapshot(page, priceClass = null) {
  return page.evaluate(
    ({ priceClass }) => {
      const clean = (v) =>
        (v ?? "")
          .normalize("NFKC")
          .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
          .trim();
      const root = document.querySelector(".price-main");
      const block = document.querySelector(".price-block");
      const visible = (el) => {
        const s = getComputedStyle(el);
        return (
          s.display !== "none" &&
          s.visibility !== "hidden" &&
          s.opacity !== "0" &&
          el.getBoundingClientRect().width > 0 &&
          el.getAttribute("aria-hidden") !== "true"
        );
      };
      const candidates = root
        ? [...root.children].filter(
            (el) =>
              visible(el) &&
              !getComputedStyle(el).textDecorationLine.includes(
                "line-through",
              ) &&
              /^(₹|Rs\.?|INR|USD|\$|EUR|€)\s*[\d\s]/i.test(
                clean(el.textContent),
              ),
          )
        : [];
      const mapped = priceClass
        ? candidates.filter((el) => el.classList.contains(priceClass))
        : [];
      return {
        id: location.pathname.split("/")[2],
        heading: clean(document.querySelector("h1")?.textContent),
        skuText: clean(document.querySelector(".detail-brand")?.textContent),
        container: !!root,
        pending:
          /Updating/.test(block?.textContent ?? "") ||
          candidates.some((el) => Number(getComputedStyle(el).opacity) < 1),
        prices: candidates.map((el) => clean(el.textContent)),
        stock: (() => {
          const stocks = [
            ...document.querySelectorAll(".price-facets .stock-badge"),
          ].filter(visible);
          return stocks.length === 1 ? clean(stocks[0].textContent) : "";
        })(),
        method: mapped.length === 1 ? "layout-and-visible-dom" : "visible-dom",
        title: document.title,
      };
    },
    { priceClass },
  );
}
async function dismissConsent(page) {
  const decline = page.getByRole("button", {
    name: "Decline cookies",
    exact: true,
  });
  for (let i = 0; i < 5 && (await decline.isVisible()); i++)
    await decline.click({ timeout: 1500 });
}
export async function scrapeProduct(
  expected,
  {
    headed = false,
    timeout = 45000,
    fault,
    attempt = 1,
    progress = () => {},
  } = {},
) {
  if (fault && (process.env.NODE_ENV === "production" || !headed))
    throw new ScrapeError(
      "INVALID_CONFIGURATION",
      "Demonstration faults are allowed only in development headed mode.",
      { retryable: false },
    );
  const diagnostics = {
    extraction_method: "playwright-visible-dom",
    source_version: SOURCE_VERSION,
    network_events: [],
  };
  let browser,
    context,
    timer,
    expired = false;
  const started = Date.now();
  let stage = "metadata";
  const remaining = () => Math.max(1, timeout - (Date.now() - started));
  timer = setTimeout(() => {
    expired = true;
    if (context)
      void context.close().catch(() => {
        diagnostics.context_close_failed = true;
      });
  }, timeout);
  try {
    validateIdentity(
      await getMetadata(expected.id, { timeout: remaining() }),
      expected,
    );
    // The actual host clock was 18s ahead of the store. Align browser time only;
    // do not alter the challenge, its payload, browser fingerprint or trusted events.
    const before = Date.now();
    const clock = await storeJson("/api/challenge", { timeout: remaining() });
    const after = Date.now();
    if (!Number.isSafeInteger(clock.ts) || Math.abs(clock.ts - after) > 300000)
      throw new ScrapeError("CLOCK_SKEW", "Store clock cannot be validated.", {
        retryable: false,
      });
    const offset = clock.ts - (before + after) / 2;
    diagnostics.clock_offset_ms = Math.round(offset);
    browser = await chromium.launch({
      headless: !headed,
      slowMo: headed ? 120 : 0,
      timeout: Math.min(15000, remaining()),
    });
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      try {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) return await route.abort("blockedbyclient");
        if (
          fault === "slow" &&
          url.pathname === `/api/product/${expected.id}`
        ) {
          progress(
            "DEVELOPMENT DEMONSTRATION FAULT INJECTION: delaying metadata response by 5 seconds",
          );
          await new Promise((r) => setTimeout(r, 5000));
        }
        if (
          fault === "fail-first" &&
          attempt === 1 &&
          route.request().isNavigationRequest()
        ) {
          progress(
            "DEVELOPMENT DEMONSTRATION FAULT INJECTION: aborting first navigation",
          );
          return await route.abort("failed");
        }
        // route.continue can follow redirects without another route callback.
        // Fetch without redirect following, then fulfill only the allowed response.
        const response = await route.fetch({
          maxRedirects: 0,
          timeout: remaining(),
        });
        if (response.status() >= 300 && response.status() < 400) {
          diagnostics.redirect_blocked = true;
          return await route.abort("blockedbyclient");
        }
        await route.fulfill({ response });
      } catch (error) {
        diagnostics.route_error =
          error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR";
        await route.abort().catch(() => {
          diagnostics.route_abort_failed = true;
        });
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(4000);
    if (Math.abs(offset) > 2000)
      await page.clock.install({ time: new Date(Date.now() + offset) });
    let priceClass = null;
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith("/api/") && diagnostics.network_events.length < 80)
        diagnostics.network_events.push({
          path,
          status: response.status(),
          elapsed_ms: Date.now() - started,
        });
      if (path === "/api/layout" && response.ok())
        response
          .json()
          .then((data) => {
            if (typeof data.classes?.priceValue === "string")
              priceClass = data.classes.priceValue;
          })
          .catch(() => {
            diagnostics.layout_invalid = true;
          });
    });

    progress("Opening product...");
    const response = await page.goto(productUrl(expected.id), {
      waitUntil: "domcontentloaded",
      timeout: remaining(),
    });
    diagnostics.http_status = response?.status();
    diagnostics.final_url = page.url();
    if (response && !response.ok())
      throw new ScrapeError(
        "HTTP_ERROR",
        `Product page returned HTTP ${response.status()}.`,
        {
          http_status: response.status(),
          retryable: response.status() >= 500 || response.status() === 429,
        },
      );
    if (page.url() !== productUrl(expected.id))
      throw new ScrapeError(
        "INVALID_PRODUCT_PAGE",
        "Unexpected product navigation.",
        { retryable: false },
      );
    stage = "waiting-product";
    progress("Waiting for product data...");
    await page
      .locator(".price-block")
      .waitFor({ timeout: Math.min(remaining(), 15000) });
    stage = "price";
    let lastClick = 0;
    while (Date.now() - started < timeout) {
      await dismissConsent(page);
      if (await page.locator(".price-error").count())
        throw new ScrapeError(
          "PAGE_LOAD_ERROR",
          `Store price flow failed: ${(await page.locator(".price-error").innerText()).slice(0, 180)}`,
        );
      if (await page.locator(".price-success").count()) {
        const snapshot = await readSnapshot(page, priceClass);
        if (!snapshot.pending) {
          progress("Extracting price and stock...");
          diagnostics.extraction_method = snapshot.method;
          diagnostics.page_title = snapshot.title;
          progress("Validating...");
          const observation = observationSchema.parse(
            extractSnapshot(snapshot, expected),
          );
          return { observation, diagnostics };
        }
      }
      if (Date.now() - lastClick > 2500) {
        const block = page.locator(".price-block");
        await block.scrollIntoViewIfNeeded();
        const box = await block.boundingBox();
        if (!box)
          throw new ScrapeError(
            "STRUCTURE_CHANGED",
            "The price area is not visible.",
          );
        for (let i = 0; i < 12; i++) {
          await page.mouse.move(box.x + 15 + i * 6, box.y + 15 + (i % 3) * 4);
          await page.waitForTimeout(65);
        }
        await dismissConsent(page);
        const button = page.getByRole("button", {
          name: /^(Reveal price|Refresh price)$/,
        });
        if ((await button.count()) && (await button.first().isEnabled())) {
          await button.first().click({ timeout: 2000 });
          lastClick = Date.now();
        }
      }
      await page.waitForTimeout(250);
    }
    throw new ScrapeError(
      "TIMEOUT",
      "The store did not produce a completed price in time.",
    );
  } catch (error) {
    const failure = expired
      ? new ScrapeError("TIMEOUT", "The store exceeded the scrape time limit.")
      : classify(error);
    if (failure.code === "UNKNOWN_ERROR" && /net::ERR/.test(error.message)) {
      failure.code = "NETWORK_ERROR";
      failure.message = "The product navigation failed.";
    }
    if (
      failure.code === "TIMEOUT" &&
      stage === "waiting-product" &&
      diagnostics.network_events.some(
        (e) => e.path === `/api/product/${expected.id}` && e.status === 200,
      ) &&
      !expired
    )
      failure.code = "STRUCTURE_CHANGED";
    failure.diagnostics = { ...diagnostics, ...failure.diagnostics };
    throw failure;
  } finally {
    clearTimeout(timer);
    if (context) await context.close();
    if (browser) await browser.close();
  }
}
