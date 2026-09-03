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
         upstream_request_id, kind, endpoint, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      clientKeyId,
      outcome.poolId ?? null,
      outcome.listingId,
      outcome.platform,
      outcome.attemptNo ?? 1,
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
      outcome.kind ?? "live",
      outcome.endpoint ?? "chat",
      new Date().toISOString(),
    );
}

export interface RunRow {
  id: string;
  attempt_no: number;
  kind: string;
  endpoint: string | null;
  pool_id: string | null;
  listing_id: string | null;
  platform: string;
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
      `SELECT id, attempt_no, kind, endpoint, pool_id, listing_id, platform, requested_model, actual_model, stream,
              tokens_in, tokens_out, cost_vnd, ttfb_ms, latency_ms, status, error_code, created_at
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
  /** Billed for attempts that produced nothing — what falling back costs. */
  wasted: number;
  /** Verify sweeps. Real money, but not real traffic — they hammer dead
   *  listings on purpose, so folding them into a success rate hides how the
   *  gateway is actually serving requests. */
  probes: number;
} {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const row = getDb()
    .prepare<
      [string],
      {
        total: number | null;
        calls: number;
        failures: number;
        unpriced: number;
        wasted: number;
        probes: number;
      }
    >(
      `SELECT COALESCE(SUM(cost_vnd), 0) AS total,
              COUNT(*) AS calls,
              SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END) AS failures,
              SUM(CASE WHEN status = 'ok' AND cost_vnd IS NULL THEN 1 ELSE 0 END) AS unpriced,
              COALESCE(SUM(CASE WHEN status <> 'ok' THEN cost_vnd ELSE 0 END), 0) AS wasted,
              SUM(CASE WHEN kind = 'probe' THEN 1 ELSE 0 END) AS probes
         FROM run WHERE created_at >= ?`,
    )
    .get(since.toISOString())!;
  return {
    total: row.total ?? 0,
    calls: row.calls,
    failures: row.failures ?? 0,
    unpriced: row.unpriced ?? 0,
    wasted: row.wasted ?? 0,
    probes: row.probes ?? 0,
  };
}

export interface DailyRow {
  day: string;
  calls: number;
  failures: number;
  cost: number;
  wasted: number;
  unpriced: number;
}

export function spendByDay(days = 14): DailyRow[] {
  return getDb()
    .prepare<[number], DailyRow>(
      `SELECT substr(created_at, 1, 10) AS day,
              COUNT(*) AS calls,
              SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END) AS failures,
              COALESCE(SUM(cost_vnd), 0) AS cost,
              COALESCE(SUM(CASE WHEN status <> 'ok' THEN cost_vnd ELSE 0 END), 0) AS wasted,
              SUM(CASE WHEN status = 'ok' AND cost_vnd IS NULL THEN 1 ELSE 0 END) AS unpriced
         FROM run GROUP BY day ORDER BY day DESC LIMIT ?`,
    )
    .all(days);
}

export interface ListingSpend {
  listing_id: string;
  platform: string;
  calls: number;
  failures: number;
  cost: number;
  avg_latency: number | null;
  unpriced: number;
}

export function spendByListing(limit = 30): ListingSpend[] {
  return getDb()
    .prepare<[number], ListingSpend>(
      `SELECT listing_id, platform,
              COUNT(*) AS calls,
              SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END) AS failures,
              COALESCE(SUM(cost_vnd), 0) AS cost,
              AVG(latency_ms) AS avg_latency,
              SUM(CASE WHEN status = 'ok' AND cost_vnd IS NULL THEN 1 ELSE 0 END) AS unpriced
         FROM run WHERE listing_id IS NOT NULL
        GROUP BY listing_id ORDER BY cost DESC, calls DESC LIMIT ?`,
    )
    .all(limit);
}

/**
 * What the pool's cheapest choice saved against its most expensive member.
 * Only counts runs the gateway could actually price.
 */
export function unpricedTotal(): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS n FROM run WHERE status = 'ok' AND cost_vnd IS NULL")
      .get() as { n: number }
  ).n;
}

/** Failures that came from verify sweeps rather than from serving a client. */
export function probeFailureCount(): number {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  return (
    getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM run WHERE kind = 'probe' AND status <> 'ok' AND created_at >= ?",
      )
      .get(since.toISOString()) as { n: number }
  ).n;
}
