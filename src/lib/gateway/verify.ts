import { getDb } from "../db";
import type { GatewayConfig } from "./config";
import { dispatchChat } from "./dispatch";
import { normalizeUpstreamError } from "./errors";
import type { PoolMember } from "./pool";
import { candidates, poolMembers } from "./pool";
import { recordRun } from "./runlog";

/**
 * Cost of one probe against a listing.
 *
 * A probe sends one token and asks for one back, but that barely matters:
 * measured across a real pool, the token component came to 0.0002₫ while the
 * charge was 5-72₫, because billing is max(floor, per-request + tokens) and a
 * tiny call is priced entirely by the floor. So "a super light call" is not a
 * cheap call, and the UI must quote this before anyone presses the button.
 */
export function probeCost(member: PoolMember): number {
  const tokens = ((member.price_in ?? 0) + (member.price_out ?? 0)) / 1_000_000;
  return Math.max(member.price_floor ?? 0, (member.price_request ?? 0) + tokens);
}

export function verifyEstimate(poolId: string, includeCandidates: boolean): {
  members: number;
  cost: number;
} {
  const targets = verifyTargets(poolId, includeCandidates);
  return { members: targets.length, cost: targets.reduce((sum, m) => sum + probeCost(m), 0) };
}

function verifyTargets(poolId: string, includeCandidates: boolean): PoolMember[] {
  const active = poolMembers(poolId);
  return includeCandidates ? [...active, ...candidates(poolId)] : active;
}

export interface ProbeResult {
  listingId: string;
  displayName: string;
  platform: string;
  ok: boolean;
  latencyMs: number;
  costVnd: number | null;
  actualModel: string | null;
  errorCode: string | null;
  httpStatus: number | null;
}

const PROBE_BODY = {
  max_tokens: 1,
  messages: [{ role: "user", content: "hi" }],
  stream: false,
};

/**
 * Calls every member of a pool once and records what happened.
 *
 * This is deliberately manual. The gateway never probes on a schedule — that
 * would spend real money on nobody's behalf — but a sweep the operator asks for
 * is the only way to learn about a listing before trusting it with work, and it
 * closes the cold start that otherwise leaves cheap CKey sellers permanently
 * unproven.
 *
 * Probes are logged as ordinary runs marked kind='probe': they are genuine
 * evidence and count towards reliability, but stay separable from real spend.
 */
export async function verifyPool(
  config: GatewayConfig,
  poolId: string,
  options: { includeCandidates?: boolean; concurrency?: number; timeoutMs?: number } = {},
): Promise<ProbeResult[]> {
  const targets = verifyTargets(poolId, options.includeCandidates ?? true);
  // Kept low on purpose: Vilao caps a token at 120 requests a minute, and a
  // verify sweep should never be the thing that trips a rate limit.
  const concurrency = options.concurrency ?? 4;
  const timeoutMs = options.timeoutMs ?? 45_000;

  const results: ProbeResult[] = new Array(targets.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < targets.length) {
      const index = cursor++;
      results[index] = await probeOne(config, poolId, targets[index], timeoutMs);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return results;
}

async function probeOne(
  config: GatewayConfig,
  poolId: string,
  member: PoolMember,
  timeoutMs: number,
): Promise<ProbeResult> {
  const startedAt = Date.now();
  const base = {
    listingId: member.id,
    displayName: member.display_name,
    platform: member.platform,
  };

  const log = (extra: Record<string, unknown>) =>
    recordRun(null, {
      platform: member.platform,
      listingId: member.id,
      poolId,
      requestedModel: member.external_id,
      kind: "probe",
      stream: false,
      status: "error",
      ...extra,
    } as Parameters<typeof recordRun>[1]);

  try {
    const { response } = await dispatchChat(
      config,
      member,
      PROBE_BODY,
      AbortSignal.timeout(timeoutMs),
    );
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const raw = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* keep the status code as the signal */
      }
      const err = normalizeUpstreamError(member.platform, response.status, parsed);
      log({ status: "error", errorCode: err.code, httpStatus: err.httpStatus, latencyMs });
      return {
        ...base, ok: false, latencyMs, costVnd: null,
        actualModel: null, errorCode: err.code, httpStatus: err.httpStatus,
      };
    }

    const payload = (await response.json()) as {
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; x_ckey?: { cost?: number } };
    };
    const costVnd = payload.usage?.x_ckey?.cost ?? null;

    log({
      status: "ok",
      actualModel: payload.model,
      tokensIn: payload.usage?.prompt_tokens,
      tokensOut: payload.usage?.completion_tokens,
      costVnd,
      latencyMs,
    });

    return {
      ...base, ok: true, latencyMs, costVnd,
      actualModel: payload.model ?? null, errorCode: null, httpStatus: null,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const code = String((error as Error).name === "TimeoutError" ? "timeout" : "unreachable");
    log({ status: "error", errorCode: code, latencyMs });
    return {
      ...base, ok: false, latencyMs, costVnd: null,
      actualModel: null, errorCode: code, httpStatus: null,
    };
  }
}

export interface LastProbe {
  listing_id: string;
  status: string;
  latency_ms: number | null;
  error_code: string | null;
  created_at: string;
}

/** Most recent probe per listing, for showing results after the sweep. */
export function lastProbes(poolId: string): Map<string, LastProbe> {
  const rows = getDb()
    .prepare(
      `SELECT r.listing_id, r.status, r.latency_ms, r.error_code, r.created_at
         FROM run r
         JOIN (SELECT listing_id, MAX(created_at) AS newest FROM run
                WHERE kind = 'probe' AND pool_id = ? GROUP BY listing_id) latest
           ON latest.listing_id = r.listing_id AND latest.newest = r.created_at
        WHERE r.kind = 'probe' AND r.pool_id = ?`,
    )
    .all(poolId, poolId) as LastProbe[];

  return new Map(rows.map((r) => [r.listing_id, r]));
}
