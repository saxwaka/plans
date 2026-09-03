import { getDb } from "../db";

export interface MeasuredStat {
  calls: number;
  failures: number;
  p50Latency: number | null;
  lastOkAt: string | null;
  lastError: string | null;
}

/** Outcomes the gateway observed itself, keyed by listing id. */
export function measuredStats(): Map<string, MeasuredStat> {
  const rows = getDb()
    .prepare(
      `SELECT listing_id,
              COUNT(*) AS calls,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failures,
              MAX(CASE WHEN status = 'ok' THEN created_at END) AS last_ok_at
         FROM run
        WHERE listing_id IS NOT NULL AND status <> 'client_abort'
        GROUP BY listing_id`,
    )
    .all() as {
    listing_id: string;
    calls: number;
    failures: number;
    last_ok_at: string | null;
  }[];

  const map = new Map<string, MeasuredStat>();
  for (const row of rows) {
    map.set(row.listing_id, {
      calls: row.calls,
      failures: row.failures,
      p50Latency: null,
      lastOkAt: row.last_ok_at,
      lastError: null,
    });
  }
  return map;
}

export function measuredFor(listingId: string): MeasuredStat | undefined {
  return measuredStats().get(listingId);
}
