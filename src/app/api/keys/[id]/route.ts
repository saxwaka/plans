import { fail, guard, isResponse, ok } from "@/lib/gateway/api";
import { revokeKey } from "@/lib/gateway/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/keys/:id — revoke. A key cannot revoke itself by accident: the call still needs a valid admin key. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const g = guard(request);
  if (isResponse(g)) return g;
  const { id } = await ctx.params;
  if (id === g.id) return fail(400, "self_revoke", "Refusing to revoke the key making this request.");
  return revokeKey(id) ? ok({ revoked: id }) : fail(404, "not_found", `No key ${id}.`);
}
