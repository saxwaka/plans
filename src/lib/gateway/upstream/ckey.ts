import type { GatewayConfig } from "../config";

export interface UpstreamCall {
  response: Response;
  startedAt: number;
}

/**
 * CKey speaks plain OpenAI on Bearer auth, so this is a forward rather than a
 * translation. See docs/api-notes.md for the base-URL and auth findings.
 */
export async function chatCompletions(
  config: GatewayConfig,
  body: unknown,
  signal: AbortSignal,
): Promise<UpstreamCall> {
  const startedAt = Date.now();
  const response = await fetch(`${config.ckeyBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.ckeyApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
    // Node buffers a fetch body by default; without this the SSE frames would
    // arrive in one lump at the end instead of streaming.
    // @ts-expect-error -- undici option, not in the DOM fetch types
    duplex: "half",
  });
  return { response, startedAt };
}

export async function listModels(config: GatewayConfig, signal?: AbortSignal): Promise<Response> {
  return fetch(`${config.ckeyBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.ckeyApiKey}` },
    signal,
  });
}
