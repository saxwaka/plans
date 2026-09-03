import { authenticate } from "@/lib/gateway/auth";
import { loadConfig } from "@/lib/gateway/config";
import { openAiErrorBody } from "@/lib/gateway/errors";
import { executeChat } from "@/lib/gateway/execute";
import { resolveModel } from "@/lib/gateway/resolve";
import { poolRotation } from "@/lib/gateway/pool";
import { orderMembers } from "@/lib/gateway/routing";
import { measuredStats } from "@/lib/gateway/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function POST(request: Request): Promise<Response> {
  const client = authenticate(request.headers.get("authorization"));
  if (!client) {
    return json(openAiErrorBody("invalid_api_key", "Invalid API key.", "authentication_error"), 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(openAiErrorBody("invalid_json", "Request body is not valid JSON."), 400);
  }

  const config = loadConfig();
  const requestedModel =
    typeof body.model === "string" && body.model ? body.model : config.defaultModel;

  const resolved = resolveModel(requestedModel);
  if (!resolved) {
    return json(openAiErrorBody("empty_pool", `Pool "${requestedModel}" has no active members.`), 409);
  }

  return executeChat({
    config,
    clientKeyId: client.id,
    requestedModel,
    body,
    chain: orderMembers(
      resolved.members,
      resolved.strategy,
      resolved.poolId ? poolRotation(resolved.poolId) : 0,
      {
        stats: measuredStats(),
        // A streaming request cannot hide a bad first pick once bytes ship, so
        // untested listings only lead on calls that can fail invisibly.
        allowExploration: body.stream !== true,
      },
    ),
    poolId: resolved.poolId,
    poolName: resolved.poolName,
    maxAttempts: resolved.maxAttempts,
    ttfbTimeoutMs: resolved.ttfbTimeoutMs ?? config.ttfbTimeoutMs,
    totalTimeoutMs: resolved.totalTimeoutMs ?? config.totalTimeoutMs,
    dailyBudget: resolved.dailyBudget,
    monthlyBudget: resolved.monthlyBudget,
    maxPricePerRequest: resolved.maxPricePerRequest,
    clientSignal: request.signal,
  });
}
