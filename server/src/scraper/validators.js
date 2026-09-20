import { z } from "zod";
import { ScrapeError } from "./errors.js";
export const ORIGIN = "https://demo.inelabteamdev.com";
export function productId(input) {
  const value = String(input);
  if (/^[1-9]\d{0,8}$/.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ScrapeError(
      "INVALID_PRODUCT_PAGE",
      "Enter an INE product ID or product URL.",
      { retryable: false },
    );
  }
  if (
    url.origin !== ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/product\/[1-9]\d{0,8}\/?$/.test(url.pathname)
  )
    throw new ScrapeError(
      "INVALID_PRODUCT_PAGE",
      "Only INE store product URLs are allowed.",
      { retryable: false },
    );
  return url.pathname.split("/")[2];
}
export const productUrl = (id) => `${ORIGIN}/product/${productId(id)}`;
export const metadataSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  sku: z.string().min(1),
  slug: z.string().min(1),
  brand: z.string(),
  category: z.string(),
  description: z.string(),
});
export const observationSchema = z
  .object({
    price: z.string().regex(/^\d{1,12}\.\d{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    stock_status: z.enum(["in_stock", "out_of_stock", "limited", "unknown"]),
    stock_quantity: z.number().int().nonnegative().nullable(),
    scraped_at: z.iso.datetime(),
  })
  .superRefine((v, c) => {
    if (v.stock_status === "out_of_stock" && v.stock_quantity !== 0)
      c.addIssue({
        code: "custom",
        message: "Out of stock requires observed zero.",
      });
    if (
      ["in_stock", "limited"].includes(v.stock_status) &&
      v.stock_quantity !== null &&
      v.stock_quantity < 1
    )
      c.addIssue({
        code: "custom",
        message: "Positive stock must be greater than zero.",
      });
  });
export function validateIdentity(actual, expected) {
  if (
    String(actual.id) !== String(expected.id) ||
    actual.name !== expected.name ||
    actual.sku !== expected.sku
  )
    throw new ScrapeError(
      "INVALID_PRODUCT_PAGE",
      "The loaded product does not match the tracked product.",
      { retryable: false },
    );
}
