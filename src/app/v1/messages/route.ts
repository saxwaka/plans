import { handleV1 } from "@/lib/gateway/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anthropic Messages protocol. Both platforms serve it natively on this path,
 * so this is a forward with pool routing, not a translation.
 *
 * Note for clients: ANTHROPIC_BASE_URL wants the root origin, not /v1.
 */
export const POST = (request: Request) =>
  handleV1(request, {
    path: "/messages",
    endpoint: "messages",
    protocol: "anthropic",
    forward: ["anthropic-version", "anthropic-beta"],
  });
