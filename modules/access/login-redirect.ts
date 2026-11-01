import "server-only";

import { headers } from "next/headers";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { NO_STAFF_ACCESS_PATH, REQUEST_TARGET_HEADER, staffLoginPathFor } from "@/modules/access/login-routing";

/**
 * Where a signed-out staff request should go: `/login?next=<the page they
 * asked for>` when `proxy.ts` recorded the request path, otherwise plain
 * `/login`. Outside a request scope (or when the header is missing or
 * unsafe) it degrades to `/login`.
 *
 * Someone who is signed in as an attendee or club leader (their own cookie, never the staff one) is not signed out:
 * sending them to "Staff sign in" read as if the site had forgotten them (rule 14). They go to /no-access, which says
 * the page is for event staff and who to ask. /no-access shows that to an attendee without redirecting back here, so
 * there is no sign-in loop. A staff account acting as its own attendee side does not count: that is a staff session.
 */
export async function staffLoginRedirectPath(): Promise<string> {
  try {
    const attendee = await getCurrentAttendee();
    if (attendee.account && attendee.via === "attendee") return NO_STAFF_ACCESS_PATH;
  } catch {
    // No attendee lookup (outside a request, or the database is unreachable): fall through to sign in.
  }
  try {
    const requestHeaders = await headers();
    return staffLoginPathFor(requestHeaders.get(REQUEST_TARGET_HEADER));
  } catch {
    return staffLoginPathFor(null);
  }
}
