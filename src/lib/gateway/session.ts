/**
 * UI sessions, signed with Web Crypto so the same code runs in the edge
 * middleware (which cannot open SQLite) and in Node server actions.
 *
 * One environment variable flips the whole thing: GATEWAY_UI_PASSWORD. Unset,
 * the dashboard is open — fine on localhost, which is where this started.
 * Set, every page and every server action requires a session cookie obtained
 * by entering that password at /login. The signing key is derived from the
 * password, so there is no second secret to manage.
 */
const COOKIE = "gw_session";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const sessionCookieName = COOKIE;

export function uiPassword(): string | undefined {
  const p = process.env.GATEWAY_UI_PASSWORD?.trim();
  return p ? p : undefined;
}

async function key(password: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gw-session:${password}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const b64 = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function issueSession(password: string): Promise<string> {
  const exp = String(Date.now() + TTL_MS);
  const sig = await crypto.subtle.sign("HMAC", await key(password), new TextEncoder().encode(exp));
  return `${exp}.${b64(sig)}`;
}

export async function verifySession(token: string | undefined, password: string): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;

  const expected = b64(await crypto.subtle.sign("HMAC", await key(password), new TextEncoder().encode(exp)));
  // Constant-time compare; lengths are equal for well-formed tokens.
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/** Constant-time password check for the login form. */
export function passwordMatches(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
