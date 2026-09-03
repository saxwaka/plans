import { getDb } from "../db";
import type { Listing } from "./catalog";

/**
 * One filter implementation backs both the catalog UI and (from M6) rule-based
 * pools. If these ever diverge you get the worst bug in the system: the screen
 * shows one set of listings and the router uses another.
 */
export interface ListingFilter {
  platform?: "ckey" | "vilao";
  kind?: string;
  seller?: string;
  search?: string;
  maxPriceIn?: number;
  maxPriceRequest?: number;
  minContext?: number;
  minSuccessRate?: number;
  minTotalRequests?: number;
  maxLatencyMs?: number;
  supportsTools?: boolean;
  /**
   * Quality fields are sparse: success_rate covers 501 of 604 Vilao listings and
   * none of CKey's, and provider_verified covers just 16. So a quality threshold
   * is three-valued — this flag decides whether listings with no data at all are
   * kept alongside the ones that pass. Defaults to keeping them, because
   * silently deleting every CKey listing would be a nasty surprise.
   */
  includeUnmeasured?: boolean;
  verifiedOnly?: boolean;
  includeStale?: boolean;
}

interface Built {
  where: string;
  params: unknown[];
}

function build(filter: ListingFilter): Built {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const unmeasured = filter.includeUnmeasured ?? true;

  if (!filter.includeStale) clauses.push("stale = 0");
  if (filter.platform) { clauses.push("platform = ?"); params.push(filter.platform); }
  if (filter.kind) { clauses.push("kind = ?"); params.push(filter.kind); }
  if (filter.seller) { clauses.push("seller = ?"); params.push(filter.seller); }
  if (filter.search) {
    clauses.push("(display_name LIKE ? OR base_model LIKE ?)");
    params.push(`%${filter.search}%`, `%${filter.search}%`);
  }
  // A missing price is NOT the same kind of gap as a missing quality stat.
  // Quality NULL means "nobody measured this yet", so it stays eligible. Price
  // NULL means "this listing is billed the other way" — 247 Vilao and 127 CKey
  // listings carry no token price at all — and a per-request listing simply has
  // no input-token price to compare, so it cannot satisfy a token-price ceiling.
  if (filter.maxPriceIn !== undefined) {
    clauses.push("(price_in IS NOT NULL AND price_in <= ?)");
    params.push(filter.maxPriceIn);
  }
  if (filter.maxPriceRequest !== undefined) {
    clauses.push("(price_request IS NOT NULL AND price_request <= ?)");
    params.push(filter.maxPriceRequest);
  }
  if (filter.minContext !== undefined) {
    clauses.push("context_len >= ?");
    params.push(filter.minContext);
  }
  if (filter.supportsTools) clauses.push("supports_tools = 1");
  if (filter.verifiedOnly) clauses.push("verified = 1");

  // Each quality threshold keeps rows that pass, and separately keeps rows with
  // no measurement, so "unknown" never masquerades as "failed the bar".
  const quality = (column: string, value: number | undefined, op: ">=" | "<=") => {
    if (value === undefined) return;
    clauses.push(
      unmeasured
        ? `(${column} IS NULL OR ${column} ${op} ?)`
        : `(${column} IS NOT NULL AND ${column} ${op} ?)`,
    );
    params.push(value);
  };
  quality("success_rate", filter.minSuccessRate, ">=");
  quality("total_requests", filter.minTotalRequests, ">=");
  quality("avg_latency_ms", filter.maxLatencyMs, "<=");

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function queryListings(filter: ListingFilter, limit = 200): Listing[] {
  const { where, params } = build(filter);
  return getDb()
    .prepare(
      // Token prices are VND per 1M tokens and request prices are VND per call —
      // different units, so they are grouped before being sorted rather than
      // interleaved into one meaningless ranking.
      `SELECT * FROM listing ${where}
       ORDER BY
         CASE WHEN price_in IS NOT NULL THEN 0 WHEN price_request IS NOT NULL THEN 1 ELSE 2 END,
         COALESCE(price_in, price_request, 1e12) ASC,
         base_model ASC
       LIMIT ?`,
    )
    .all(...params, limit) as Listing[];
}

export function countListings(filter: ListingFilter): number {
  const { where, params } = build(filter);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM listing ${where}`)
    .get(...params) as { n: number };
  return row.n;
}

/** Total before filtering, so the UI can say "112 / 1102" rather than just "112". */
export function countAll(includeStale = false): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM listing ${includeStale ? "" : "WHERE stale = 0"}`)
    .get() as { n: number };
  return row.n;
}

export function distinctSellers(): { seller: string; n: number }[] {
  return getDb()
    .prepare(
      `SELECT seller, COUNT(*) AS n FROM listing
        WHERE stale = 0 AND seller IS NOT NULL
        GROUP BY seller ORDER BY n DESC LIMIT 100`,
    )
    .all() as { seller: string; n: number }[];
}
