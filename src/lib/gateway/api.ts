import { authenticate, type ClientKey } from "./auth";

/** Shared plumbing for the management API so every route answers the same way. */

export const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const fail = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Admin key, or the error to send. Three outcomes are kept distinct so a
 * caller can tell them apart: no key at all, a key nobody issued, and a real
 * key that simply is not an admin.
 */
export function guard(request: Request): ClientKey | Response {
  const header =
    request.headers.get("authorization") ??
    (request.headers.get("x-api-key") ? `Bearer ${request.headers.get("x-api-key")}` : null);
  if (!header) return fail(401, "missing_key", "Send Authorization: Bearer <admin key>.");
  const key = authenticate(header);
  if (!key) return fail(401, "invalid_key", "Unknown or revoked key.");
  if (key.role !== "admin") {
    return fail(403, "admin_required", "This endpoint needs a key with role=admin. Create one with: npm run key:create <name> -- --admin");
  }
  return key;
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | Response> {
  try {
    return (await request.json()) as T;
  } catch {
    return fail(400, "invalid_json", "Request body is not valid JSON.");
  }
}

export const isResponse = (v: unknown): v is Response => v instanceof Response;
