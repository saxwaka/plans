"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { issueSession, passwordMatches, sessionCookieName, uiPassword } from "@/lib/gateway/session";

export async function actionLogin(formData: FormData) {
  const expected = uiPassword();
  if (!expected) redirect("/");

  const given = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  if (!passwordMatches(given, expected)) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const jar = await cookies();
  jar.set(sessionCookieName, await issueSession(expected), {
    httpOnly: true,
    sameSite: "lax",
    // Behind Caddy/Cloudflare the app sees plain HTTP; trust the proxy to have
    // terminated TLS and mark the cookie secure only when told we are public.
    secure: process.env.GATEWAY_PUBLIC === "1",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  // Only allow same-site relative targets, never an absolute URL from the query string.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function actionLogout() {
  const jar = await cookies();
  jar.delete(sessionCookieName);
  redirect("/login");
}
