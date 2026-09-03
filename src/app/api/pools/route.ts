import { fail, guard, isResponse, ok, readJson } from "@/lib/gateway/api";
import { poolDetail, poolSummaries } from "@/lib/gateway/admin";
import { createPool, findPoolByName } from "@/lib/gateway/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const g = guard(request);
  if (isResponse(g)) return g;
  return ok({ data: poolSummaries() });
}

/** POST /api/pools  { name, strategy? } — the name becomes a model name on /v1. */
export async function POST(request: Request): Promise<Response> {
  const g = guard(request);
  if (isResponse(g)) return g;
  const body = await readJson<{ name?: string; strategy?: string }>(request);
  if (isResponse(body)) return body;

  const name = body.name?.trim();
  if (!name) return fail(400, "name_required", "Pool needs a name.");
  // Pool names double as model names; a slash would collide with seller-prefixed listing ids.
  if (/[\/\s]/.test(name)) return fail(400, "bad_name", "Pool name may not contain '/' or whitespace.");
  if (findPoolByName(name)) return fail(409, "exists", `Pool "${name}" already exists.`);

  const strategies = ["failover", "cheapest", "round-robin", "weighted", "pinned"];
  const strategy = body.strategy ?? "failover";
  if (!strategies.includes(strategy)) return fail(400, "bad_strategy", `strategy must be one of ${strategies.join(", ")}`);

  createPool(name, strategy);
  return ok(poolDetail(name), 201);
}
