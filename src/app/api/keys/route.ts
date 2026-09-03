import { fail, guard, isResponse, ok, readJson } from "@/lib/gateway/api";
import { createKey, listKeys } from "@/lib/gateway/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const g = guard(request);
  if (isResponse(g)) return g;
  return ok({ data: listKeys() });
}

/** POST /api/keys { name, role? } — the raw key is returned ONCE and never stored. */
export async function POST(request: Request): Promise<Response> {
  const g = guard(request);
  if (isResponse(g)) return g;
  const body = await readJson<{ name?: string; role?: string }>(request);
  if (isResponse(body)) return body;
  const name = body.name?.trim();
  if (!name) return fail(400, "name_required", "Key needs a name (use the app's name).");
  const role = body.role ?? "client";
  if (role !== "client" && role !== "admin") return fail(400, "bad_role", "role must be client or admin.");
  return ok(createKey(name, role), 201);
}
