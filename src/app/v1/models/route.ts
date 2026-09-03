import { authenticate } from "@/lib/gateway/auth";
import { checkRate } from "@/lib/gateway/ratelimit";
import { openAiErrorBody } from "@/lib/gateway/errors";
import { listPools } from "@/lib/gateway/pool";
import { queryListings } from "@/lib/gateway/filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Advertises pools first — those are the names worth choosing in a client's
 * model dropdown. Raw listings follow so a passthrough call still autocompletes.
 */
export async function GET(request: Request): Promise<Response> {
  const client = authenticate(request.headers.get("authorization"));
  if (!client) {
    return new Response(
      JSON.stringify(openAiErrorBody("invalid_api_key", "Invalid API key.", "authentication_error")),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  // This route has its own handler rather than going through handleV1, so it
  // has to apply the same per-key limit itself or it becomes the one path a
  // runaway client can hammer for free.
  const rate = checkRate(client.id);
  if (!rate.allowed) {
    return new Response(
      JSON.stringify(openAiErrorBody("rate_limited", `Key exceeded ${rate.limit} requests/minute.`, "rate_limit_error")),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const created = Math.floor(Date.now() / 1000);
  const pools = listPools()
    .filter((pool) => pool.members > 0)
    .map((pool) => ({
      id: pool.name,
      object: "model" as const,
      created,
      owned_by: "gateway",
      gateway: { kind: "pool", members: pool.members, strategy: pool.strategy },
    }));

  const listings = queryListings({ kind: "text" }, 1000).map((listing) => ({
    id: listing.platform === "ckey" ? listing.external_id : listing.id,
    object: "model" as const,
    created,
    owned_by: listing.platform,
    gateway: { kind: "listing", seller: listing.seller, price_in: listing.price_in },
  }));

  return new Response(JSON.stringify({ object: "list", data: [...pools, ...listings] }), {
    headers: { "Content-Type": "application/json" },
  });
}
