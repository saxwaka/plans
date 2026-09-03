import { fail, guard, isResponse, ok, readJson } from "@/lib/gateway/api";
import { poolDetail } from "@/lib/gateway/admin";
import { getListing } from "@/lib/gateway/dispatch";
import {
  addMember, findPoolByName, removeMember, setMemberPosition, setMemberState, setMemberWeight,
} from "@/lib/gateway/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/**
 * Listing ids contain ':' and '/', so they travel in the body rather than the
 * path. Ids look like "ckey:<seller>/<model>" or "vilao:<provider_id>:<model>",
 * exactly as returned by GET /api/catalog.
 */
interface MemberBody {
  listing_id?: string;
  state?: "active" | "blocked" | "candidate";
  position?: number;
  weight?: number;
}

type Resolved =
  | { error: Response }
  | { error?: undefined; name: string; pool: NonNullable<ReturnType<typeof findPoolByName>>; body: MemberBody };

async function resolve(request: Request, ctx: Ctx): Promise<Resolved> {
  const { name } = await ctx.params;
  const pool = findPoolByName(name);
  if (!pool) return { error: fail(404, "not_found", `Pool "${name}" not found.`) };
  const body = await readJson<MemberBody>(request);
  if (isResponse(body)) return { error: body };
  if (!body.listing_id) return { error: fail(400, "listing_id_required", "Body needs listing_id.") };
  return { name, pool, body };
}

/** POST — add a listing as an active member (appended last). */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const g = guard(request);
  if (isResponse(g)) return g;
  const r = await resolve(request, ctx);
  if (r.error) return r.error;
  if (!getListing(r.body.listing_id!)) return fail(404, "listing_not_found", `No listing "${r.body.listing_id}" in the catalog. Sync first?`);
  addMember(r.pool.id, r.body.listing_id!);
  return ok(poolDetail(r.name), 201);
}

/** PATCH — change state (on/off/admit), position (1-based) or weight. */
export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const g = guard(request);
  if (isResponse(g)) return g;
  const r = await resolve(request, ctx);
  if (r.error) return r.error;
  const { pool, body } = r;
  if (body.state) {
    if (!["active", "blocked", "candidate"].includes(body.state)) return fail(400, "bad_state", "state must be active, blocked or candidate.");
    setMemberState(pool.id, body.listing_id!, body.state);
  }
  if (body.position !== undefined) setMemberPosition(pool.id, body.listing_id!, body.position);
  if (body.weight !== undefined) setMemberWeight(pool.id, body.listing_id!, body.weight);
  return ok(poolDetail(r.name));
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const g = guard(request);
  if (isResponse(g)) return g;
  const r = await resolve(request, ctx);
  if (r.error) return r.error;
  removeMember(r.pool.id, r.body.listing_id!);
  return ok(poolDetail(r.name));
}
