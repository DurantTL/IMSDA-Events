import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { DEBRIEF_MODULE_KEY, isDebriefFormPurpose } from "@/modules/event-debriefs/domain";
import { isDebriefRecipient } from "@/modules/event-debriefs/recipients";

type Client = PrismaClient | Prisma.TransactionClient;

export type DebriefFormAccess =
  /** Not a debrief form: this check has nothing to say about it. */
  | { kind: "NOT_DEBRIEF" }
  | { kind: "ALLOWED"; eventId: string }
  | { kind: "DENIED"; reason: "MODULE_OFF" | "EVALUATION_OFF" | "NOT_A_RECIPIENT" | "SIGN_IN_REQUIRED" };

/**
 * May this account answer this form? For an ordinary information form the answer is "not a debrief form" and the caller
 * goes on as before. For the debrief or the director evaluation (#1679) the account must be on that form's audience right
 * now, the Debrief must be switched on, and the evaluation also needs its own switch. This is the server-side check: the fill
 * page asks it to show the right message, and storing an answer asks it again, so nothing depends on the page.
 */
export async function debriefFormAccess(formId: string, accountId: string | null | undefined, now = new Date(), client: Client = getPrisma()): Promise<DebriefFormAccess> {
  const form = await client.informationForm.findUnique({ where: { id: formId }, select: { id: true, eventId: true, purpose: true } });
  if (!form || !form.purpose || !isDebriefFormPurpose(form.purpose) || !form.eventId) return { kind: "NOT_DEBRIEF" };
  if (!accountId) return { kind: "DENIED", reason: "SIGN_IN_REQUIRED" };
  const [moduleRow, settings] = await Promise.all([
    client.eventModule.findUnique({ where: { eventId_moduleKey: { eventId: form.eventId, moduleKey: DEBRIEF_MODULE_KEY } }, select: { id: true } }),
    client.eventDebrief.findUnique({ where: { eventId: form.eventId }, select: { evaluationEnabled: true } }),
  ]);
  if (!moduleRow) return { kind: "DENIED", reason: "MODULE_OFF" };
  if (form.purpose === "DIRECTOR_EVALUATION" && !settings?.evaluationEnabled) return { kind: "DENIED", reason: "EVALUATION_OFF" };
  if (!(await isDebriefRecipient(client, form.eventId, form.purpose, accountId, now))) return { kind: "DENIED", reason: "NOT_A_RECIPIENT" };
  return { kind: "ALLOWED", eventId: form.eventId };
}

/** Has this account already sent an answer to this form? The debrief takes one answer from each person. */
export async function hasAnsweredDebrief(formId: string, accountId: string, client: Client = getPrisma()): Promise<boolean> {
  return (await client.informationFormResponse.count({ where: { formId, attendeeAccountId: accountId } })) > 0;
}
