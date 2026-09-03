import { authenticate } from "@/lib/gateway/auth";
import { loadConfig } from "@/lib/gateway/config";
import { dispatchChat } from "@/lib/gateway/dispatch";
import { normalizeUpstreamError, openAiErrorBody } from "@/lib/gateway/errors";
import { resolveModel } from "@/lib/gateway/resolve";
import { recordRun } from "@/lib/gateway/runlog";
import { instrumentSse } from "@/lib/gateway/stream";
import type { UpstreamUsage } from "@/lib/gateway/types";

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
  const wantsStream = body.stream === true;

  const resolved = resolveModel(requestedModel);
  if (!resolved) {
    return json(
      openAiErrorBody("empty_pool", `Pool "${requestedModel}" has no active members.`),
      409,
    );
  }
  const { listing, poolId } = resolved;

  // The client's own abort cancels the upstream fetch, so a response nobody
  // reads stops costing money.
  const signal = AbortSignal.any([AbortSignal.timeout(config.totalTimeoutMs), request.signal]);

  const logBase = {
    platform: listing.platform,
    listingId: listing.id,
    requestedModel,
    poolId,
    stream: wantsStream,
  } as const;

  let call;
  try {
    call = await dispatchChat(config, listing, body, signal);
  } catch (error) {
    const aborted = request.signal.aborted;
    recordRun(client.id, {
      ...logBase,
      status: aborted ? "client_abort" : "error",
      errorCode: aborted ? "client_abort" : "upstream_unreachable",
      latencyMs: 0,
    });
    if (aborted) return new Response(null, { status: 499 });
    return json(
      openAiErrorBody("upstream_unreachable", String((error as Error).message), "api_error"),
      502,
    );
  }

  const { response, startedAt } = call;

  if (!response.ok) {
    const raw = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* upstream did not answer JSON; forward the text as-is */
    }
    const err = normalizeUpstreamError(listing.platform, response.status, parsed);
    recordRun(client.id, {
      ...logBase,
      status: "error",
      errorCode: err.code,
      httpStatus: err.httpStatus,
      upstreamRequestId: err.upstreamRequestId,
      latencyMs: Date.now() - startedAt,
    });
    return new Response(raw || JSON.stringify(openAiErrorBody(err.code, err.message, "api_error")), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!wantsStream) {
    const payload = (await response.json()) as { usage?: UpstreamUsage; model?: string };
    recordRun(client.id, {
      ...logBase,
      actualModel: payload.model,
      tokensIn: payload.usage?.prompt_tokens,
      tokensOut: payload.usage?.completion_tokens,
      // Only CKey reports cost inline; Vilao's usage.cost is always 0 and its real
      // figure lives in the management API, which M5 reconciles.
      costVnd: payload.usage?.x_ckey?.cost,
      upstreamRequestId: payload.usage?.x_ckey?.request_id,
      latencyMs: Date.now() - startedAt,
      status: "ok",
    });
    return json(payload, 200);
  }

  if (!response.body) {
    return json(openAiErrorBody("empty_stream", "Upstream returned no body.", "api_error"), 502);
  }

  const instrumented = instrumentSse(
    response.body,
    startedAt,
    (result) => {
      recordRun(client.id, {
        ...logBase,
        actualModel: result.actualModel,
        tokensIn: result.usage?.prompt_tokens,
        tokensOut: result.usage?.completion_tokens,
        costVnd: result.usage?.x_ckey?.cost,
        upstreamRequestId: result.usage?.x_ckey?.request_id,
        ttfbMs: result.ttfbMs,
        latencyMs: result.latencyMs,
        // A stream ending with no usage frame was cut short, not completed.
        status: result.usage ? "ok" : "client_abort",
      });
    },
    request.signal,
  );

  return new Response(instrumented, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
