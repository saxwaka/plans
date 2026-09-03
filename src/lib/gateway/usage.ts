/**
 * Token usage, normalised across the shapes the upstreams return.
 *
 *   OpenAI chat / completions / embeddings   usage.prompt_tokens, completion_tokens
 *   OpenAI Responses API                     usage.input_tokens, output_tokens
 *   Anthropic Messages                       usage.input_tokens, output_tokens
 *                                            (streamed across message_start and message_delta)
 *   CKey extension                           usage.x_ckey.cost, request_id
 */
export interface NormalizedUsage {
  tokensIn?: number;
  tokensOut?: number;
  upstreamCost?: number;
  upstreamRequestId?: string;
}

type Loose = Record<string, unknown>;

export function extractUsage(payload: unknown): NormalizedUsage {
  const usage = (payload as Loose | null)?.usage as Loose | undefined;
  if (!usage) return {};
  const xckey = usage.x_ckey as Loose | undefined;
  return {
    tokensIn: num(usage.prompt_tokens ?? usage.input_tokens),
    tokensOut: num(usage.completion_tokens ?? usage.output_tokens),
    upstreamCost: num(xckey?.cost),
    upstreamRequestId: typeof xckey?.request_id === "string" ? xckey.request_id : undefined,
  };
}

/**
 * Merges usage seen across several stream frames.
 *
 * Token counts take the larger value rather than the later one. Anthropic puts
 * input_tokens in message_start and output_tokens in message_delta, and a
 * platform that fills only one of them sends an explicit 0 for the other — a
 * last-wins merge would let that 0 erase a real count from an earlier frame.
 */
export function mergeUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  const larger = (x?: number, y?: number) =>
    x === undefined ? y : y === undefined ? x : Math.max(x, y);
  return {
    tokensIn: larger(a.tokensIn, b.tokensIn),
    tokensOut: larger(a.tokensOut, b.tokensOut),
    upstreamCost: b.upstreamCost ?? a.upstreamCost,
    upstreamRequestId: b.upstreamRequestId ?? a.upstreamRequestId,
  };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
