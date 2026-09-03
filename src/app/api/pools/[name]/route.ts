import { fail, guard, isResponse, ok, readJson } from "@/lib/gateway/api";
import { poolDetail } from "@/lib/gateway/admin";
import { getDb } from "@/lib/db";
import { deletePool, findPoolByName, setRule, updatePool } from "@/lib/gateway/pool";
import { applyRules } from "@/lib/gateway/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const g = guard(request);
  if (isResponse(g)) return g;
  const { name } = await ctx.params;
  const detail = poolDetail(name);
  return detail ? ok(detail) : fail(404, "not_found", `Pool "${name}" not found.`);
}

interface Patch {
  strategy?: string;
  max_attempts?: number;
  daily_budget?: number | null;
  monthly_budget?: number | null;
  max_price_per_request?: number | null;
  /** A ListingFilter object, or null to remove the rule. */
  rule?: Record<string, unknown> | null;
  auto_admit?: boolean;
}

/** PATCH /api/pools/:name — any subset of settings; omitted fields are unchanged. */
export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const g = guard(request);
  if (isResponse(g)) return g;
  const { name } = await ctx.params;
  const pool = findPoolByName(name);
  if (!pool) return fail(404, "not_found", `Pool "${name}" not found.`);
  const patch = await readJson<Patch>(request);
  if (isResponse(patch)) return patch;

  const row = getDb().prepare("SELECT * FROM pool WHERE id = ?").get(pool.id) as Record<string, unknown>;
  updatePool(pool.id, {
    strategy: patch.strategy ?? (row.strategy as string),
    maxAttempts: patch.max_attempts ?? ((row.max_attempts as number) ?? 3),
    dailyBudget: patch.daily_budget === undefined ? ((row.daily_budget as number | null) ?? null) : patch.daily_budget,
    monthlyBudget: patch.monthly_budget === undefined ? ((row.monthly_budget as number | null) ?? null) : patch.monthly_budget,
    maxPricePerRequest:
      patch.max_price_per_request === undefined
        ? ((row.max_price_per_request as number | null) ?? null)
        : patch.max_price_per_request,
  });

  if (patch.rule !== undefined || patch.auto_admit !== undefined) {
    const currentRule = row.rule_json as string | null;
    const ruleJson = patch.rule === undefined ? currentRule : patch.rule === null ? null : JSON.stringify(patch.rule);
    const autoAdmit = patch.auto_admit ?? row.auto_admit === 1;
    setRule(pool.id, ruleJson, autoAdmit);
    applyRules();
  }

  return ok(poolDetail(name));
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const g = guard(request);
  if (isResponse(g)) return g;
  const { name } = await ctx.params;
  const pool = findPoolByName(name);
  if (!pool) return fail(404, "not_found", `Pool "${name}" not found.`);
  deletePool(pool.id);
  return ok({ deleted: name });
}
