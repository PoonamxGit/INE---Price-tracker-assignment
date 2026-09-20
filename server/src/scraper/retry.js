import { randomUUID } from "node:crypto";
import { classify } from "./errors.js";
import { observationSchema } from "./validators.js";
export const backoff = (attempt, random = Math.random) =>
  1000 * 2 ** (attempt - 1) + Math.floor(random() * 500);
export async function runScrape({
  product,
  extract,
  repository,
  runId = randomUUID(),
  maxAttempts = 3,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  progress = () => {},
  onAttempt = () => {},
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = Date.now();
    await repository.startAttempt(runId, product.id, attempt);
    progress(`Attempt ${attempt}/${maxAttempts}`);
    let result;
    try {
      result = await extract(attempt);
      observationSchema.parse(result.observation);
    } catch (error) {
      const failure = classify(error);
      const retry = failure.retryable && attempt < maxAttempts;
      await repository.failAttempt({
        runId,
        productId: product.id,
        attempt,
        status: retry ? "retried" : "failed",
        error_type: failure.code,
        error_message: failure.message.slice(0, 300),
        duration_ms: Date.now() - start,
        diagnostics: failure.diagnostics,
      });
      onAttempt({
        attempt,
        status: retry ? "retried" : "failed",
        duration_ms: Date.now() - start,
        error_type: failure.code,
      });
      progress(
        `Attempt ${retry ? "retried" : "failed"}: ${failure.code} — ${failure.message}`,
      );
      if (!retry) return { runId, status: "failed", error: failure.code };
      await sleep(backoff(attempt));
      continue;
    }
    // Persistence failures must escape: retrying a commit as a new scrape could
    // fabricate another observation after a successful but lost DB response.
    progress("Saving observation...");
    await repository.succeedAttempt({
      runId,
      productId: product.id,
      attempt,
      duration_ms: Date.now() - start,
      ...result,
    });
    onAttempt({
      attempt,
      status: "success",
      duration_ms: Date.now() - start,
      error_type: null,
    });
    progress("Scrape succeeded.");
    return { runId, status: "success", observation: result.observation };
  }
  throw new Error("maxAttempts must be positive");
}
