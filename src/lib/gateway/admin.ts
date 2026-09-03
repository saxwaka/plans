import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { generateKey, type KeyRole } from "./auth";
import { poolSpend } from "./budget";
import { candidates, chainMembers, findPoolByName, getRule, listPools, type Pool } from "./pool";
import { estimatedCost, reliability, score } from "./routing";
import { measuredStats } from "./stats";
import { lastProbes, verifyEstimate } from "./verify";

/**
 * Read-side helpers for the management API. Writes go straight to pool.ts and
 * friends; this file only shapes what the API returns so route handlers stay
 * thin and the JSON is consistent across endpoints.
 */

export interface PoolSummary extends Pool {
  members_active: number;
  members_total: number;
  candidates: number;
  spend_today_vnd: number;
}

export function poolSummaries(): PoolSummary[] {
  return listPools().map((p) => {
    const chain = chainMembers(p.id);
    return {
      ...p,
      members_active: chain.filter((m) => m.state === "active").length,
      members_total: chain.length,
      candidates: candidates(p.id).length,
      spend_today_vnd: poolSpend(p.id).today,
    };
  });
}

export function poolDetail(name: string) {
  const pool = findPoolByName(name);
  if (!pool) return null;
  const stats = measuredStats();
  const probes = lastProbes(pool.id);
  const shape = (m: ReturnType<typeof chainMembers>[number], position: number | null) => {
    const own = stats.get(m.id);
    const probe = probes.get(m.id);
    return {
      listing_id: m.id,
      position,
      state: m.state,
      weight: m.weight,
      platform: m.platform,
      seller: m.seller,
      display_name: m.display_name,
      base_model: m.base_model,
      price_in: m.price_in,
      price_out: m.price_out,
      price_request: m.price_request,
      price_floor: m.price_floor,
      published_success_rate: m.success_rate,
      published_requests: m.total_requests,
      measured: own ? { calls: own.calls, failures: own.failures } : null,
      reliability: reliability(m, own),
      estimated_cost_vnd: estimatedCost(m),
      score: score(m, own),
      last_probe: probe
        ? { status: probe.status, latency_ms: probe.latency_ms, error_code: probe.error_code, at: probe.created_at }
        : null,
      stale: m.stale === 1,
    };
  };
  const chain = chainMembers(pool.id);
  return {
    ...pool,
    rule: getRule(pool.id),
    spend: poolSpend(pool.id),
    verify_estimate: verifyEstimate(pool.id, true),
    members: chain.map((m, i) => shape(m, i + 1)),
    candidates: candidates(pool.id).map((m) => shape(m, null)),
  };
}

export interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  role: KeyRole;
  active: number;
  created_at: string;
}

export function listKeys(): KeyRow[] {
  return getDb()
    .prepare("SELECT id, name, key_prefix, role, active, created_at FROM client_key ORDER BY created_at")
    .all() as KeyRow[];
}

/** Returns the raw key exactly once; only the hash is stored. */
export function createKey(name: string, role: KeyRole): { id: string; key: string; role: KeyRole } {
  const { raw, hash, prefix } = generateKey();
  const id = randomUUID();
  getDb()
    .prepare(
      "INSERT INTO client_key (id, name, key_hash, key_prefix, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
    )
    .run(id, name, hash, prefix, role, new Date().toISOString());
  return { id, key: raw, role };
}

export function revokeKey(id: string): boolean {
  return getDb().prepare("UPDATE client_key SET active = 0 WHERE id = ?").run(id).changes > 0;
}
