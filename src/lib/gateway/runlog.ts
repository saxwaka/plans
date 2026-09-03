import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import type { CallOutcome } from "./types";

/**
 * Writes one row per attempt. better-sqlite3 is synchronous, so this must only
 * be called once a response has finished — never from inside a stream transform.
 */
export function recordRun(clientKeyId: string | null, outcome: CallOutcome): void {
  getDb()
    .prepare(
      `INSERT INTO run (
         id, client_key_id, pool_id, listing_id, platform, attempt_no,
         requested_model, actual_model, stream, tokens_in, tokens_out, cost_vnd,
         ttfb_ms, latency_ms, status, error_code, http_status,
         upstream_request_id, created_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      clientKeyId,
      outcome.poolId ?? null,
      outcome.listingId,
      outcome.platform,
      outcome.requestedModel,
      outcome.actualModel ?? null,
      outcome.stream ? 1 : 0,
      outcome.tokensIn ?? null,
      outcome.tokensOut ?? null,
      outcome.costVnd ?? null,
      outcome.ttfbMs ?? null,
      outcome.latencyMs ?? null,
      outcome.status,
      outcome.errorCode ?? null,
      outcome.httpStatus ?? null,
      outcome.upstreamRequestId ?? null,
      new Date().toISOString(),
    );
}

export interface RunRow {
  id: string;
  requested_model: string;
  actual_model: string | null;
  stream: number;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_vnd: number | null;
  ttfb_ms: number | null;
  latency_ms: number | null;
  status: string;
  error_code: string | null;
  created_at: string;
}

export function recentRuns(limit = 50): RunRow[] {
  return getDb()
    .prepare<[number], RunRow>(
      `SELECT id, requested_model, actual_model, stream, tokens_in, tokens_out,
              cost_vnd, ttfb_ms, latency_ms, status, error_code, created_at
         FROM run ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit);
}

export function spendToday(): {
  total: number;
  calls: number;
  failures: number;
  /**
   * Successful calls whose cost is still unknown. CKey reports cost inline, but
   * Vilao's usage.cost is always 0 and its real figure only shows up in the
   * management API, so a bare total would silently omit every Vilao call.
   * M5 reconciles these; until then the number is shown rather than hidden.
   */
  unpriced: number;
} {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const row = getDb()
    .prepare<[string], { total: number | null; calls: number; failures: number; unpriced: number }>(
      `SELECT COALESCE(SUM(cost_vnd), 0) AS total,
              COUNT(*) AS calls,
              SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END) AS failures,
              SUM(CASE WHEN status = 'ok' AND cost_vnd IS NULL THEN 1 ELSE 0 END) AS unpriced
         FROM run WHERE created_at >= ?`,
    )
    .get(since.toISOString())!;
  return {
    total: row.total ?? 0,
    calls: row.calls,
    failures: row.failures ?? 0,
    unpriced: row.unpriced ?? 0,
  };
}
