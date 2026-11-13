import { AccessDeniedError } from "@/modules/access/authorization";
import { AccountSearchError, searchAccountsForStaff } from "@/modules/attendee-accounts/account-search-staff";
import { requireSystemAdministrator } from "@/modules/people/duplicate-match-access";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, { ...init, headers: { ...privateHeaders, ...init?.headers } });
}

/**
 * Account search for a system administrator who needs a correction for an account that is not on the Profile updates
 * list (#1512). `?q=` is a name or email of at least three characters. Results are id, display name and email only, and
 * the search is written to the cross-event identity read audit before they are returned.
 */
async function getHandler(request: Request) {
  try {
    const actor = await requireSystemAdministrator();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return json(await searchAccountsForStaff(actor.id, query));
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return json({ error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof AccountSearchError) {
      return json({ error: error.code, message: error.message }, { status: 400 });
    }
    logError("Searching attendee accounts for a correction failed", error);
    return json({ error: "REQUEST_FAILED", message: "The request could not be completed." }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
