import { AccessDeniedError } from "@/modules/access/authorization";
import { AccountSearchError, openAccountForStaff } from "@/modules/attendee-accounts/account-search-staff";
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
 * Opens one account found by search (#1512): its current name, phone and shirt size, so the existing correction can be
 * shown for it. The read is written to the cross-event identity read audit before the values are returned.
 */
async function getHandler(_request: Request, context: { params: Promise<{ accountId: string }> }) {
  try {
    const actor = await requireSystemAdministrator();
    const accountId = (await context.params).accountId.trim();
    if (!accountId || accountId.length > 100) {
      return json({ error: "INVALID_REQUEST", message: "Name the account to open." }, { status: 400 });
    }
    return json(await openAccountForStaff(actor.id, accountId));
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return json({ error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof AccountSearchError) {
      return json({ error: error.code, message: error.message }, { status: 404 });
    }
    logError("Opening an attendee account for a correction failed", error);
    return json({ error: "REQUEST_FAILED", message: "The request could not be completed." }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
