import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-static";

/** Serves the API reference as Markdown so an agent can fetch it directly. */
export function GET(): Response {
  const body = readFileSync(join(process.cwd(), "docs/API.md"), "utf8");
  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
