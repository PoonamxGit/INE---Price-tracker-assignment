import { Link } from "react-router-dom";
import { money, time } from "./api";
import { useLoad } from "./useLoad";
import { Status, Notice, Empty, ScrapeButton } from "./components";
import Search from "./Search";
export default function Dashboard() {
  const { data, error, loading, reload } = useLoad("/products");
  const products = data?.products || [];
  const failures = products.filter(
    (p) => p.last_scrape_status === "failed",
  ).length;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR STORE, IN VIEW</p>
          <h1>
            A little less checking.
            <br />
            <span>A little more knowing.</span>
          </h1>
          <p>Real prices. Recorded stock. Every scrape accounted for.</p>
        </div>
        <div className="schedule">
          <span className="pulse" /> Every 2 hours
          <small>Scheduled via your external cron</small>
        </div>
      </div>
      <div className="stats">
        <div>
          <span>TRACKED PRODUCTS</span>
          <strong>
            {loading ? "—" : products.length.toString().padStart(2, "0")}
          </strong>
        </div>
        <div>
          <span>NEED ATTENTION</span>
          <strong>
            {loading ? "—" : failures.toString().padStart(2, "0")}
          </strong>
        </div>
        <div>
          <span>DATA SOURCE</span>
          <strong className="stat-label">
            INE Store <span>↗</span>
          </strong>
        </div>
      </div>
      <Search onTracked={reload} />
      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE WATCHLIST</p>
            <h2>Your tracked products</h2>
          </div>
          <button className="text-button" onClick={reload}>
            Refresh list ↻
          </button>
        </div>
        <Notice>{error}</Notice>
        {loading && !data ? (
          <p role="status">Loading your watchlist…</p>
        ) : products.length === 0 && !error ? (
          <Empty title="Your watchlist starts here">
            Search for a product above to save its first real price and stock
            observation.
          </Empty>
        ) : (
          <div className="product-grid">
            {products.map((p) => {
              const latest = p.recent_history?.[0],
                previous = p.recent_history?.[1];
              const comparable =
                latest && previous && latest.currency === previous.currency;
              const change = comparable
                ? Number(latest.price) - Number(previous.price)
                : null;
              return (
                <article className="product-card" key={p.id}>
                  <div className="card-top">
                    <div className="product-icon" aria-hidden="true">
                      {p.image_url ? <img src={p.image_url} alt="" /> : "↗"}
                    </div>
                    <Status value={p.last_scrape_status} />
                  </div>
                  <p className="eyebrow">{p.sku}</p>
                  <h3>
                    <Link to={`/products/${p.id}`}>{p.name}</Link>
                  </h3>
                  <div className="price-row">
                    <strong>{money(latest?.price, latest?.currency)}</strong>
                    {change !== null && (
                      <span className={change < 0 ? "drop" : "muted"}>
                        {change < 0 ? "↓" : change > 0 ? "↑" : "—"}{" "}
                        {money(Math.abs(change), latest.currency)}
                      </span>
                    )}
                  </div>
                  <Status value={latest?.stock_status || "unknown"} />
                  <p className="last-seen">
                    Last successful scrape
                    <br />
                    {time(p.last_successful_scrape_at)}
                  </p>
                  <div className="card-actions">
                    <Link to={`/products/${p.id}`}>View details →</Link>
                    <ScrapeButton id={p.id} onDone={reload} />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
