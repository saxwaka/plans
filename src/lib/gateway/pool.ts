import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import type { Listing } from "./catalog";

export interface Pool {
  id: string;
  name: string;
  strategy: string;
  created_at: string;
}

export type PoolMember = Listing & { position: number; weight: number; state: string };

export function listPools(): (Pool & { members: number })[] {
  return getDb()
    .prepare(
      `SELECT p.*, COUNT(m.listing_id) AS members
         FROM pool p LEFT JOIN pool_member m ON m.pool_id = p.id AND m.state = 'active'
        GROUP BY p.id ORDER BY p.name`,
    )
    .all() as (Pool & { members: number })[];
}

export function findPoolByName(name: string): Pool | undefined {
  return getDb().prepare("SELECT * FROM pool WHERE name = ?").get(name) as Pool | undefined;
}

/** Members the router may call, in order. Stale listings stay listed but sort last. */
export function poolMembers(poolId: string): PoolMember[] {
  return getDb()
    .prepare(
      `SELECT l.*, m.position, m.weight, m.state
         FROM pool_member m JOIN listing l ON l.id = m.listing_id
        WHERE m.pool_id = ? AND m.state = 'active'
        ORDER BY l.stale ASC, m.position ASC`,
    )
    .all(poolId) as PoolMember[];
}

/**
 * Every member in the ordered chain, enabled or not.
 *
 * Disabled members have to stay visible: a listing switched off and then hidden
 * is a listing nobody can ever switch back on. Candidates are excluded — they
 * are not part of the chain until admitted.
 */
export function chainMembers(poolId: string): PoolMember[] {
  return getDb()
    .prepare(
      `SELECT l.*, m.position, m.weight, m.state
         FROM pool_member m JOIN listing l ON l.id = m.listing_id
        WHERE m.pool_id = ? AND m.state IN ('active', 'blocked')
        ORDER BY m.position ASC`,
    )
    .all(poolId) as PoolMember[];
}

export function createPool(name: string, strategy = "failover"): string {
  const id = randomUUID();
  getDb()
    .prepare("INSERT INTO pool (id, name, strategy, created_at) VALUES (?, ?, ?, ?)")
    .run(id, name, strategy, new Date().toISOString());
  return id;
}

export function deletePool(poolId: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM pool_member WHERE pool_id = ?").run(poolId);
    db.prepare("DELETE FROM pool WHERE id = ?").run(poolId);
  })();
}

export function addMember(poolId: string, listingId: string): void {
  const next = getDb()
    .prepare("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM pool_member WHERE pool_id = ?")
    .get(poolId) as { n: number };
  getDb()
    .prepare(
      `INSERT INTO pool_member (pool_id, listing_id, position, weight, state)
       VALUES (?, ?, ?, 1, 'active') ON CONFLICT(pool_id, listing_id) DO NOTHING`,
    )
    .run(poolId, listingId, next.n);
}

export function removeMember(poolId: string, listingId: string): void {
  getDb().prepare("DELETE FROM pool_member WHERE pool_id = ? AND listing_id = ?").run(poolId, listingId);
}

/** Chain members in order, used by every reordering operation. */
function orderedChain(poolId: string): string[] {
  return (
    getDb()
      .prepare(
        `SELECT listing_id FROM pool_member
          WHERE pool_id = ? AND state IN ('active', 'blocked') ORDER BY position`,
      )
      .all(poolId) as { listing_id: string }[]
  ).map((r) => r.listing_id);
}

/** Rewrites positions as 1..n so no gaps or ties survive a reorder. */
function renumber(poolId: string, order: string[]): void {
  const db = getDb();
  const update = db.prepare(
    "UPDATE pool_member SET position = ? WHERE pool_id = ? AND listing_id = ?",
  );
  db.transaction(() => {
    order.forEach((listingId, index) => update.run(index + 1, poolId, listingId));
  })();
}

/**
 * Nudges a member one place up or down.
 *
 * Reordering works on the chain alone, not on every row in the pool. Candidates
 * carry positions too, so a plain neighbour swap could trade places with a
 * queued listing that is not on screen — the button would appear to do nothing.
 */
export function moveMember(poolId: string, listingId: string, direction: -1 | 1): void {
  const order = orderedChain(poolId);
  const index = order.indexOf(listingId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= order.length) return;

  [order[index], order[target]] = [order[target], order[index]];
  renumber(poolId, order);
}

/** Moves a member to an explicit 1-based slot, for pools too long to nudge. */
export function setMemberPosition(poolId: string, listingId: string, position: number): void {
  const order = orderedChain(poolId);
  const index = order.indexOf(listingId);
  if (index === -1) return;

  const target = Math.max(0, Math.min(order.length - 1, Math.round(position) - 1));
  if (target === index) return;

  order.splice(index, 1);
  order.splice(target, 0, listingId);
  renumber(poolId, order);
}

/** Turns a member off without losing its place, or back on again. */
export function toggleMember(poolId: string, listingId: string, enabled: boolean): void {
  getDb()
    .prepare("UPDATE pool_member SET state = ? WHERE pool_id = ? AND listing_id = ?")
    .run(enabled ? "active" : "blocked", poolId, listingId);
}

export interface PoolSettings {
  strategy: string;
  maxAttempts: number;
  dailyBudget: number | null;
  monthlyBudget: number | null;
  maxPricePerRequest: number | null;
}

export function updatePool(poolId: string, s: PoolSettings): void {
  getDb()
    .prepare(
      `UPDATE pool SET strategy = ?, max_attempts = ?, daily_budget = ?,
              monthly_budget = ?, max_price_per_request = ? WHERE id = ?`,
    )
    .run(s.strategy, s.maxAttempts, s.dailyBudget, s.monthlyBudget, s.maxPricePerRequest, poolId);
}

export function setMemberWeight(poolId: string, listingId: string, weight: number): void {
  getDb()
    .prepare("UPDATE pool_member SET weight = ? WHERE pool_id = ? AND listing_id = ?")
    .run(weight, poolId, listingId);
}

/**
 * Rotation counter for round-robin and weighted pools.
 *
 * Derived from how many calls the pool has already logged rather than kept in a
 * module variable: process memory resets on every restart and is not shared if
 * the server ever runs more than one worker, either of which would quietly pin
 * a "rotating" pool to a single member.
 */
export function poolRotation(poolId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM run WHERE pool_id = ?")
    .get(poolId) as { n: number };
  return row.n;
}

export interface PoolRule {
  filter: import("./filter").ListingFilter;
  autoAdmit: boolean;
}

export function getRule(poolId: string): PoolRule | null {
  const row = getDb()
    .prepare("SELECT rule_json, auto_admit FROM pool WHERE id = ?")
    .get(poolId) as { rule_json: string | null; auto_admit: number } | undefined;
  if (!row?.rule_json) return null;
  try {
    return { filter: JSON.parse(row.rule_json), autoAdmit: row.auto_admit === 1 };
  } catch {
    return null;
  }
}

export function setRule(poolId: string, filterJson: string | null, autoAdmit: boolean): void {
  getDb()
    .prepare("UPDATE pool SET rule_json = ?, auto_admit = ? WHERE id = ?")
    .run(filterJson, autoAdmit ? 1 : 0, poolId);
}

export function candidates(poolId: string): PoolMember[] {
  return getDb()
    .prepare(
      `SELECT l.*, m.position, m.weight, m.state
         FROM pool_member m JOIN listing l ON l.id = m.listing_id
        WHERE m.pool_id = ? AND m.state = 'candidate'
        ORDER BY COALESCE(l.price_in, l.price_request, 1e12) ASC`,
    )
    .all(poolId) as PoolMember[];
}

export function setMemberState(poolId: string, listingId: string, state: string): void {
  const db = getDb();
  db.prepare("UPDATE pool_member SET state = ? WHERE pool_id = ? AND listing_id = ?").run(
    state,
    poolId,
    listingId,
  );
  // An admitted candidate joins the end of the chain. Its queued position was
  // only a sort key for the review list and would otherwise drop it into the
  // middle of the running order.
  if (state === "active" || state === "blocked") {
    const order = orderedChain(poolId).filter((id) => id !== listingId);
    renumber(poolId, [...order, listingId]);
  }
}
