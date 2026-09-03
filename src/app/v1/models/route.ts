import { authenticate } from "@/lib/gateway/auth";
import { loadConfig } from "@/lib/gateway/config";
import { openAiErrorBody } from "@/lib/gateway/errors";
import { listModels } from "@/lib/gateway/upstream/ckey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The catalog moves slowly; a measured snapshot changed one listing in an hour.
// Cache briefly so a client that lists models on every request does not hammer CKey.
let cache: { at: number; body: string } | null = null;
const TTL_MS = 5 * 60_000;

export async function GET(request: Request): Promise<Response> {
  if (!authenticate(request.headers.get("authorization"))) {
    return new Response(
      JSON.stringify(openAiErrorBody("invalid_api_key", "Invalid API key.", "authentication_error")),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  if (cache && Date.now() - cache.at < TTL_MS) {
    return new Response(cache.body, {
      headers: { "Content-Type": "application/json", "X-Gateway-Cache": "hit" },
    });
  }

  const upstream = await listModels(loadConfig());
  const body = await upstream.text();
  if (upstream.ok) cache = { at: Date.now(), body };

  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "X-Gateway-Cache": "miss" },
  });
}
