import type { PoolMember } from "./pool";

export type Strategy = "failover" | "round-robin" | "weighted" | "pinned";

/**
 * Reliability on a 0-1 scale.
 *
 * Vilao publishes success_rate across 501 listings, some backed by hundreds of
 * thousands of requests — no gateway can measure that from one user's traffic,
 * so it is consumed rather than recomputed. CKey publishes nothing, so those
 * listings sit at the unproven default until M6 starts measuring them.
 *
 * Two rules come straight from the real data. A tiny sample is not evidence:
 * one listing shows 100% over a single request while the same seller's other
 * listing shows 0% over one. And no measurement at all is penalised hard, so an
 * unknown listing never wins first place on price alone.
 */
const UNPROVEN = 0.5;
const PRIOR_STRENGTH = 200;
const PRIOR_MEAN = 0.8;

export function reliability(member: PoolMember): number {
  if (member.success_rate === null) return UNPROVEN;

  const rate = member.success_rate / 100;
  const n = member.total_requests ?? 0;
  // Shrink towards the prior so a handful of calls cannot mint a perfect score.
  return (rate * n + PRIOR_MEAN * PRIOR_STRENGTH) / (n + PRIOR_STRENGTH);
}

/** Rough VND for one typical call, used only to compare members with each other. */
export function estimatedCost(member: PoolMember, tokensIn = 1000, tokensOut = 500): number {
  const tokenCost =
    ((member.price_in ?? 0) * tokensIn + (member.price_out ?? 0) * tokensOut) / 1_000_000;
  const perRequest = member.price_request ?? 0;
  // Billing is max(floor, per-request + token cost) — a small call is priced by
  // the floor, not by its tokens. Proven in docs/api-notes.md.
  return Math.max(member.price_floor ?? 0, perRequest + tokenCost);
}

export function score(member: PoolMember): number {
  return estimatedCost(member) / reliability(member);
}

/**
 * Orders a pool's members into the sequence the request will try.
 *
 * The list is always a full fallback chain — strategies differ only in who goes
 * first, never in whether a backup exists.
 */
export function orderMembers(members: PoolMember[], strategy: string, counter: number): PoolMember[] {
  const usable = members.filter((m) => m.stale === 0);
  const pool = usable.length > 0 ? usable : members;
  if (pool.length <= 1) return pool;

  switch (strategy) {
    case "pinned":
      return pool;

    case "round-robin": {
      // Spreads load so one seller does not absorb every call — Vilao caps a
      // token at 120 requests a minute.
      const offset = counter % pool.length;
      return [...pool.slice(offset), ...pool.slice(0, offset)];
    }

    case "weighted": {
      const total = pool.reduce((sum, m) => sum + Math.max(m.weight, 0), 0);
      if (total <= 0) return pool;
      let target = (counter * 0.6180339887 % 1) * total;
      let chosen = 0;
      for (let i = 0; i < pool.length; i++) {
        target -= Math.max(pool[i].weight, 0);
        if (target < 0) {
          chosen = i;
          break;
        }
      }
      return [pool[chosen], ...pool.filter((_, i) => i !== chosen)];
    }

    case "failover":
    default:
      return pool;
  }
}
