import { guard, isResponse, ok } from "@/lib/gateway/api";
import { loadConfig } from "@/lib/gateway/config";
import { reconcileVilao } from "@/lib/gateway/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/reconcile — pull Vilao's billing and price any unpriced runs. */
export async function POST(request: Request): Promise<Response> {
  const g = guard(request);
  if (isResponse(g)) return g;
  return ok(await reconcileVilao(loadConfig(), 5));
}
