import { authenticate } from "@/lib/gateway/auth";
import { loadConfig } from "@/lib/gateway/config";
import { openAiErrorBody } from "@/lib/gateway/errors";
import { resolveModel } from "@/lib/gateway/resolve";
import { recordRun } from "@/lib/gateway/runlog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anthropic-protocol endpoint, for pointing Claude Code at the gateway.
 *
 * CKey serves /v1/messages natively, so this is a forward with no envelope
 * translation. Vilao speaks only OpenAI, which is why a Vilao listing is
 * refused here rather than silently mistranslated: M4 must either write a
 * bidirectional translator (mid-stream included) or keep this restriction.
 *
 * Note for clients: ANTHROPIC_BASE_URL wants the root origin, not /v1.
 */
export async function POST(request: Request): Promise<Response> {
  const client = authenticate(
    request.headers.get("authorization") ??
      // Anthropic clients send x-api-key rather than a bearer token.
      (request.headers.get("x-api-key") ? `Bearer ${request.headers.get("x-api-key")}` : null),
  );
  if (!client) {
    return new Response(
      JSON.stringify({ type: "error", error: { type: "authentication_error", message: "Invalid API key." } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(
      JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Invalid JSON." } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const config = loadConfig();
  const requestedModel = typeof body.model === "string" ? body.model : config.defaultModel;
  const resolved = resolveModel(requestedModel);
  if (!resolved) {
    return new Response(
      JSON.stringify(openAiErrorBody("empty_pool", `Pool "${requestedModel}" has no active members.`)),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  if (resolved.listing.platform !== "ckey") {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message:
            `Listing "${resolved.listing.display_name}" is on Vilao, which speaks only the ` +
            "OpenAI protocol. Use /v1/chat/completions, or point this pool at CKey listings.",
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const startedAt = Date.now();
  const signal = AbortSignal.any([AbortSignal.timeout(config.totalTimeoutMs), request.signal]);
  const upstream = await fetch(`${config.ckeyBaseUrl}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.ckeyApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, model: resolved.listing.external_id }),
    signal,
    // @ts-expect-error -- undici option, not in the DOM fetch types
    duplex: "half",
  });

  const streaming = body.stream === true;
  if (!streaming || !upstream.body) {
    const text = await upstream.text();
    recordRun(client.id, {
      platform: "ckey",
      listingId: resolved.listing.id,
      poolId: resolved.poolId,
      requestedModel,
      stream: false,
      status: upstream.ok ? "ok" : "error",
      httpStatus: upstream.ok ? undefined : upstream.status,
      latencyMs: Date.now() - startedAt,
    });
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  recordRun(client.id, {
    platform: "ckey",
    listingId: resolved.listing.id,
    poolId: resolved.poolId,
    requestedModel,
    stream: true,
    status: "ok",
    latencyMs: Date.now() - startedAt,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
