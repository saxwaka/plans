import type { PoolMember } from "./pool";
import type { MeasuredStat } from "./stats";

export type Strategy = "failover" | "cheapest" | "round-robin" | "weighted" | "pinned";

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
const PRIOR_STRENGTH = 20;
const PRIOR_MEAN = 0.8;

/**
 * Combines what the platform published with what the gateway measured itself.
 *
 * Vilao's numbers come with enormous sample sizes — one listing carries 849k
 * requests — so they dominate and our handful of calls barely nudges them, which
 * is correct. CKey publishes nothing, so its listings ride entirely on our own
 * outcomes and take roughly twenty calls before the prior stops dominating.
 *
 * A listing with no evidence on either side is not "average", it is unknown, and
 * is penalised hard so it never wins first place on price alone.
 */
export function reliability(member: PoolMember, measured?: MeasuredStat): number {
  const publishedN = member.success_rate === null ? 0 : (member.total_requests ?? 0);
  const publishedSuccesses = (member.success_rate ?? 0) / 100 * publishedN;

  const ownN = measured?.calls ?? 0;
  const ownSuccesses = ownN - (measured?.failures ?? 0);

  const n = publishedN + ownN;
  if (n === 0) return UNPROVEN;

  return (publishedSuccesses + ownSuccesses + PRIOR_MEAN * PRIOR_STRENGTH) / (n + PRIOR_STRENGTH);
}

/** True when neither the platform nor the gateway has ever seen this listing work. */
export function isUnproven(member: PoolMember, measured?: MeasuredStat): boolean {
  return member.success_rate === null && (measured?.calls ?? 0) === 0;
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

export function score(member: PoolMember, measured?: MeasuredStat): number {
  return estimatedCost(member) / reliability(member, measured);
}

/**
 * Orders a pool's members into the sequence the request will try.
 *
 * The list is always a full fallback chain — strategies differ only in who goes
 * first, never in whether a backup exists.
 */
export interface OrderOptions {
  stats?: Map<string, MeasuredStat>;
  /**
   * Whether an untested listing may go first.
   *
   * Learning whether a cheap CKey seller works means sending it a real request,
   * which risks the very request that teaches us. So exploration is allowed only
   * when the failure would be invisible: a non-streaming call with a fallback
   * still in hand. On a streaming call, unproven members are pushed behind
   * proven ones — they still serve as backups, just never as the first try.
   */
  allowExploration?: boolean;
}

export function orderMembers(
  members: PoolMember[],
  strategy: string,
  counter: number,
  options: OrderOptions = {},
): PoolMember[] {
  const usable = members.filter((m) => m.stale === 0);
  const pool = usable.length > 0 ? usable : members;
  if (pool.length <= 1) return pool;

  return demoteUnproven(byStrategy(pool, strategy, counter, options), options);
}

/**
 * Pushes never-tested listings behind tested ones, preserving relative order.
 *
 * Applied *after* the strategy has ordered the chain, not before: a sort by
 * score would otherwise undo it and quietly hand a streaming request to a
 * listing nobody has ever called.
 */
function demoteUnproven(ordered: PoolMember[], options: OrderOptions): PoolMember[] {
  if (options.allowExploration !== false) return ordered;

  const stats = options.stats;
  const proven = ordered.filter((m) => !isUnproven(m, stats?.get(m.id)));
  const unproven = ordered.filter((m) => isUnproven(m, stats?.get(m.id)));
  return proven.length > 0 ? [...proven, ...unproven] : ordered;
}

function byStrategy(
  pool: PoolMember[],
  strategy: string,
  counter: number,
  options: OrderOptions,
): PoolMember[] {
  switch (strategy) {
    case "cheapest": {
      // The one strategy that actually consults the score: estimated cost divided
      // by reliability, so a listing is only cheap if it also works. Manual order
      // is ignored here by design — use "failover" to keep your own ranking.
      const stats = options.stats;
      return [...pool].sort((a, b) => score(a, stats?.get(a.id)) - score(b, stats?.get(b.id)));
    }

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
