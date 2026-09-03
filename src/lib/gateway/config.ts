export interface GatewayConfig {
  ckeyBaseUrl: string;
  ckeyApiKey: string;
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
    defaultModel: process.env.GATEWAY_DEFAULT_MODEL ?? "dungcsnd113/claude-opus-5",
    // Measured: 40s for a 104-token completion. A 30s default would cut real work off.
    ttfbTimeoutMs: Number(process.env.GATEWAY_TTFB_TIMEOUT_MS ?? 60_000),
    totalTimeoutMs: Number(process.env.GATEWAY_TOTAL_TIMEOUT_MS ?? 300_000),
  };
}
