import { getDb } from "../db";
import { queryListings } from "./filter";
import { getRule, listPools } from "./pool";

export interface RuleReport {
  pool: string;
  admitted: number;
  queued: number;
}

/**
 * Re-evaluates every rule-based pool against the catalog.
 *
 * New matches land in a review queue by default rather than going straight into
 * rotation. The catalog moves faster than it looks — two snapshots an hour apart
 * already showed a listing renamed — so a rule left to admit freely would put
 * sellers nobody has vetted in front of real traffic. Pools that opt into
 * auto-admit still cannot jump the queue on merit alone: an unproven listing is
 * held back from first place by the scoring in routing.ts.
 *
 * Members already present are left alone, including ones a person has blocked.
 */
export function applyRules(): RuleReport[] {
  const db = getDb();
  const reports: RuleReport[] = [];

  for (const pool of listPools()) {
    const rule = getRule(pool.id);
    if (!rule) continue;

    const existing = new Set(
      (db.prepare("SELECT listing_id FROM pool_member WHERE pool_id = ?").all(pool.id) as {
        listing_id: string;
      }[]).map((r) => r.listing_id),
    );

    const matches = queryListings(rule.filter, 200).filter((l) => !existing.has(l.id));
    if (matches.length === 0) {
      reports.push({ pool: pool.name, admitted: 0, queued: 0 });
      continue;
    }

    const nextPosition = (
      db
        .prepare("SELECT COALESCE(MAX(position), 0) AS n FROM pool_member WHERE pool_id = ?")
        .get(pool.id) as { n: number }
    ).n;

    const insert = db.prepare(
      `INSERT INTO pool_member (pool_id, listing_id, position, weight, state)
       VALUES (?, ?, ?, 1, ?) ON CONFLICT(pool_id, listing_id) DO NOTHING`,
    );
    const state = rule.autoAdmit ? "active" : "candidate";

    db.transaction(() => {
      matches.forEach((listing, index) => {
        insert.run(pool.id, listing.id, nextPosition + index + 1, state);
      });
    })();

    reports.push({
      pool: pool.name,
      admitted: rule.autoAdmit ? matches.length : 0,
      queued: rule.autoAdmit ? 0 : matches.length,
    });
  }

  return reports;
}
