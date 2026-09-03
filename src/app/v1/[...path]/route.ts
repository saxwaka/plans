import { handleV1 } from "@/lib/gateway/handler";
import { openAiErrorBody } from "@/lib/gateway/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every other /v1 endpoint the upstreams offer — embeddings, completions,
 * responses, moderations, rerank — goes through the same pipeline: pool
 * routing, fallback, cost logging. Probed on both platforms, so nothing here
 * is assumed; explicit routes above (chat/completions, messages, models)
 * take precedence over this catch-all.
 */
const KNOWN = new Set(["embeddings", "completions", "responses", "moderations", "rerank"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const joined = path.join("/");
  const endpoint = path[path.length - 1] ?? joined;

  if (!KNOWN.has(endpoint)) {
    return new Response(
      JSON.stringify(
        openAiErrorBody("unknown_endpoint", `/v1/${joined} is not served by this gateway.`, "invalid_request_error"),
      ),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return handleV1(request, { path: `/${joined}`, endpoint });
}
