import { authenticate } from "@/lib/gateway/auth";
import { loadConfig } from "@/lib/gateway/config";
import { normalizeUpstreamError, openAiErrorBody } from "@/lib/gateway/errors";
import { recordRun } from "@/lib/gateway/runlog";
import { instrumentSse } from "@/lib/gateway/stream";
import { chatCompletions } from "@/lib/gateway/upstream/ckey";
import type { UpstreamUsage } from "@/lib/gateway/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

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
  // M1 pins one verified listing. Pools and routing arrive in M3/M4; until then a
  // client naming its own model still gets forwarded rather than rejected.
  const requestedModel = typeof body.model === "string" && body.model ? body.model : config.defaultModel;
  const wantsStream = body.stream === true;
  const upstreamBody = { ...body, model: requestedModel };

  // Two independent deadlines: one bounds the whole call, the client's own abort
  // cancels the upstream fetch so we stop paying for a response nobody reads.
  const timeout = AbortSignal.timeout(config.totalTimeoutMs);
  const signal = AbortSignal.any([timeout, request.signal]);

  let call;
  try {
    call = await chatCompletions(config, upstreamBody, signal);
  } catch (error) {
    const aborted = request.signal.aborted;
    recordRun(client.id, {
      platform: "ckey",
      listingId: requestedModel,
      requestedModel,
      stream: wantsStream,
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
      /* upstream did not answer JSON; keep the text below */
    }
    const err = normalizeUpstreamError("ckey", response.status, parsed);
    recordRun(client.id, {
      platform: "ckey",
      listingId: requestedModel,
      requestedModel,
      stream: wantsStream,
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
    const payload = (await response.json()) as {
      usage?: UpstreamUsage;
      model?: string;
    };
    recordRun(client.id, {
      platform: "ckey",
      listingId: requestedModel,
      requestedModel,
      actualModel: payload.model,
      stream: false,
      tokensIn: payload.usage?.prompt_tokens,
      tokensOut: payload.usage?.completion_tokens,
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

  const instrumented = instrumentSse(response.body, startedAt, (result) => {
    recordRun(client.id, {
      platform: "ckey",
      listingId: requestedModel,
      requestedModel,
      actualModel: result.actualModel,
      stream: true,
      tokensIn: result.usage?.prompt_tokens,
      tokensOut: result.usage?.completion_tokens,
      costVnd: result.usage?.x_ckey?.cost,
      upstreamRequestId: result.usage?.x_ckey?.request_id,
      ttfbMs: result.ttfbMs,
      latencyMs: result.latencyMs,
      // A stream that ends without a usage frame was cut short rather than completed.
      status: result.usage ? "ok" : "client_abort",
    });
  }, request.signal);

  return new Response(instrumented, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Without this a reverse proxy will buffer the whole stream and the text
      // only appears once the response completes.
      "X-Accel-Buffering": "no",
    },
  });
}
