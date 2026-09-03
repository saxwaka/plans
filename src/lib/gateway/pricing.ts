import type { Listing } from "./catalog";

/**
 * What a call costs in VND, from the listing's published prices.
 *
 * Both platforms bill max(floor, per_request + tokens/1e6 × price) — proven in
 * docs/api-notes.md by matching a 4₫ charge to its input/output split exactly.
 * The floor matters more than it looks: a short call is priced by the floor,
 * not by its tokens.
 *
 * Used to give the caller a cost figure at response time. CKey already reports
 * one inline; Vilao reports 0, so for Vilao this estimate stands in until the
 * management API confirms the real figure a few seconds later.
 */
export function costFor(
  listing: Pick<Listing, "price_in" | "price_out" | "price_request" | "price_floor">,
  tokensIn: number | undefined,
  tokensOut: number | undefined,
): number | null {
  const hasAnyPrice =
    listing.price_in !== null ||
    listing.price_out !== null ||
    listing.price_request !== null ||
    listing.price_floor !== null;
  if (!hasAnyPrice) return null;

  const tokenCost =
    ((listing.price_in ?? 0) * (tokensIn ?? 0) + (listing.price_out ?? 0) * (tokensOut ?? 0)) / 1_000_000;
  return Math.max(listing.price_floor ?? 0, (listing.price_request ?? 0) + tokenCost);
}
