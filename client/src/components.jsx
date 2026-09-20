import { useState } from "react";
import { api } from "./api";
export function Status({ value }) {
  return (
    <span className={`status ${value || "waiting"}`}>
      {(value || "waiting").replaceAll("_", " ")}
    </span>
  );
}
export function Notice({ children }) {
  return children ? (
    <div className="notice" role="alert">
      {children}
    </div>
  ) : null;
}
export function Empty({ title, children }) {
  return (
    <div className="empty">
      <div className="empty-icon">↗</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function ScrapeButton({ id, onDone }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function run() {
    setBusy(true);
    setMessage("");
    try {
      const r = await api(`/products/${id}/scrape`, { method: "POST" });
      if (r.status === "failed")
        setMessage(`Scrape failed: ${r.error}. See attempt logs.`);
      onDone();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="secondary" disabled={busy} onClick={run}>
        {busy ? "Scraping…" : "↻ Scrape now"}
      </button>
      <Notice>{message}</Notice>
    </div>
  );
}
export function Pagination({ offset, size, hasMore, setOffset }) {
  return (
    <div className="pagination">
      <button
        className="text-button"
        disabled={offset === 0}
        onClick={() => setOffset(Math.max(0, offset - size))}
      >
        ← Newer
      </button>
      <span className="muted">Page {offset / size + 1}</span>
      <button
        className="text-button"
        disabled={!hasMore}
        onClick={() => setOffset(offset + size)}
      >
        Older →
      </button>
    </div>
  );
}
