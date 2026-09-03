/**
 * Per-key request rate limit, token-bucket, in memory.
 *
 * In memory is a deliberate fit, not a shortcut: the gateway is a single Node
 * process by design (SQLite, one operator), so there is no second instance to
 * share state with. Off unless GATEWAY_RATE_LIMIT_RPM is set. Its job is to
 * stop one misbehaving client from dragging the shared upstream quota — Vilao
 * caps a token at 120 req/min — down for every other app on the gateway.
 */
const buckets = new Map<string, { tokens: number; updated: number }>();

export interface RateVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

export function checkRate(keyId: string): RateVerdict {
  const limit = Number(process.env.GATEWAY_RATE_LIMIT_RPM ?? 0);
  if (!limit || limit <= 0) return { allowed: true, limit: 0, remaining: Infinity, retryAfterSec: 0 };

  const now = Date.now();
  const refillPerMs = limit / 60_000;
  const bucket = buckets.get(keyId) ?? { tokens: limit, updated: now };
  bucket.tokens = Math.min(limit, bucket.tokens + (now - bucket.updated) * refillPerMs);
  bucket.updated = now;

  if (bucket.tokens < 1) {
    buckets.set(keyId, bucket);
    return { allowed: false, limit, remaining: 0, retryAfterSec: Math.ceil((1 - bucket.tokens) / refillPerMs / 1000) };
  }
  bucket.tokens -= 1;
  buckets.set(keyId, bucket);
  return { allowed: true, limit, remaining: Math.floor(bucket.tokens), retryAfterSec: 0 };
}
