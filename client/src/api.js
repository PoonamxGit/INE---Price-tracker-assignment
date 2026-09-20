const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export async function api(path, options = {}) {
  if (!base)
    throw Error("The API URL is not configured. Set VITE_API_BASE_URL.");
  let response;
  try {
    response = await fetch(`${base}/api${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw Error(
      "Cannot reach the tracker. Check your connection and try again.",
    );
  }
  if (response.status === 204) return null;
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error(
      "The server returned an unreadable response. Please try again.",
    );
  }
  if (!response.ok)
    throw Error(
      data.error ||
        (data.status === "busy"
          ? "A scrape is already running. Try again shortly."
          : "The request could not complete."),
    );
  return data;
}
export const time = (value) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "long",
      }).format(new Date(value))
    : "Not yet";
export const money = (price, currency) =>
  price === undefined || price === null
    ? "—"
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "INR",
        maximumFractionDigits: 2,
      }).format(Number(price));
