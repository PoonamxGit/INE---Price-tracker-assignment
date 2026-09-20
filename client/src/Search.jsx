import { useState } from "react";
import { api } from "./api";
import { Notice } from "./components";
import { useSearch } from "./useSearch";
export default function Search({ onTracked }) {
  const [q, setQ] = useState(""),
    [busy, setBusy] = useState(null);
  const { results, setResults, catalog, loading, error, setError, search } =
    useSearch();
  async function submit(e) {
    e.preventDefault();
    await search(q.trim());
  }
  async function track(product) {
    setBusy(product.sourceProductId);
    setError("");
    try {
      const r = await api("/products", {
        method: "POST",
        body: JSON.stringify({ sourceProductId: product.sourceProductId }),
      });
      onTracked();
      if (r.scrape.status === "failed")
        setError(
          "Product tracked, but the first scrape failed. Open its details to see every attempt.",
        );
      else if (r.scrape.status === "busy")
        setError("Product tracked. Scrapers are busy; use Scrape now shortly.");
      else
        setResults((list) =>
          list.filter((p) => p.sourceProductId !== product.sourceProductId),
        );
    } catch (e) {
      setError(e.message);
      onTracked();
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="search-section">
      <div>
        <p className="eyebrow">DISCOVER & TRACK</p>
        <h2>Find your next price watch.</h2>
        <p>Search the INE store by a full or partial product name.</p>
      </div>
      <form onSubmit={submit}>
        <label className="sr-only" htmlFor="search">
          Product name
        </label>
        <div className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            id="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Try a product name…"
            minLength={2}
            maxLength={120}
            required
          />
          <button disabled={loading || q.trim().length < 2}>
            {loading ? "Searching…" : "Search store →"}
          </button>
        </div>
      </form>
      {loading && <p role="status">Contacting the INE store…</p>}
      {catalog && !catalog.complete && (
        <p role="status">
          Catalog discovery: {catalog.loaded} of {catalog.total ?? "…"}{" "}
          products. Results update as products are discovered; a cold catalog
          takes a few minutes.
        </p>
      )}
      <Notice>{error}</Notice>
      {results && (
        <div className="results">
          <p className="muted">{results.length} matching products</p>
          {results.length === 0 ? (
            <p>
              {catalog?.complete
                ? `No products match “${q}”. Try a shorter name.`
                : "No matches discovered yet. Catalog discovery is still in progress."}
            </p>
          ) : (
            results.map((p) => (
              <div className="search-result" key={p.sourceProductId}>
                <div>
                  <strong>{p.name}</strong>
                  <small>{p.sku}</small>
                </div>
                <button
                  className="secondary"
                  disabled={busy !== null}
                  onClick={() => track(p)}
                >
                  {busy === p.sourceProductId
                    ? "Tracking & scraping…"
                    : "+ Track product"}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
