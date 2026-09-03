import type { Platform } from "./types";

export interface NormalizedError {
  code: string;
  message: string;
  httpStatus: number;
  upstreamRequestId?: string;
  /** Whether trying a different listing could plausibly succeed. Unused until M4. */
  retryable: boolean;
}

/**
 * The three platforms disagree on error shape:
 *   CKey      {"error":{"message", "request_id", "type"}}
 *   Vilao v1  {"error":{"code",    "message",    "type"}}
 *   Vilao v2  {"error":{"code",    "message",    "hint"}}
 */
export function normalizeUpstreamError(
  _platform: Platform,
  httpStatus: number,
  body: unknown,
): NormalizedError {
  const err = (body as { error?: Record<string, unknown> } | null)?.error ?? {};
  const code = String(err.code ?? err.type ?? `http_${httpStatus}`);
  const message = String(err.message ?? "Upstream request failed");
  const requestId = err.request_id ? String(err.request_id) : undefined;

  return {
    code,
    message,
    httpStatus,
    upstreamRequestId: requestId,
    retryable: isRetryable(httpStatus),
  };
}

/**
 * Decides whether a different member of the pool could plausibly do better.
 *
 * The marketplace setting changes the usual reading of these codes. A 404 here
 * does not mean the model exists nowhere — it means *this seller* no longer
 * lists it, and another member may well still sell it. Listings really do
 * vanish: two catalog snapshots an hour apart already showed one renamed. So a
 * 404 is retried, which is the opposite of what it would mean against a single
 * vendor's API.
 *
 * The codes not retried are the ones that would fail identically everywhere.
 */
function isRetryable(httpStatus: number): boolean {
  switch (httpStatus) {
    // The request itself is wrong; every seller rejects it the same way, so
    // retrying only multiplies the bill.
    case 400:
    case 413:
    case 422:
      return false;
    // Our own upstream credential is bad. Retrying hides an operator problem
    // behind a slower failure, so let it surface.
    case 401:
      return false;
    // Balance is per platform, subscription is per listing, and the model may
    // simply have moved to another seller — all worth trying the next member.
    case 402:
    case 403:
    case 404:
    case 408:
    case 409:
    case 429:
      return true;
    default:
      // 5xx is the upstream's problem, not the request's.
      return httpStatus >= 500;
  }
}

/** Error body in the shape OpenAI clients expect. */
export function openAiErrorBody(code: string, message: string, type = "invalid_request_error") {
  return { error: { message, type, code } };
}
