import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { api, money, time } from "./api";
import { useLoad } from "./useLoad";
import { Status, Notice, Empty, ScrapeButton, Pagination } from "./components";
function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{money(p.price, p.currency)}</strong>
      <small>{time(p.scraped_at)}</small>
      <small>{p.stock_status.replaceAll("_", " ")}</small>
    </div>
  );
}
export default function ProductDetail() {
  const { id } = useParams();
  const productState = useLoad(`/products/${id}`),
    [historyOffset, setHistoryOffset] = useState(0),
    [logOffset, setLogOffset] = useState(0);
  const historyState = useLoad(
      `/products/${id}/history?limit=100&offset=${historyOffset}`,
    ),
    logState = useLoad(`/products/${id}/logs?limit=50&offset=${logOffset}`);
  const latestState = useLoad(`/products/${id}/history?limit=1`);
  const [actionError, setActionError] = useState(""),
    [stopping, setStopping] = useState(false);
  const product = productState.data?.product,
    history = historyState.data?.history || [],
    logs = logState.data?.logs || [],
    latest = latestState.data?.history?.[0];
  function reload() {
    productState.reload();
    historyState.reload();
    logState.reload();
    latestState.reload();
  }
  async function stop() {
    setStopping(true);
    try {
      await api(`/products/${id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setStopping(false);
    }
  }
  return (
    <>
      <Link className="back" to="/">
        ← Back to watchlist
      </Link>
      <Notice>{productState.error || actionError}</Notice>
      {productState.loading && !productState.data ? (
        <p role="status">Loading product…</p>
      ) : (
        product && (
          <>
            <div className="detail-heading">
              <div>
                <p className="eyebrow">
                  {product.sku} ·{" "}
                  {product.is_active ? "TRACKING ACTIVE" : "TRACKING PAUSED"}
                </p>
                <h1>{product.name}</h1>
                <a
                  className="source-link"
                  href={product.product_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on INE Store ↗
                </a>
              </div>
              <div className="detail-actions">
                {product.is_active && <ScrapeButton id={id} onDone={reload} />}
                <button className="text-button" onClick={reload}>
                  Refresh
                </button>
                {product.is_active && (
                  <button
                    className="text-button danger"
                    disabled={stopping}
                    onClick={stop}
                  >
                    {stopping ? "Stopping…" : "Stop tracking"}
                  </button>
                )}
              </div>
            </div>
            <div className="stats detail-stats">
              <div>
                <span>LATEST SUCCESSFUL PRICE</span>
                <strong>{money(latest?.price, latest?.currency)}</strong>
              </div>
              <div>
                <span>STOCK</span>
                <strong className="stat-label">
                  <Status value={latest?.stock_status || "unknown"} />
                </strong>
                <small>
                  {latest?.stock_quantity !== null &&
                  latest?.stock_quantity !== undefined
                    ? `${latest.stock_quantity} units reported`
                    : "Quantity not reported"}
                </small>
              </div>
              <div>
                <span>LAST SUCCESSFUL SCRAPE</span>
                <strong className="stat-date">
                  {time(product.last_successful_scrape_at)}
                </strong>
                <Status value={product.last_scrape_status} />
              </div>
            </div>
            <Notice>{latestState.error}</Notice>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">THE BIG PICTURE</p>
                  <h2>Price over time</h2>
                </div>
                <span className="muted">
                  {history.length} observations on this page
                </span>
              </div>
              <Notice>{historyState.error}</Notice>
              {historyState.loading ? (
                <p role="status">Loading price history…</p>
              ) : history.length === 0 ? (
                <Empty title="No successful observations yet">
                  Run a scrape to record a validated price. Failed attempts
                  appear in the log below.
                </Empty>
              ) : new Set(history.map((h) => h.currency)).size > 1 ? (
                <p>
                  Multiple currencies were recorded. Use the history table to
                  compare values in their original currencies.
                </p>
              ) : (
                <div
                  className="chart"
                  role="img"
                  aria-label="Price history chart; the same observations are available in the table below"
                >
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart
                      data={[...history].reverse().map((h) => ({
                        ...h,
                        chartPrice: Number(h.price),
                        timestamp: Date.parse(h.scraped_at),
                      }))}
                      margin={{ top: 15, right: 20, left: 5, bottom: 10 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="#e3e9e5"
                      />
                      <XAxis
                        dataKey="timestamp"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(v) => new Date(v).toLocaleDateString()}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        domain={["auto", "auto"]}
                        tickFormatter={(v) => money(v, history[0].currency)}
                        width={100}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Line
                        type="linear"
                        dataKey="chartPrice"
                        stroke="#28715a"
                        strokeWidth={3}
                        dot={{ r: 4, fill: "#28715a" }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <h3>Price & stock history</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Observed at (local time)</th>
                      <th>Price</th>
                      <th>Stock</th>
                      <th>Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id}>
                        <td>{time(h.scraped_at)}</td>
                        <td>{money(h.price, h.currency)}</td>
                        <td>
                          <Status value={h.stock_status} />
                        </td>
                        <td>{h.stock_quantity ?? "Unknown"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                offset={historyOffset}
                size={100}
                hasMore={historyState.data?.hasMore}
                setOffset={setHistoryOffset}
              />
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">NOTHING SWEPT UNDER THE RUG</p>
                  <h2>Scrape attempt log</h2>
                </div>
                <button className="text-button" onClick={logState.reload}>
                  Refresh logs ↻
                </button>
              </div>
              <p className="muted">
                Every application attempt, including retries. Open diagnostics
                to see the store’s internal request outcomes.
              </p>
              <Notice>{logState.error}</Notice>
              {logState.loading ? (
                <p role="status">Loading attempts…</p>
              ) : logs.length === 0 ? (
                <Empty title="No attempts recorded">
                  Scrape activity will appear here, whether it succeeds or
                  fails.
                </Empty>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Started at (local time)</th>
                        <th>Run / attempt</th>
                        <th>Outcome</th>
                        <th>Duration</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log.id}>
                          <td>{time(log.created_at)}</td>
                          <td>
                            <code title={log.run_id}>
                              {log.run_id.slice(0, 8)}
                            </code>
                            <small>Attempt {log.attempt_number}</small>
                          </td>
                          <td>
                            <Status value={log.status} />
                          </td>
                          <td>
                            {log.duration_ms === null
                              ? "In progress"
                              : `${(log.duration_ms / 1000).toFixed(1)}s`}
                          </td>
                          <td>
                            {log.error_type && (
                              <strong>{log.error_type}</strong>
                            )}
                            <small>
                              {log.error_message ||
                                (log.status === "success"
                                  ? "Validated price and stock"
                                  : "Attempt in progress")}
                            </small>
                            <details>
                              <summary>Diagnostics</summary>
                              <pre>
                                {JSON.stringify(log.diagnostics, null, 2)}
                              </pre>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pagination
                offset={logOffset}
                size={50}
                hasMore={logState.data?.hasMore}
                setOffset={setLogOffset}
              />
            </section>
          </>
        )
      )}
    </>
  );
}
