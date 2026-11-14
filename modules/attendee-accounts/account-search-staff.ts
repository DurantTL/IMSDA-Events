import "server-only";

import { getPrisma } from "@/lib/prisma";
import { auditCrossEventIdentityRead } from "@/modules/people/identity-read-audit";
import type { ValueKeptField } from "@/modules/attendee-accounts/profile-conflicts";

/**
 * System administrator search for an attendee account that is not on the Profile updates list (#1512, slice 3), so a
 * correction can be started for someone who phones in. The caller has already passed the system administrator gate
 * (`requireSystemAdministrator`); nothing here decides who may call.
 *
 * A result carries only what is needed to pick the account: id, display name, email and a "Disabled" or "Not verified" note. Address, emergency contact,
 * health answers and person or merge data are never selected. Every search is written to the cross-event identity read
 * audit before results are returned (ids and the query length only, never the query, a name or an email), and so is
 * every account that is opened.
 */

export const ACCOUNT_SEARCH_MIN_LENGTH = 3;
export const ACCOUNT_SEARCH_MAX_LENGTH = 100;
export const ACCOUNT_SEARCH_RESULT_LIMIT = 20;

/** A small plain-words note for an account that cannot sign in normally; null for a verified, enabled one. */
export type AccountSearchResult = { accountId: string; displayName: string; email: string; note: string | null };

export type OpenedAccount = {
  accountId: string;
  accountName: string;
  current: Record<ValueKeptField, string>;
};

export class AccountSearchError extends Error {
  constructor(readonly code: "QUERY_TOO_SHORT" | "NOT_FOUND", message: string) {
    super(message);
    this.name = "AccountSearchError";
  }
}

/** The query as it is searched: trimmed, inner whitespace collapsed, capped. */
export function normalizeAccountSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, ACCOUNT_SEARCH_MAX_LENGTH);
}

export async function searchAccountsForStaff(actorUserId: string, rawQuery: string) {
  const query = normalizeAccountSearchQuery(rawQuery);
  if (query.length < ACCOUNT_SEARCH_MIN_LENGTH) {
    throw new AccountSearchError("QUERY_TOO_SHORT", `Type at least ${ACCOUNT_SEARCH_MIN_LENGTH} characters of a name or email.`);
  }
  const contains = { contains: query, mode: "insensitive" as const };
  const rows = await getPrisma().attendeeAccount.findMany({
    where: { OR: [{ displayName: contains }, { firstName: contains }, { lastName: contains }, { email: contains }] },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    take: ACCOUNT_SEARCH_RESULT_LIMIT,
    select: { id: true, displayName: true, email: true, status: true, disabledAt: true },
  });
  // Written before the results are handed back; a failure to write it fails the search.
  await auditCrossEventIdentityRead({
    actorUserId,
    surface: "ATTENDEE_ACCOUNT_SEARCH",
    resultIds: rows.map((row) => row.id),
    extra: { queryLength: query.length },
  });
  const results: AccountSearchResult[] = rows.map((row) => ({
    accountId: row.id,
    displayName: row.displayName,
    email: row.email,
    note: row.disabledAt ? "Disabled" : row.status === "PENDING_VERIFICATION" ? "Not verified" : null,
  }));
  return { results, limit: ACCOUNT_SEARCH_RESULT_LIMIT };
}

/** One account's current name, phone and shirt size, audited before they are returned. */
export async function openAccountForStaff(actorUserId: string, accountId: string): Promise<OpenedAccount> {
  const row = await getPrisma().attendeeAccount.findUnique({
    where: { id: accountId },
    select: { displayName: true, firstName: true, lastName: true, phone: true, shirtSize: true },
  });
  if (!row) throw new AccountSearchError("NOT_FOUND", "That account was not found.");
  await auditCrossEventIdentityRead({
    actorUserId,
    surface: "ATTENDEE_ACCOUNT_OPENED",
    entityId: accountId,
    resultIds: [accountId],
  });
  return {
    accountId,
    accountName: row.displayName,
    current: {
      firstName: row.firstName ?? "",
      lastName: row.lastName ?? "",
      phone: row.phone ?? "",
      shirtSize: row.shirtSize ?? "",
    },
  };
}
