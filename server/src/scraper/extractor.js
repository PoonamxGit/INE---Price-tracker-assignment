import { ScrapeError } from "./errors.js";
export const normalize = (text) =>
  String(text)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00a0/g, " ")
    .trim();
export function parsePrice(raw) {
  if (raw === null || raw === undefined || !normalize(raw))
    throw new ScrapeError("PRICE_NOT_FOUND", "The selling price is missing.");
  const text = normalize(raw);
  const currency = /^(₹|Rs\.?|INR)\s*/i.test(text)
    ? "INR"
    : /^(USD|\$)\s*/.test(text)
      ? "USD"
      : /^(EUR|€)\s*/.test(text)
        ? "EUR"
        : null;
  if (!currency)
    throw new ScrapeError(
      "INVALID_PRICE",
      "The price currency is missing or unsupported.",
    );
  let number = text
    .replace(/^(₹|Rs\.?|INR|USD|\$|EUR|€)\s*/i, "")
    .replace(/\/-\s*\(incl\. of all taxes\)$/i, "")
    .replace(/\s/g, "");
  // The observed euro formatter uses dot thousands and comma decimals.
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(number) || /^\d+,\d{2}$/.test(number))
    number = number.replace(/\./g, "").replace(",", ".");
  else if (
    /^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{2})?$/.test(
      number,
    )
  )
    number = number.replace(/,/g, "");
  else
    throw new ScrapeError(
      "INVALID_PRICE",
      "The selling price format is not recognized.",
    );
  const [whole, decimal = "00"] = number.split(".");
  const price = `${whole.replace(/^0+(?=\d)/, "")}.${decimal}`;
  if (!/^\d{1,12}\.\d{2}$/.test(price) || !Number.isFinite(Number(price)))
    throw new ScrapeError(
      "INVALID_PRICE",
      "The selling price is outside the supported range.",
    );
  return { price, currency };
}
export function parseStock(raw) {
  if (raw === null || raw === undefined || !normalize(raw))
    throw new ScrapeError("STOCK_NOT_FOUND", "The stock value is missing.");
  const text = normalize(raw).toLowerCase();
  if (text === "out of stock")
    return { stock_status: "out_of_stock", stock_quantity: 0 };
  if (text === "unknown")
    return { stock_status: "unknown", stock_quantity: null };
  const match = text.match(
    /^(?:in stock · (\d+) left|only (\d+) left|(\d+) in stock|selling fast [—–-] (\d+) left|hurry, just (\d+) left)$/,
  );
  if (!match)
    throw new ScrapeError(
      "STOCK_NOT_FOUND",
      "The stock format is not recognized.",
    );
  const quantity = Number(match.slice(1).find((v) => v !== undefined));
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647)
    throw new ScrapeError("STOCK_NOT_FOUND", "The stock quantity is invalid.");
  return {
    stock_status: /^(only|selling fast|hurry)/.test(text)
      ? "limited"
      : "in_stock",
    stock_quantity: quantity,
  };
}
export function extractSnapshot(snapshot, expected) {
  if (
    snapshot.id !== String(expected.id) ||
    snapshot.heading !== expected.name ||
    !snapshot.skuText.endsWith(`SKU ${expected.sku}`)
  )
    throw new ScrapeError(
      "INVALID_PRODUCT_PAGE",
      "The page identity differs from the expected product.",
      { retryable: false },
    );
  if (!snapshot.container)
    throw new ScrapeError(
      "STRUCTURE_CHANGED",
      "The previously observed price container is missing.",
    );
  if (snapshot.pending)
    throw new ScrapeError(
      "EXTRACTION_ERROR",
      "The store is still showing a provisional price.",
    );
  if (snapshot.prices.length !== 1)
    throw new ScrapeError(
      "STRUCTURE_CHANGED",
      `Expected one visible selling price; found ${snapshot.prices.length}.`,
    );
  return {
    ...parsePrice(snapshot.prices[0]),
    ...parseStock(snapshot.stock),
    scraped_at: new Date().toISOString(),
  };
}
