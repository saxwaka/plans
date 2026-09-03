import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { baseModelName } from "./modelname";
import { hasVilao, type GatewayConfig } from "./config";
import { fetchMarketplace } from "./upstream/vilao";
import { listModels as ckeyListModels } from "./upstream/ckey";
import type { Platform } from "./types";

export interface Listing {
  id: string;
  platform: Platform;
  external_id: string;
  provider_id: string | null;
  seller: string | null;
  display_name: string;
  base_model: string;
  kind: string;
  pricing_mode: string | null;
  price_in: number | null;
  price_out: number | null;
  price_request: number | null;
  price_floor: number | null;
  context_len: number | null;
  supports_tools: number | null;
  supports_vision: number | null;
  success_rate: number | null;
  total_requests: number | null;
  avg_latency_ms: number | null;
  verified: number | null;
  stale: number;
  synced_at: string;
}

interface CkeyModel {
  id: string;
  context?: number;
  pricing?: {
    input?: number;
    output?: number;
    per_request?: number;
    min_charge_per_request?: number;
  };
}

/** Both platforms price in VND per 1,000,000 tokens — proven in docs/api-notes.md. */
function fromCkey(m: CkeyModel): Omit<Listing, "stale" | "synced_at"> & { raw: string } {
  const p = m.pricing ?? {};
  const slash = m.id.lastIndexOf("/");
  return {
    id: `ckey:${m.id}`,
    platform: "ckey",
    external_id: m.id,
    provider_id: null,
    seller: slash === -1 ? null : m.id.slice(0, slash),
    display_name: m.id,
    base_model: baseModelName(m.id),
    kind: "text",
    // input and prompt are two names for one number; same for output and completion.
    pricing_mode: p.input ? "token" : "request",
    price_in: p.input ?? null,
    price_out: p.output ?? null,
    price_request: p.per_request ?? null,
    price_floor: p.min_charge_per_request ?? null,
    // context 0 means "not declared", not a zero-length context.
    context_len: m.context ? m.context : null,
    supports_tools: null,
    supports_vision: null,
    // CKey publishes no quality signal at all. Leaving these NULL rather than 0
    // is what lets filters tell "unknown" apart from "bad".
    success_rate: null,
    total_requests: null,
    avg_latency_ms: null,
    verified: null,
    raw: JSON.stringify(m),
  };
}

interface VilaoEntry {
  provider_id: string;
  seller_slug?: string;
  model_id: string;
  display_name?: string;
  pricing_mode?: string;
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

function fromVilao(e: VilaoEntry): Omit<Listing, "stale" | "synced_at"> & { raw: string } {
  return {
    id: `vilao:${e.provider_id}:${e.model_id}`,
    platform: "vilao",
    external_id: e.model_id,
    provider_id: e.provider_id,
    seller: e.seller_slug ?? null,
    display_name: e.display_name || e.model_id,
    base_model: baseModelName(e.model_id),
    kind: e.type ?? "text",
    pricing_mode: e.pricing_mode ?? null,
    price_in: e.price_per_input_token ?? null,
    price_out: e.price_per_output_token ?? null,
    price_request: e.price_per_request ?? null,
    price_floor: e.min_price_per_request ?? null,
    context_len: e.max_context_length ?? null,
    supports_tools: e.options?.supports_tools ? 1 : 0,
    supports_vision: e.options?.supports_vision ? 1 : 0,
    success_rate: e.success_rate ?? null,
    total_requests: e.total_requests ?? null,
    avg_latency_ms: e.avg_latency_ms ?? null,
    verified: e.provider_verified ? 1 : 0,
    raw: JSON.stringify(e),
  };
}

export interface SyncReport {
  platform: Platform;
  seen: number;
  markedStale: number;
  error?: string;
}

export async function syncAll(config: GatewayConfig): Promise<SyncReport[]> {
  const reports: SyncReport[] = [];
  reports.push(await syncCkey(config));
  if (hasVilao(config)) reports.push(await syncVilao(config));
  return reports;
}

async function syncCkey(config: GatewayConfig): Promise<SyncReport> {
  try {
    const response = await ckeyListModels(config);
    if (!response.ok) throw new Error(`CKey /models returned ${response.status}`);
    const body = (await response.json()) as { data?: CkeyModel[] };
    return upsert("ckey", (body.data ?? []).map(fromCkey));
  } catch (error) {
    return { platform: "ckey", seen: 0, markedStale: 0, error: String((error as Error).message) };
  }
}

async function syncVilao(config: GatewayConfig): Promise<SyncReport> {
  try {
    const entries = await fetchMarketplace(config);
    return upsert("vilao", entries.map(fromVilao));
  } catch (error) {
    return { platform: "vilao", seen: 0, markedStale: 0, error: String((error as Error).message) };
  }
}

type Incoming = Omit<Listing, "stale" | "synced_at"> & { raw: string };

/**
 * Listings that vanish are marked stale rather than deleted: a measured snapshot
 * pair an hour apart already showed one CKey listing renamed, and run history
 * pointing at a deleted row would be orphaned.
 */
function upsert(platform: Platform, rows: Incoming[]): SyncReport {
  const db = getDb();
  const now = new Date().toISOString();

  const write = db.prepare(`
    INSERT INTO listing (
      id, platform, external_id, provider_id, seller, display_name, base_model, kind,
      pricing_mode, price_in, price_out, price_request, price_floor, context_len,
      supports_tools, supports_vision, success_rate, total_requests, avg_latency_ms,
      verified, raw_json, synced_at, stale
    ) VALUES (
      @id, @platform, @external_id, @provider_id, @seller, @display_name, @base_model, @kind,
      @pricing_mode, @price_in, @price_out, @price_request, @price_floor, @context_len,
      @supports_tools, @supports_vision, @success_rate, @total_requests, @avg_latency_ms,
      @verified, @raw, @synced_at, 0
    )
    ON CONFLICT(id) DO UPDATE SET
      seller=excluded.seller, display_name=excluded.display_name, base_model=excluded.base_model,
      kind=excluded.kind, pricing_mode=excluded.pricing_mode, price_in=excluded.price_in,
      price_out=excluded.price_out, price_request=excluded.price_request,
      price_floor=excluded.price_floor, context_len=excluded.context_len,
      supports_tools=excluded.supports_tools, supports_vision=excluded.supports_vision,
      success_rate=excluded.success_rate, total_requests=excluded.total_requests,
      avg_latency_ms=excluded.avg_latency_ms, verified=excluded.verified,
      raw_json=excluded.raw_json, synced_at=excluded.synced_at, stale=0
  `);

  const run = db.transaction((batch: Incoming[]) => {
    for (const row of batch) write.run({ ...row, synced_at: now });
    return db
      .prepare("UPDATE listing SET stale = 1 WHERE platform = ? AND synced_at < ? AND stale = 0")
      .run(platform, now).changes;
  });

  const markedStale = run(rows);
  return { platform, seen: rows.length, markedStale };
}

export function saveFilter(name: string, filterJson: string): void {
  getDb()
    .prepare("INSERT INTO saved_filter (id, name, filter_json, created_at) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), name, filterJson, new Date().toISOString());
}
