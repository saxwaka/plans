import type { GatewayConfig } from "../config";

/**
 * Vilao runs two APIs that do not share credentials:
 *   inference  api.vilao.ai/v1        LLM key, header MUST be x-api-key
 *   management vilao.ai/api/v2        Personal Access Token, Bearer
 *
 * The inference side rejects Bearer with INVALID_API_KEY — a misleading message,
 * since the key is fine and only the header is wrong. See docs/api-notes.md.
 */

export interface VilaoMarketplaceEntry {
  provider_id: string;
  provider_name?: string;
  seller_slug?: string;
  model_id: string;
  display_name?: string;
  pricing_mode?: "token" | "request";
  price_per_input_token?: number;
  price_per_output_token?: number;
  price_per_request?: number;
  min_price_per_request?: number;
  max_context_length?: number;
  type?: string;
  options?: { supports_tools?: boolean; supports_vision?: boolean };
  success_rate?: number;
  total_requests?: number;
  avg_latency_ms?: number;
  provider_verified?: boolean;
}

async function v2<T>(config: GatewayConfig, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.vilaoManageUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.vilaoPat}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok) {
    const err = (body as { error?: { message?: string } })?.error;
    throw new Error(`Vilao v2 ${path}: ${response.status} ${err?.message ?? ""}`.trim());
  }
  return body as T;
}

/** Walks the paginated marketplace. Rate limit is 120 req/min per token. */
export async function fetchMarketplace(config: GatewayConfig): Promise<VilaoMarketplaceEntry[]> {
  const entries: VilaoMarketplaceEntry[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 20; page++) {
    const body = await v2<{ data?: VilaoMarketplaceEntry[]; total_count?: number }>(
      config,
      `/llm/marketplace/models?page=${page}&page_size=100`,
    );
    const batch = body.data ?? [];
    if (batch.length === 0) break;

    for (const entry of batch) {
      const key = `${entry.provider_id}:${entry.model_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push(entry);
      }
    }
    if (body.total_count && entries.length >= body.total_count) break;
  }
  return entries;
}

export async function listKeys(config: GatewayConfig): Promise<{ id: string; key_prefix: string }[]> {
  const body = await v2<{ data?: { id: string; key_prefix: string }[] }>(config, "/llm/keys");
  return body.data ?? [];
}

/** Attaches a marketplace listing to the LLM key. Without this, calls get FORBIDDEN. */
export async function subscribe(
  config: GatewayConfig,
  keyId: string,
  providerId: string,
  modelId: string,
): Promise<string | undefined> {
  const body = await v2<{ data?: { id?: string } }>(config, `/llm/keys/${keyId}/subscriptions`, {
    method: "POST",
    body: JSON.stringify({ provider_id: providerId, model_id: modelId }),
  });
  return body.data?.id;
}

export async function chatCompletions(
  config: GatewayConfig,
  body: unknown,
  signal: AbortSignal,
): Promise<{ response: Response; startedAt: number }> {
  const startedAt = Date.now();
  const response = await fetch(`${config.vilaoBaseUrl}/chat/completions`, {
    method: "POST",
    // x-api-key, never Bearer — see the note at the top of this file.
    headers: { "x-api-key": config.vilaoApiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    // @ts-expect-error -- undici option, not in the DOM fetch types
    duplex: "half",
  });
  return { response, startedAt };
}

/** Vilao reports cost only here; usage.cost in the OpenAI response is always 0. */
export async function fetchRunCost(
  config: GatewayConfig,
): Promise<{ total_cost?: number; actual_model?: string } | null> {
  try {
    const body = await v2<{ data?: { total_cost?: number; actual_model?: string }[] }>(
      config,
      "/llm/usage?page=1&page_size=1",
    );
    return body.data?.[0] ?? null;
  } catch {
    return null;
  }
}
