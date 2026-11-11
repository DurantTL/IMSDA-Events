import "server-only";

import { getPrisma } from "@/lib/prisma";
import { isClubPerson } from "@/modules/system-admin/people-directory";
import { findExistingPerson } from "@/modules/system-admin/people-invite";

/** The longest email the lookup reads (the usual address limit). */
export const INVITE_LOOKUP_EMAIL_MAX = 254;

/** Trims, lowercases and caps a typed email; empty when nothing usable was typed. */
export function normalizeLookupEmail(value: unknown): string {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" ? text.trim().toLowerCase().slice(0, INVITE_LOOKUP_EMAIL_MAX) : "";
}

/**
 * The person an email belongs to, for giving a first club role (#1804). A system administrator is matched like Invite a
 * person: a website account with that email, or the account linked to a staff login with that email. A Clubs Administrator
 * is matched on the website account's own email only.
 * - `full` (a system administrator): the person's ids, to open their normal page.
 * - `clubs` (a Clubs Administrator): a club person is returned with `clubPerson: true` (their page opens). Anyone else
 *   is returned only if they have a website account, and then only that account's id, name and email. A staff login
 *   with no website account is not returned at all, and no staff detail is ever returned.
 */
export type InviteLookupPerson =
  | { scope: "full"; staffId: string | null; accountId: string | null }
  | { scope: "clubs"; clubPerson: true; accountId: string }
  | { scope: "clubs"; clubPerson: false; accountId: string; displayName: string; accountEmail: string };

export async function findInviteLookupPerson(email: string, scope: "full" | "clubs", now = new Date()): Promise<InviteLookupPerson | null> {
  const normalized = normalizeLookupEmail(email);
  if (!normalized) return null;
  if (scope === "full") {
    const existing = await findExistingPerson(normalized);
    return existing.staffId || existing.accountId ? { scope: "full", staffId: existing.staffId, accountId: existing.accountId } : null;
  }
  // A Clubs Administrator is matched on the website account's own email only, never through a staff login's email.
  const own = await getPrisma().attendeeAccount.findUnique({ where: { email: normalized }, select: { id: true, linkedUser: { select: { id: true } } } });
  if (!own) return null;
  const existing = { staffId: own.linkedUser?.id ?? null, accountId: own.id };
  if (await isClubPerson(existing, now)) return { scope: "clubs", clubPerson: true, accountId: existing.accountId };
  const account = await getPrisma().attendeeAccount.findUnique({ where: { id: existing.accountId }, select: { id: true, displayName: true, email: true } });
  return account ? { scope: "clubs", clubPerson: false, accountId: account.id, displayName: account.displayName, accountEmail: account.email } : null;
}
