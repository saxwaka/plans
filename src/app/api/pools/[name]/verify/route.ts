import { fail, guard, isResponse, ok } from "@/lib/gateway/api";
import { loadConfig } from "@/lib/gateway/config";
import { findPoolByName } from "@/lib/gateway/pool";
import { verifyEstimate, verifyPool } from "@/lib/gateway/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pools/:name/verify?include_candidates=1
 * Calls every member once. SPENDS REAL MONEY — GET the pool first and read
 * verify_estimate.cost before calling. The estimate is an upper bound.
 */
export async function POST(request: Request, ctx: { params: Promise<{ name: string }> }): Promise<Response> {
  const g = guard(request);
  if (isResponse(g)) return g;
  const { name } = await ctx.params;
  const pool = findPoolByName(name);
  if (!pool) return fail(404, "not_found", `Pool "${name}" not found.`);
  const includeCandidates = new URL(request.url).searchParams.get("include_candidates") !== "0";
  const estimate = verifyEstimate(pool.id, includeCandidates);
  const results = await verifyPool(loadConfig(), pool.id, { includeCandidates });
  return ok({
    pool: name,
    quoted_max_vnd: estimate.cost,
    spent_vnd: results.reduce((s, r) => s + (r.costVnd ?? 0), 0),
    alive: results.filter((r) => r.ok).length,
    total: results.length,
    results,
  });
}
