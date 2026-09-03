import { checkBudget } from "./budget";
import type { GatewayConfig } from "./config";
import { dispatchTo } from "./dispatch";
import { normalizeUpstreamError, openAiErrorBody } from "./errors";
import type { PoolMember } from "./pool";
import { costFor } from "./pricing";
import { scheduleReconcile } from "./reconcile";
import { recordRun } from "./runlog";
import { holdFirstChunk, instrumentSse } from "./stream";
import { extractUsage, type NormalizedUsage } from "./usage";

export interface ExecuteInput {
  config: GatewayConfig;
  clientKeyId: string;
  /** Upstream path under /v1, e.g. "/chat/completions", "/messages", "/embeddings". */
  path: string;
  /** Short label for the run log, e.g. "chat", "messages", "embeddings". */
  endpoint: string;
  requestedModel: string;
  body: Record<string, unknown>;
  chain: PoolMember[];
  poolId: string | null;
  poolName: string | null;
  maxAttempts: number;
  ttfbTimeoutMs: number;
  totalTimeoutMs: number;
  dailyBudget: number | null;
  monthlyBudget: number | null;
  maxPricePerRequest: number | null;
  clientSignal: AbortSignal;
  /** Headers to forward upstream verbatim, e.g. anthropic-version. */
  forwardHeaders?: Record<string, string>;
  /** Error envelope style for gateway-originated errors. */
  errorStyle?: "openai" | "anthropic";
}

const jsonResponse = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });

function errorBody(style: "openai" | "anthropic", code: string, message: string, type: string) {
  return style === "anthropic"
    ? { type: "error", error: { type, message } }
    : openAiErrorBody(code, message, type);
}

/**
 * Normalised cost for the caller: the upstream's own figure when it reports
 * one (CKey), otherwise computed from the listing's prices (Vilao reports 0
 * inline and only confirms the number later through its management API).
 */
function costFields(member: PoolMember, usage: NormalizedUsage): Record<string, unknown> | null {
  if (usage.upstreamCost !== undefined) {
    return { cost: usage.upstreamCost, cost_currency: "VND", cost_source: "upstream" };
  }
  const estimate = costFor(member, usage.tokensIn, usage.tokensOut);
  if (estimate === null) return null;
  // With no token counts the estimate is just the floor. Vilao streams the
  // Anthropic protocol with usage zeroed, so say so rather than dress a floor
  // up as a computed figure; reconciliation replaces it a few seconds later.
  const noTokens = !usage.tokensIn && !usage.tokensOut;
  return { cost: estimate, cost_currency: "VND", cost_source: noTokens ? "floor" : "estimated" };
}

/**
 * Tries a pool's members in order until one answers, for any /v1 endpoint.
 *
 * Every attempt is logged, successful or not. Failed attempts are the more
 * valuable half: they feed member scoring, and they are the only way to see
 * what falling back actually costs — an attempt that produced nothing can still
 * be billed, since CKey charges its minimum per call.
 */
export async function executeRequest(input: ExecuteInput): Promise<Response> {
  const {
    config, clientKeyId, path, endpoint, requestedModel, body, chain, poolId, poolName,
    maxAttempts, ttfbTimeoutMs, totalTimeoutMs, maxPricePerRequest, clientSignal,
    forwardHeaders = {}, errorStyle = "openai",
  } = input;
  const err = (code: string, message: string, type: string) => errorBody(errorStyle, code, message, type);

  if (poolId) {
    const verdict = checkBudget(poolId, input.dailyBudget, input.monthlyBudget);
    if (!verdict.allowed) {
      return jsonResponse(err("budget_exhausted", verdict.reason!, "insufficient_quota"), 402);
    }
  }

  const wantsStream = body.stream === true;
  const candidates = maxPricePerRequest === null
    ? chain
    : chain.filter((m) => (m.price_floor ?? m.price_request ?? 0) <= maxPricePerRequest);

  if (candidates.length === 0) {
    return jsonResponse(
      err("no_member_within_budget", "Không thành viên nào dưới trần giá mỗi request.", "invalid_request_error"),
      409,
    );
  }

  const attempts = Math.min(maxAttempts, candidates.length);
  const failures: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const member = candidates[attempt - 1];
    const deadline = AbortSignal.any([AbortSignal.timeout(totalTimeoutMs), clientSignal]);
    const startedAt = Date.now();

    const log = (extra: Partial<Parameters<typeof recordRun>[1]>) => {
      // Vilao never reports cost inline; a successful call there leaves a
      // priceless row behind until the management API is consulted.
      if (member.platform === "vilao") scheduleReconcile(config);
      recordRun(clientKeyId, {
        platform: member.platform,
        listingId: member.id,
        poolId,
        requestedModel,
        attemptNo: attempt,
        endpoint,
        stream: wantsStream,
        status: "error",
        ...extra,
      } as Parameters<typeof recordRun>[1]);
    };

    const usageLog = (u: NormalizedUsage) => ({
      tokensIn: u.tokensIn,
      tokensOut: u.tokensOut,
      costVnd: u.upstreamCost ?? costFor(member, u.tokensIn, u.tokensOut) ?? undefined,
      upstreamRequestId: u.upstreamRequestId,
    });

    let response: Response;
    try {
      ({ response } = await dispatchTo(config, member, path, body, deadline, forwardHeaders));

      if (!response.ok) {
        const raw = await response.text();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* not JSON; the normalizer falls back to the status code */
        }
        const norm = normalizeUpstreamError(member.platform, response.status, parsed);
        log({
          status: "error",
          errorCode: norm.code,
          httpStatus: norm.httpStatus,
          upstreamRequestId: norm.upstreamRequestId,
          latencyMs: Date.now() - startedAt,
        });
        failures.push(`${member.display_name}: ${norm.code}`);

        // A malformed request fails the same way at every seller, so retrying it
        // only spends money. Rate limits and gateway faults are worth moving on.
        if (!norm.retryable || attempt === attempts) {
          return new Response(raw || JSON.stringify(err(norm.code, norm.message, "api_error")), {
            status: response.status,
            headers: { "Content-Type": "application/json", "X-Gateway-Attempts": String(attempt) },
          });
        }
        continue;
      }
    } catch (error) {
      if (clientSignal.aborted) {
        log({ status: "client_abort", errorCode: "client_abort", latencyMs: Date.now() - startedAt });
        return new Response(null, { status: 499 });
      }
      log({ status: "error", errorCode: "upstream_unreachable", latencyMs: Date.now() - startedAt });
      failures.push(`${member.display_name}: unreachable`);
      if (attempt === attempts) {
        return jsonResponse(err("all_members_failed", `Mọi thành viên đều hỏng: ${failures.join(" · ")}`, "api_error"), 502);
      }
      continue;
    }

    const headers = {
      "X-Gateway-Attempts": String(attempt),
      "X-Gateway-Listing": member.id,
      ...(poolName ? { "X-Gateway-Pool": poolName } : {}),
    };

    if (!wantsStream) {
      const payload = (await response.json()) as Record<string, unknown>;
      const usage = extractUsage(payload);
      log({ status: "ok", actualModel: typeof payload.model === "string" ? payload.model : undefined, ...usageLog(usage) });

      // Give the caller a cost they can rely on, whichever platform served.
      const extra = costFields(member, usage);
      if (extra && payload.usage && typeof payload.usage === "object") {
        payload.usage = { ...(payload.usage as Record<string, unknown>), ...extra };
      }
      return jsonResponse(payload, 200, headers);
    }

    if (!response.body) {
      log({ status: "error", errorCode: "empty_stream", latencyMs: Date.now() - startedAt });
      failures.push(`${member.display_name}: empty_stream`);
      if (attempt === attempts) {
        return jsonResponse(err("all_members_failed", failures.join(" · "), "api_error"), 502);
      }
      continue;
    }

    // The commit point. Past this line the client owns the bytes and no other
    // member can be tried, so everything recoverable is caught here first.
    let held;
    try {
      held = await holdFirstChunk(response.body, startedAt, ttfbTimeoutMs);
    } catch (error) {
      const code = String((error as Error).message).split(":")[0];
      log({ status: "error", errorCode: code, latencyMs: Date.now() - startedAt });
      failures.push(`${member.display_name}: ${code}`);
      if (attempt === attempts) {
        return jsonResponse(err("all_members_failed", `Mọi thành viên đều hỏng: ${failures.join(" · ")}`, "api_error"), 502);
      }
      continue;
    }

    const instrumented = instrumentSse(
      held.body,
      startedAt,
      (result) => {
        const hasUsage = result.usage.tokensIn !== undefined || result.usage.tokensOut !== undefined;
        log({
          // A stream ending with no usage frame was cut short, not completed.
          status: hasUsage ? "ok" : "client_abort",
          actualModel: result.actualModel,
          ttfbMs: held.ttfbMs,
          latencyMs: result.latencyMs,
          ...usageLog(result.usage),
        });
      },
      clientSignal,
      { augmentUsage: (u) => costFields(member, u) },
    );

    return new Response(instrumented, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  return jsonResponse(err("all_members_failed", `Mọi thành viên đều hỏng: ${failures.join(" · ")}`, "api_error"), 502);
}
