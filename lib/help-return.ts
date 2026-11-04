import { safeReturnTo } from "@/lib/return-to";

/**
 * Where Help's Back goes (#1553): the club page the director came from. Only an internal club portal path is accepted
 * (`/account/clubs` or `/account/clubs/<id>/...`, with an optional plain query), on top of `safeReturnTo`'s checks for
 * absolute URLs, `//`, backslashes, control characters, API routes and encoded tricks. Anything else returns null.
 */
const CLUB_PAGE = /^\/account\/clubs(?:\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+){0,6})?\/?(?:\?[A-Za-z0-9_=&%.,:+-]*)?$/;
const MAX_LENGTH = 300;

export function clubHelpReturnPath(value: string | string[] | null | undefined): string | null {
  if (typeof value !== "string" || value.length > MAX_LENGTH) return null;
  if (safeReturnTo(value, "") === "") return null;
  return CLUB_PAGE.test(value) ? value : null;
}

/** The session-storage key the club page tracker writes and Help's Back link reads. */
export const HELP_RETURN_STORAGE_KEY = "imsda-help-return";

/** `href` with `?from=<club page>` added, for a Help link opened from that page; unchanged when the page is not a club page. */
export function helpHrefFrom(href: string, from: string | null | undefined): string {
  const safe = clubHelpReturnPath(from);
  if (!safe) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(safe)}`;
}
