export interface GatewayConfig {
  ckeyBaseUrl: string;
  ckeyApiKey: string;
  vilaoBaseUrl: string;
  vilaoManageUrl: string;
  vilaoApiKey: string;
  vilaoPat: string;
  vilaoKeyId: string;
  defaultModel: string;
  ttfbTimeoutMs: number;
  totalTimeoutMs: number;
}

export function loadConfig(): GatewayConfig {
  const ckeyApiKey = process.env.CKEY_API_KEY;
  if (!ckeyApiKey) throw new Error("CKEY_API_KEY is not set — copy .env.example to .env.local");

  return {
    ckeyBaseUrl: process.env.CKEY_BASE_URL ?? "https://api.xah.io/v1",
    ckeyApiKey,
    vilaoBaseUrl: process.env.VILAO_BASE_URL ?? "https://api.vilao.ai/v1",
    vilaoManageUrl: process.env.VILAO_MANAGE_URL ?? "https://vilao.ai/api/v2",
    vilaoApiKey: process.env.VILAO_API_KEY ?? "",
    vilaoPat: process.env.VILAO_PAT ?? "",
    vilaoKeyId: process.env.VILAO_KEY_ID ?? "",
    defaultModel: process.env.GATEWAY_DEFAULT_MODEL ?? "dungcsnd113/claude-opus-5",
    // Measured: 40s for a 104-token completion. A 30s default would cut real work off.
    ttfbTimeoutMs: Number(process.env.GATEWAY_TTFB_TIMEOUT_MS ?? 60_000),
    totalTimeoutMs: Number(process.env.GATEWAY_TOTAL_TIMEOUT_MS ?? 300_000),
  };
}

export function hasVilao(config: GatewayConfig): boolean {
  return Boolean(config.vilaoApiKey && config.vilaoPat);
}
