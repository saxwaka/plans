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

/** Active members in call order. Stale listings stay listed but sort last. */
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

/** Swaps a member with its neighbour so order can be nudged without drag-and-drop. */
export function moveMember(poolId: string, listingId: string, direction: -1 | 1): void {
  const db = getDb();
  const members = db
    .prepare("SELECT listing_id, position FROM pool_member WHERE pool_id = ? ORDER BY position")
    .all(poolId) as { listing_id: string; position: number }[];

  const index = members.findIndex((m) => m.listing_id === listingId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= members.length) return;

  const update = db.prepare("UPDATE pool_member SET position = ? WHERE pool_id = ? AND listing_id = ?");
  db.transaction(() => {
    update.run(members[target].position, poolId, members[index].listing_id);
    update.run(members[index].position, poolId, members[target].listing_id);
  })();
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
