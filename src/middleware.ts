import { NextResponse, type NextRequest } from "next/server";

/**
 * CORS for the API surface, so a browser-based app on another origin can call
 * the gateway directly. Server-side callers never needed this.
 *
 * Default is any origin. That is defensible for a gateway on localhost behind
 * its own keys, but note what browser access means: the gateway key ships to
 * every visitor of that page. Tighten GATEWAY_CORS_ORIGINS before exposing
 * the gateway beyond your own machine.
 */
const allowed = (process.env.GATEWAY_CORS_ORIGINS ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = allowed.includes("*") ? "*" : origin && allowed.includes(origin) ? origin : "";
  if (!allowOrigin) return {};
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key, anthropic-version",
    "Access-Control-Expose-Headers": "X-Gateway-Attempts, X-Gateway-Listing, X-Gateway-Pool",
    "Access-Control-Max-Age": "86400",
    ...(allowOrigin !== "*" ? { Vary: "Origin" } : {}),
  };
}

export function middleware(request: NextRequest) {
  const headers = corsHeaders(request.headers.get("origin"));

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}

export const config = { matcher: "/v1/:path*" };
