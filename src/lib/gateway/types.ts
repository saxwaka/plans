export type Platform = "ckey" | "vilao";

/** What an upstream reports once a call has finished, however it finished. */
export interface CallOutcome {
  platform: Platform;
  listingId: string;
  /** Pool that routed this call, or null when the model was passed straight through. */
  poolId?: string | null;
  /** 1 for the first member tried; higher values are fallback attempts. */
  attemptNo?: number;
  /** 'live' for a client's request, 'probe' for a verify sweep. */
  kind?: "live" | "probe";
  requestedModel: string;
  actualModel?: string;
  stream: boolean;
  tokensIn?: number;
  tokensOut?: number;
  costVnd?: number;
  ttfbMs?: number;
  latencyMs?: number;
  status: "ok" | "error" | "client_abort";
  errorCode?: string;
  httpStatus?: number;
  upstreamRequestId?: string;
}

/** Usage as it appears in an OpenAI-shaped response, plus CKey's cost extension. */
export interface UpstreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  x_ckey?: { cost?: number; request_id?: string };
}
