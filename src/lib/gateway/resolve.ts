import type { Listing } from "./catalog";
import { getListing, syntheticCkeyListing } from "./dispatch";
import { findPoolByName, poolMembers } from "./pool";

export interface Resolution {
  listing: Listing;
  poolId: string | null;
  poolName: string | null;
  /** Members after the chosen one. Unused until M4 turns them into a fallback chain. */
  rest: Listing[];
}

/**
 * Turns the model name a client sent into the listing that will serve it.
 *
 * A name that matches no pool is forwarded rather than rejected: pools are a
 * convenience, not a gate, and passthrough is the escape hatch when routing
 * misbehaves.
 */
export function resolveModel(requested: string): Resolution | null {
  const pool = findPoolByName(requested);
  if (pool) {
    const members = poolMembers(pool.id);
    if (members.length === 0) return null;
    const [first, ...rest] = members;
    return { listing: first, poolId: pool.id, poolName: pool.name, rest };
  }

  const known = getListing(`ckey:${requested}`) ?? getListing(requested);
  return {
    listing: known ?? syntheticCkeyListing(requested),
    poolId: null,
    poolName: null,
    rest: [],
  };
}
