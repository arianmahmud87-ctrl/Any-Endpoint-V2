import { ApiError } from "./types";

let csrfToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Store CSRF token in runtime memory only. */
export const setCsrfToken = (t: string | null): void => {
  csrfToken = t;
};
export const setUnauthorizedHandler = (fn: () => void): void => {
  onUnauthorized = fn;
};

/** Central typed client: same-origin, cookie credentials, CSRF on mutations. */
export async function api<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method ?? "GET";
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const devUserId = import.meta.env.VITE_USER_ID as string | undefined;
    if (devUserId) headers["X-User-Id"] = devUserId;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
    const res = await fetch(path, {
      method,
      headers,
      credentials: "include",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
    if (!res.ok) {
      let message = "Something went wrong.";
      let type = "error";
      let fields: Record<string, string> | undefined;
      try {
        const j = (await res.json()) as { error?: { message?: string; type?: string; fields?: Record<string, string> }; fields?: Record<string, string> };
        message = j.error?.message ?? message;
        type = j.error?.type ?? type;
        fields = j.error?.fields ?? j.fields;
      } catch {
        /* non-JSON error body */
      }
      const ra = res.headers.get("Retry-After");
      throw new ApiError(res.status, message, type, ra ? Number(ra) : undefined, fields);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && path !== "/api/me") onUnauthorized?.();
    throw e;
  }
}

/** Map an error to a short user-facing message. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.status) {
      case 400: return e.message;
      case 401: return "Your session expired. Sign in again.";
      case 403: return e.type === "no_active_profile" ? (e.message || "No active Codex profile is available.") : "You don't have permission for this.";
      case 404: return "This resource is unavailable.";
      case 409: return "That changed elsewhere. Data was refreshed.";
      case 429: return `Rate limit reached.${e.retryAfter ? ` Try again in ${e.retryAfter}s.` : " Try again shortly."}`;
      case 503: return e.message || "A worker or dependency is unavailable.";
      default: return e.status >= 500 ? "Server error. Please retry." : e.message;
    }
  }
  return "Network error. Check your connection.";
}
