import { z } from "zod";
import { ORIGIN, metadataSchema, productId } from "./validators.js";
import { ScrapeError } from "./errors.js";
export async function storeJson(
  path,
  { timeout = 15000, fetchImpl = fetch } = {},
) {
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN)
    throw new ScrapeError(
      "INVALID_PRODUCT_PAGE",
      "Store request outside allowlist.",
      { retryable: false },
    );
  const signal = AbortSignal.timeout(timeout);
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: "error",
      signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new ScrapeError(
      signal.aborted || error.name === "TimeoutError"
        ? "TIMEOUT"
        : "NETWORK_ERROR",
      "Could not fetch store data.",
    );
  }
  if (!response.ok)
    throw new ScrapeError(
      response.status === 404 ? "PRODUCT_NOT_FOUND" : "HTTP_ERROR",
      `Store returned HTTP ${response.status}.`,
      {
        retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
        http_status: response.status,
      },
    );
  try {
    return await response.json();
  } catch {
    throw new ScrapeError(
      signal.aborted ? "TIMEOUT" : "STRUCTURE_CHANGED",
      signal.aborted
        ? "Store response body timed out."
        : "The store returned invalid JSON.",
    );
  }
}
export async function getMetadata(id, options) {
  const parsed = metadataSchema.safeParse(
    await storeJson(`/api/product/${productId(id)}`, options),
  );
  if (!parsed.success)
    throw new ScrapeError(
      "STRUCTURE_CHANGED",
      "Store product metadata no longer matches the observed schema.",
    );
  if (String(parsed.data.id) !== productId(id))
    throw new ScrapeError(
      "INVALID_PRODUCT_PAGE",
      "The store returned a different product.",
      { retryable: false },
    );
  return parsed.data;
}
const catalogSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(60),
  pages: z.number().int().positive().max(100),
  total: z.number().int().nonnegative().max(6000),
  items: z.array(metadataSchema),
});
export async function collectCatalog({
  request = storeJson,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxRequests = 250,
  onProgress = () => {},
} = {}) {
  const items = new Map();
  let pages = 1,
    total;
  // The live store reshuffles on EVERY request, even for the same page.
  // One pagination pass is incomplete. Deduplicate observed IDs and require
  // the advertised total; never turn a partial catalog into a false no-result.
  for (let requestNumber = 0; requestNumber < maxRequests; requestNumber++) {
    const page = (requestNumber % pages) + 1;
    let data;
    for (let attempt = 1; attempt <= 3; attempt++)
      try {
        const parsed = catalogSchema.safeParse(
          await request(`/api/catalog?page=${page}&pageSize=60`),
        );
        if (!parsed.success)
          throw new ScrapeError(
            "STRUCTURE_CHANGED",
            "Catalog response schema changed.",
          );
        data = parsed.data;
        break;
      } catch (error) {
        if (attempt === 3 || error.retryable === false) throw error;
        await sleep(
          error.diagnostics?.http_status === 429
            ? 30000
            : 1000 * 2 ** (attempt - 1) + Math.random() * 500,
        );
      }
    if (
      data.page !== page ||
      (total !== undefined && (total !== data.total || pages !== data.pages))
    )
      throw new ScrapeError(
        "STRUCTURE_CHANGED",
        "Catalog size changed during loading. Please search again.",
      );
    total = data.total;
    pages = data.pages;
    for (const product of data.items) items.set(product.id, product);
    onProgress([...items.values()], total);
    if (items.size === total) return [...items.values()];
    if (items.size > total)
      throw new ScrapeError(
        "STRUCTURE_CHANGED",
        "Catalog contains more IDs than its advertised total.",
      );
    await sleep(1200);
  }
  throw new ScrapeError(
    "CATALOG_INCOMPLETE",
    `Only ${items.size} of ${total} store products were received. Please retry the search.`,
  );
}
export function createSearchCache(collect = collectCatalog) {
  let cached = [],
    total = null,
    complete = false,
    expires = 0,
    inflight,
    lastError = null;
  return async function search(query) {
    if (!inflight && Date.now() >= expires) {
      cached = [];
      complete = false;
      lastError = null;
      inflight = collect({
        onProgress: (items, count) => {
          cached = items;
          total = count;
        },
      })
        .then((items) => {
          cached = items;
          total = items.length;
          complete = true;
          expires = Date.now() + 300000;
        })
        .catch((error) => {
          lastError = error;
          expires = Date.now() + 30000;
        })
        .finally(() => {
          inflight = null;
        });
    }
    if (cached.length === 0 && inflight)
      await Promise.race([inflight, new Promise((r) => setTimeout(r, 1500))]);
    if (lastError && cached.length === 0) throw lastError;
    return {
      products: cached
        .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
        .map((p) => ({
          sourceProductId: String(p.id),
          name: p.name,
          sku: p.sku,
          url: `${ORIGIN}/product/${p.id}`,
          imageUrl: null,
        })),
      catalog: {
        loaded: cached.length,
        total,
        complete,
        loading: !!inflight,
        error: lastError?.message || null,
      },
    };
  };
}
export const searchStore = createSearchCache();
