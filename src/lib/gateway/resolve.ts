import type { PoolMember } from "./pool";
import { findPoolByName, poolMembers } from "./pool";
import { getListing, syntheticCkeyListing } from "./dispatch";

export interface Resolution {
  /** Ordering happens in routing.ts; this is the raw member list. */
  members: PoolMember[];
  poolId: string | null;
  poolName: string | null;
  strategy: string;
  maxAttempts: number;
  dailyBudget: number | null;
  monthlyBudget: number | null;
  maxPricePerRequest: number | null;
  ttfbTimeoutMs: number | null;
  totalTimeoutMs: number | null;
}

function asMember(listing: ReturnType<typeof syntheticCkeyListing>): PoolMember {
  return { ...listing, position: 1, weight: 1, state: "active" };
}

/**
 * Turns the model name a client sent into the members that may serve it.
 *
 * A name matching no pool is forwarded as a single-member chain rather than
 * rejected: pools are a convenience, not a gate, and passthrough is the escape
 * hatch when routing misbehaves.
 */
export function resolveModel(requested: string): Resolution | null {
  const pool = findPoolByName(requested);
  if (pool) {
    const members = poolMembers(pool.id);
    if (members.length === 0) return null;
    const p = pool as typeof pool & {
      max_attempts?: number;
      daily_budget?: number | null;
      monthly_budget?: number | null;
      max_price_per_request?: number | null;
      ttfb_timeout_ms?: number | null;
      total_timeout_ms?: number | null;
    };
    return {
      members,
      poolId: pool.id,
      poolName: pool.name,
      strategy: pool.strategy,
      maxAttempts: p.max_attempts ?? 3,
      dailyBudget: p.daily_budget ?? null,
      monthlyBudget: p.monthly_budget ?? null,
      maxPricePerRequest: p.max_price_per_request ?? null,
      ttfbTimeoutMs: p.ttfb_timeout_ms ?? null,
      totalTimeoutMs: p.total_timeout_ms ?? null,
    };
  }

  const known = getListing(`ckey:${requested}`) ?? getListing(requested);
  return {
    members: [asMember(known ?? syntheticCkeyListing(requested))],
    poolId: null,
    poolName: null,
    strategy: "failover",
    maxAttempts: 1,
    dailyBudget: null,
    monthlyBudget: null,
    maxPricePerRequest: null,
    ttfbTimeoutMs: null,
    totalTimeoutMs: null,
  };
}
