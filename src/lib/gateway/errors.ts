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
  platform: Platform,
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
    retryable: isRetryable(platform, httpStatus, code),
  };
}

/**
 * Retrying a 400 only burns money — the request is malformed however it is routed.
 * Retrying a 429 or a gateway failure is worth a different seller.
 */
function isRetryable(platform: Platform, httpStatus: number, code: string): boolean {
  if (httpStatus === 429) return true;
  if (httpStatus >= 500) {
    // CKey answers 503 for any unknown path, not just a sick upstream, so a 503
    // on a route we did not expect is a bug on our side and not worth a retry.
    if (platform === "ckey" && httpStatus === 503 && code === "http_503") return true;
    return true;
  }
  // 402 insufficient balance and 403 not-subscribed are per-account, not per-listing
  // on CKey; on Vilao a 403 means "subscribe first", which M4 handles before retrying.
  if (httpStatus === 403) return true;
  return false;
}

/** Error body in the shape OpenAI clients expect. */
export function openAiErrorBody(code: string, message: string, type = "invalid_request_error") {
  return { error: { message, type, code } };
}
