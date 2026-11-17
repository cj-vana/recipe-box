// JSON calls to the Recipe Box server. Errors carry the HTTP status (0 when offline), so
// callers can tell "signed out" (401) apart from "no network".
export class ApiError extends Error {
  constructor(message, status, retryAfterSeconds = 0) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

let unauthorizedHandler = null;

// Called when any request other than signing in comes back 401: the session ended.
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

export function isOfflineError(error) {
  return error instanceof ApiError && (error.status === 0 || error.status === 503);
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  let response;
  try {
    response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  } catch {
    throw new ApiError("You appear to be offline.", 0);
  }
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) {
    const signingIn = path === "/api/session" && (options.method || "GET") === "POST";
    if (response.status === 401 && !signingIn && unauthorizedHandler) unauthorizedHandler();
    throw new ApiError(payload?.error || `Request failed (${response.status}).`, response.status, Number(response.headers.get("retry-after")) || 0);
  }
  return payload;
}
