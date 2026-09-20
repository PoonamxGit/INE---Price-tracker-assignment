import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import Dashboard from "./Dashboard";
const ProductDetail = lazy(() => import("./ProductDetail"));
import { Empty } from "./components";
import "./styles.css";
function App() {
  return (
    <BrowserRouter>
      <header className="header">
        <Link className="brand" to="/">
          <span className="brand-mark">↗</span> pricewatch
          <span className="brand-dot">.</span>
        </Link>
        <nav>
          <Link to="/">Watchlist</Link>
          <a
            href="https://demo.inelabteamdev.com/"
            target="_blank"
            rel="noreferrer"
          >
            INE Store ↗
          </a>
        </nav>
        <span className="header-note">A clearer view of every price.</span>
      </header>
      <main>
        <Suspense fallback={<p role="status">Loading product details…</p>}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/products/:id" element={<ProductDetail />} />
            <Route
              path="*"
              element={
                <Empty title="Page not found">
                  <Link to="/">Return to your watchlist</Link>
                </Empty>
              }
            />
          </Routes>
        </Suspense>
      </main>
      <footer>
        <span>
          pricewatch. <span className="muted">Built for the INE store.</span>
        </span>
        <span>
          Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>
      </footer>
    </BrowserRouter>
  );
}
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
