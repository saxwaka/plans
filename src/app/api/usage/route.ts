import { guard, isResponse, ok } from "@/lib/gateway/api";
import { recentRuns, spendByDay, spendByListing, spendToday, unpricedTotal } from "@/lib/gateway/runlog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const g = guard(request);
  if (isResponse(g)) return g;
  const q = new URL(request.url).searchParams;
  return ok({
    today: spendToday(),
    unpriced: unpricedTotal(),
    by_day: spendByDay(Number(q.get("days") ?? 14)),
    by_listing: spendByListing(Number(q.get("limit") ?? 30)),
    recent: q.get("recent") === "1" ? recentRuns(Number(q.get("recent_limit") ?? 50)) : undefined,
  });
}
