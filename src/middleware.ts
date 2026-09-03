import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName, uiPassword, verifySession } from "@/lib/gateway/session";

/**
 * Two jobs, split by path.
 *
 *  /v1/*  — CORS. Keys authenticate these; the middleware only adds headers.
 *  UI     — session guard. Pages and their server actions can create keys,
 *           delete pools and run a verify sweep that spends money, so once
 *           GATEWAY_UI_PASSWORD is set nothing under the dashboard is served
 *           without a valid cookie. /docs, /openapi.yaml and /llms.txt stay
 *           public: they exist for integrators. /api/* has its own admin-key
 *           guard and is left alone here.
 */
const allowed = (process.env.GATEWAY_CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  if (allowed.length === 0) return {};
  const allowOrigin = allowed.includes("*") ? "*" : origin && allowed.includes(origin) ? origin : "";
  if (!allowOrigin) return {};
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key, anthropic-version, anthropic-beta",
    "Access-Control-Expose-Headers": "X-Gateway-Attempts, X-Gateway-Listing, X-Gateway-Pool",
    "Access-Control-Max-Age": "86400",
    ...(allowOrigin !== "*" ? { Vary: "Origin" } : {}),
  };
}

const PUBLIC = [/^\/v1(\/|$)/, /^\/api(\/|$)/, /^\/docs(\/|$)/, /^\/openapi\.yaml$/, /^\/llms\.txt$/, /^\/login(\/|$)/, /^\/_next\//, /^\/favicon/];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/v1")) {
    const headers = corsHeaders(request.headers.get("origin"));
    if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
    const response = NextResponse.next();
    for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
    return response;
  }

  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();

  const password = uiPassword();
  if (!password) return NextResponse.next();

  const ok = await verifySession(request.cookies.get(sessionCookieName)?.value, password);
  if (ok) return NextResponse.next();

  // Server actions arrive as POST to the page URL; a redirect would confuse
  // them, so they get a plain 401 while browsers get sent to the login page.
  if (request.method !== "GET") return new NextResponse("Unauthorized", { status: 401 });
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
