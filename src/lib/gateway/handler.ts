import { authenticate } from "./auth";
import { loadConfig } from "./config";
import { openAiErrorBody } from "./errors";
import { executeRequest } from "./execute";
import { poolRotation } from "./pool";
import { resolveModel } from "./resolve";
import { checkRate } from "./ratelimit";
import { orderMembers } from "./routing";
import { measuredStats } from "./stats";

export interface HandleOptions {
  /** Upstream path under /v1, e.g. "/embeddings". */
  path: string;
  /** Label for the run log. */
  endpoint: string;
  /** Anthropic clients authenticate with x-api-key and expect its error shape. */
  protocol?: "openai" | "anthropic";
  /** Request headers to forward upstream verbatim. */
  forward?: string[];
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function errorFor(protocol: "openai" | "anthropic", code: string, message: string, type: string) {
  return protocol === "anthropic"
    ? { type: "error", error: { type, message } }
    : openAiErrorBody(code, message, type);
}

/**
 * The one request pipeline behind every /v1 route: authenticate the gateway
 * key, read the model, resolve it to a pool chain, order the chain, execute
 * with fallback. Routes differ only in path, protocol and which headers to
 * forward — everything else would be copy-paste.
 */
export async function handleV1(request: Request, options: HandleOptions): Promise<Response> {
  const protocol = options.protocol ?? "openai";

  // Anthropic SDKs send x-api-key rather than a bearer token.
  const bearer =
    request.headers.get("authorization") ??
    (request.headers.get("x-api-key") ? `Bearer ${request.headers.get("x-api-key")}` : null);
  const client = authenticate(bearer);
  if (!client) {
    return json(errorFor(protocol, "invalid_api_key", "Invalid API key.", "authentication_error"), 401);
  }

  const rate = checkRate(client.id);
  if (!rate.allowed) {
    return new Response(
      JSON.stringify(errorFor(protocol, "rate_limited", `Key exceeded ${rate.limit} requests/minute.`, "rate_limit_error")),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rate.retryAfterSec),
          "X-RateLimit-Limit": String(rate.limit),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(errorFor(protocol, "invalid_json", "Request body is not valid JSON.", "invalid_request_error"), 400);
  }

  const config = loadConfig();
  const requestedModel =
    typeof body.model === "string" && body.model ? body.model : config.defaultModel;

  const resolved = resolveModel(requestedModel);
  if (!resolved) {
    return json(
      errorFor(protocol, "empty_pool", `Pool "${requestedModel}" has no active members.`, "invalid_request_error"),
      409,
    );
  }

  const forwardHeaders: Record<string, string> = {};
  for (const name of options.forward ?? []) {
    const value = request.headers.get(name);
    if (value) forwardHeaders[name] = value;
  }

  return executeRequest({
    config,
    clientKeyId: client.id,
    path: options.path,
    endpoint: options.endpoint,
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
    forwardHeaders,
    errorStyle: protocol,
  });
}
