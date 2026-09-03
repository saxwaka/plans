import { getDb } from "../db";
import type { GatewayConfig } from "./config";
import type { Listing } from "./catalog";
import * as ckey from "./upstream/ckey";
import * as vilao from "./upstream/vilao";

export interface Dispatched {
  response: Response;
  startedAt: number;
}

/**
 * Vilao refuses any model not attached to the LLM key, so a listing has to be
 * subscribed before its first call. The result is remembered, since re-posting a
 * subscription on every request would burn the 120 req/min management quota.
 *
 * Pools pick a member at request time, so this cannot be a setup step — but it
 * is also done eagerly when a member is added, and this call is the safety net.
 */
async function ensureSubscribed(config: GatewayConfig, listing: Listing): Promise<void> {
  if (listing.platform !== "vilao" || !listing.provider_id) return;

  const known = getDb()
    .prepare("SELECT 1 FROM subscription WHERE listing_id = ?")
    .get(listing.id);
  if (known) return;

  const keyId = config.vilaoKeyId || (await vilao.listKeys(config))[0]?.id;
  if (!keyId) throw new Error("No Vilao LLM key found — set VILAO_KEY_ID");

  let subId: string | undefined;
  try {
    subId = await vilao.subscribe(config, keyId, listing.provider_id, listing.external_id);
  } catch (error) {
    // Already-subscribed reads as an error too; the call below will prove which.
    if (!/already|exists|duplicate/i.test(String(error))) throw error;
  }
  getDb()
    .prepare(
      "INSERT INTO subscription (listing_id, upstream_sub_id, subscribed_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(listing_id) DO NOTHING",
    )
    .run(listing.id, subId ?? null, new Date().toISOString());
}

/** Sends one chat request to whichever platform owns the listing. */
export async function dispatchChat(
  config: GatewayConfig,
  listing: Listing,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Dispatched> {
  const payload = { ...body, model: listing.external_id };

  if (listing.platform === "vilao") {
    await ensureSubscribed(config, listing);
    return vilao.chatCompletions(config, payload, signal);
  }
  return ckey.chatCompletions(config, payload, signal);
}

export function getListing(id: string): Listing | undefined {
  return getDb().prepare("SELECT * FROM listing WHERE id = ?").get(id) as Listing | undefined;
}

/** Falls back to a bare CKey listing so a client naming a raw id still works. */
export function syntheticCkeyListing(externalId: string): Listing {
  const slash = externalId.lastIndexOf("/");
  return {
    id: `ckey:${externalId}`,
    platform: "ckey",
    external_id: externalId,
    provider_id: null,
    seller: slash === -1 ? null : externalId.slice(0, slash),
    display_name: externalId,
    base_model: externalId,
    kind: "text",
    pricing_mode: null,
    price_in: null, price_out: null, price_request: null, price_floor: null,
    context_len: null, supports_tools: null, supports_vision: null,
    success_rate: null, total_requests: null, avg_latency_ms: null, verified: null,
    stale: 0,
    synced_at: new Date().toISOString(),
  };
}
