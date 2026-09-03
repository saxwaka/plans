import { guard, isResponse, ok } from "@/lib/gateway/api";
import { countAll, countListings, queryListings, type ListingFilter } from "@/lib/gateway/filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/catalog — the same filter the UI uses, as query parameters.
 * Quality thresholds keep unmeasured listings unless include_unmeasured=0;
 * dropping them removes every CKey row, since CKey publishes no stats.
 */
export function GET(request: Request): Response {
  const g = guard(request);
  if (isResponse(g)) return g;

  const q = new URL(request.url).searchParams;
  const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined);
  const filter: ListingFilter = {
    platform: (q.get("platform") as ListingFilter["platform"]) || undefined,
    kind: q.get("kind") || undefined,
    seller: q.get("seller") || undefined,
    search: q.get("search") || undefined,
    maxPriceIn: num("max_price_in"),
    maxPriceRequest: num("max_price_request"),
    minContext: num("min_context"),
    minSuccessRate: num("min_success_rate"),
    minTotalRequests: num("min_total_requests"),
    maxLatencyMs: num("max_latency_ms"),
    supportsTools: q.get("supports_tools") === "1",
    verifiedOnly: q.get("verified_only") === "1",
    includeUnmeasured: q.get("include_unmeasured") !== "0",
    includeStale: q.get("include_stale") === "1",
  };
  const limit = Math.min(Number(q.get("limit") ?? 200), 1000);

  return ok({
    total: countAll(filter.includeStale),
    matching: countListings(filter),
    filter,
    data: queryListings(filter, limit),
  });
}
