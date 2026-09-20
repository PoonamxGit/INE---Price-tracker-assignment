export class ScrapeError extends Error {
  constructor(code, message, { retryable = true, ...diagnostics } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.diagnostics = diagnostics;
  }
}
export function classify(error) {
  if (error instanceof ScrapeError) return error;
  if (error.name === "TimeoutError" || error.name === "AbortError")
    return new ScrapeError(
      "TIMEOUT",
      "The store did not finish loading within the time limit.",
    );
  return new ScrapeError(
    "UNKNOWN_ERROR",
    "Scraping could not complete. Check the server diagnostics.",
  );
}
