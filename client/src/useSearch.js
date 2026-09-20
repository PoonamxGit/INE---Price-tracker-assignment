import { useEffect, useRef, useState } from "react";
import { api } from "./api";
export function useSearch() {
  const [results, setResults] = useState(null),
    [catalog, setCatalog] = useState(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const version = useRef(0),
    timer = useRef(null);
  useEffect(
    () => () => {
      version.current++;
      clearTimeout(timer.current);
    },
    [],
  );
  async function search(query) {
    const current = ++version.current;
    clearTimeout(timer.current);
    setLoading(true);
    setError("");
    setResults(null);
    setCatalog(null);
    async function poll() {
      try {
        const result = await api(
          `/store/search?q=${encodeURIComponent(query)}`,
        );
        if (current !== version.current) return;
        setResults(result.products);
        setCatalog(result.catalog);
        setLoading(false);
        if (result.catalog.error) setError(result.catalog.error);
        if (!result.catalog.complete && !result.catalog.error)
          timer.current = setTimeout(poll, 5000);
      } catch (e) {
        if (current === version.current) {
          setError(e.message);
          setLoading(false);
        }
      }
    }
    await poll();
  }
  return { results, setResults, catalog, loading, error, setError, search };
}
