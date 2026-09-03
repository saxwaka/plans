/**
 * Strips a listing id down to the model underneath it.
 *
 * The platforms name the same model three ways: "claude-opus-4-8" on Vilao,
 * "claude-opus-4.8" on CKey, and "dungcsnd113/claude-opus-5" once a seller
 * prefix is attached. Upstreams also answer with the bare name — CKey returns
 * "claude-opus-5" for "dungcsnd113/claude-opus-5" — so raw string equality
 * would report a model swap on every single request.
 *
 * M3 grows this into the pool mapping table; for now it only has to make the
 * mismatch warning mean something.
 */
export function baseModelName(id: string): string {
  return id
    .slice(id.lastIndexOf("/") + 1)
    .toLowerCase()
    .replace(/[._]/g, "-");
}

/** True when the served model is genuinely not the one that was asked for. */
export function isModelMismatch(requested: string, actual: string | null): boolean {
  if (!actual) return false;
  return baseModelName(requested) !== baseModelName(actual);
}
