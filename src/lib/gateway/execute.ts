import { checkBudget } from "./budget";
import type { GatewayConfig } from "./config";
import { dispatchChat } from "./dispatch";
import { normalizeUpstreamError, openAiErrorBody } from "./errors";
import type { PoolMember } from "./pool";
import { scheduleReconcile } from "./reconcile";
import { recordRun } from "./runlog";
import { holdFirstChunk, instrumentSse } from "./stream";
import type { UpstreamUsage } from "./types";

export interface ExecuteInput {
  config: GatewayConfig;
  clientKeyId: string;
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
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Tries a pool's members in order until one answers, then streams or returns it.
 *
 * Every attempt is logged, successful or not. Failed attempts are the more
 * valuable half: they feed member scoring, and they are the only way to see
 * what falling back actually costs — an attempt that produced nothing can still
 * be billed, since CKey charges its minimum per call.
 */
export async function executeChat(input: ExecuteInput): Promise<Response> {
  const {
    config, clientKeyId, requestedModel, body, chain, poolId, poolName,
    maxAttempts, ttfbTimeoutMs, totalTimeoutMs, maxPricePerRequest, clientSignal,
  } = input;

  if (poolId) {
    const verdict = checkBudget(poolId, input.dailyBudget, input.monthlyBudget);
    if (!verdict.allowed) {
      return json(openAiErrorBody("budget_exhausted", verdict.reason!, "insufficient_quota"), 402);
    }
  }

  const wantsStream = body.stream === true;
  const candidates = maxPricePerRequest === null
    ? chain
    : chain.filter((m) => (m.price_floor ?? m.price_request ?? 0) <= maxPricePerRequest);

  if (candidates.length === 0) {
    return json(
      openAiErrorBody("no_member_within_budget", "Không thành viên nào dưới trần giá mỗi request."),
      409,
    );
  }

  const attempts = Math.min(maxAttempts, candidates.length);
  const failures: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const member = candidates[attempt - 1];
    const deadline = AbortSignal.any([AbortSignal.timeout(totalTimeoutMs), clientSignal]);
    const startedAt = Date.now();

    const log = (extra: Parameters<typeof recordRun>[1] extends infer T ? Partial<T> : never) => {
      // Vilao never reports cost inline, so a successful call there leaves a
      // priceless row behind until the management API is consulted.
      if (member.platform === "vilao") scheduleReconcile(config);
      recordRun(clientKeyId, {
        platform: member.platform,
        listingId: member.id,
        poolId,
        requestedModel,
        attemptNo: attempt,
        stream: wantsStream,
        status: "error",
        ...extra,
      } as Parameters<typeof recordRun>[1]);
    };

    let response: Response;
    try {
      const call = await dispatchChat(config, member, body, deadline);
      response = call.response;

      if (!response.ok) {
        const raw = await response.text();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* not JSON; the normalizer falls back to the status code */
        }
        const err = normalizeUpstreamError(member.platform, response.status, parsed);
        log({
          status: "error",
          errorCode: err.code,
          httpStatus: err.httpStatus,
          upstreamRequestId: err.upstreamRequestId,
          latencyMs: Date.now() - startedAt,
        });
        failures.push(`${member.display_name}: ${err.code}`);

        // A malformed request fails the same way at every seller, so retrying it
        // only spends money. Rate limits and gateway faults are worth moving on.
        if (!err.retryable || attempt === attempts) {
          return new Response(raw || JSON.stringify(openAiErrorBody(err.code, err.message, "api_error")), {
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
        return json(
          openAiErrorBody("all_members_failed", `Mọi thành viên đều hỏng: ${failures.join(" · ")}`, "api_error"),
          502,
        );
      }
      continue;
    }

    const headers = {
      "X-Gateway-Attempts": String(attempt),
      "X-Gateway-Listing": member.id,
      ...(poolName ? { "X-Gateway-Pool": poolName } : {}),
    };

    if (!wantsStream) {
      const payload = (await response.json()) as { usage?: UpstreamUsage; model?: string };
      log({
        status: "ok",
        actualModel: payload.model,
        tokensIn: payload.usage?.prompt_tokens,
        tokensOut: payload.usage?.completion_tokens,
        costVnd: payload.usage?.x_ckey?.cost,
        upstreamRequestId: payload.usage?.x_ckey?.request_id,
        latencyMs: Date.now() - startedAt,
      });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (!response.body) {
      log({ status: "error", errorCode: "empty_stream", latencyMs: Date.now() - startedAt });
      failures.push(`${member.display_name}: empty_stream`);
      if (attempt === attempts) {
        return json(openAiErrorBody("all_members_failed", failures.join(" · "), "api_error"), 502);
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
        return json(
          openAiErrorBody("all_members_failed", `Mọi thành viên đều hỏng: ${failures.join(" · ")}`, "api_error"),
          502,
        );
      }
      continue;
    }

    const instrumented = instrumentSse(
      held.body,
      startedAt,
      (result) => {
        log({
          status: result.usage ? "ok" : "client_abort",
          actualModel: result.actualModel,
          tokensIn: result.usage?.prompt_tokens,
          tokensOut: result.usage?.completion_tokens,
          costVnd: result.usage?.x_ckey?.cost,
          upstreamRequestId: result.usage?.x_ckey?.request_id,
          ttfbMs: held.ttfbMs,
          latencyMs: result.latencyMs,
        });
      },
      clientSignal,
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

  return json(
    openAiErrorBody("all_members_failed", `Mọi thành viên đều hỏng: ${failures.join(" · ")}`, "api_error"),
    502,
  );
}
