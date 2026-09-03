import { guard, isResponse, ok } from "@/lib/gateway/api";
import { syncAll } from "@/lib/gateway/catalog";
import { loadConfig } from "@/lib/gateway/config";
import { applyRules } from "@/lib/gateway/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/catalog/sync — refresh both marketplaces, then re-apply pool rules. */
export async function POST(request: Request): Promise<Response> {
  const g = guard(request);
  if (isResponse(g)) return g;
  const platforms = await syncAll(loadConfig());
  const rules = applyRules();
  return ok({ platforms, rules });
}
