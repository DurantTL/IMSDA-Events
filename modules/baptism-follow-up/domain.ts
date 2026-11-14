import { z } from "zod";
import { EMAIL_FIELD_MESSAGE, isEmail, isUnchangedEmail } from "@/lib/field-validation";

/**
 * Baptism follow-up (#1680), the pure part: reading names out of a club's baptism answer, the event lead addresses, and the
 * notice's wording. No database and no server-only import, so the settings form, the route and the tests share one set of
 * rules. The notice says who (names), which club, which event and when, and asks for a follow-up. Nothing else about a person
 * is ever passed to it, so there is nowhere for an age, a birth date, a contact detail or a health answer to get in.
 */

export const BAPTISM_FOLLOW_UP_MODULE_KEY = "baptism-follow-up" as const;
export const BAPTISM_FOLLOW_UP_TEMPLATE_KEY = "BAPTISM_FOLLOW_UP" as const;
export const BAPTISM_MAX_LEAD_EMAILS = 3;

const MAX_NAME_LENGTH = 80;
/** Names one notice carries at most; a club cannot flood the lead's inbox with one long answer. */
export const BAPTISM_MAX_NAMES_PER_ANSWER = 25;

// Answers that mean the club named nobody.
const NO_NAMES = /^(no|none|n\/?a|nil|0|-+)\.?$/i;

/** Case and spacing ignored: the key a name is remembered by. */
export function normalizeBaptismName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export type BaptismName = { key: string; displayName: string };

/**
 * The names in a club's baptism answer: split on commas, semicolons and new lines (the split the club reports use), trimmed,
 * with "none" style answers dropped and repeats within the answer collapsed. A name keeps the club's own spelling for
 * display and is remembered by its normalized key.
 */
export function splitBaptismNames(answer: unknown): BaptismName[] {
  if (typeof answer !== "string") return [];
  const seen = new Set<string>();
  const names: BaptismName[] = [];
  for (const piece of answer.split(/[,;\n\r]+/)) {
    const displayName = piece.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH).trim();
    if (!displayName || NO_NAMES.test(displayName)) continue;
    const key = normalizeBaptismName(displayName);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push({ key, displayName });
    if (names.length >= BAPTISM_MAX_NAMES_PER_ANSWER) break;
  }
  return names;
}

/** The names in the answer that were not notified before. Removed names do nothing: only the answer's own names are read. */
export function newBaptismNames(answer: unknown, alreadyNotified: ReadonlySet<string>): BaptismName[] {
  return splitBaptismNames(answer).filter((name) => !alreadyNotified.has(name.key));
}

/** The pastor's address when it can be used: trimmed, lowercased and a valid email, else null. The send path and the page's "pastor on file" share this. */
export function usablePastorEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase() ?? "";
  return value && isEmail(value) ? value : null;
}

export type LeadEmailsResult = { ok: true; emails: string[] } | { ok: false; message: string };

/**
 * One address per line (commas and semicolons also split). Lowercased, de-duplicated, at most three. An address already
 * saved stays valid, so re-saving never fails on an old address nobody touched. The message names a line number, never the address.
 */
export function parseLeadEmails(raw: string | readonly string[], stored: readonly string[] = []): LeadEmailsResult {
  const parts = (typeof raw === "string" ? raw.split(/[\n\r,;]+/) : [...raw]).map((part) => part.trim()).filter(Boolean);
  const emails: string[] = [];
  for (const [index, part] of parts.entries()) {
    const email = part.toLowerCase();
    if (!stored.some((saved) => isUnchangedEmail(email, saved)) && !isEmail(email)) {
      return { ok: false, message: `Address ${index + 1}: ${EMAIL_FIELD_MESSAGE}` };
    }
    if (!emails.includes(email)) emails.push(email);
  }
  if (emails.length > BAPTISM_MAX_LEAD_EMAILS) return { ok: false, message: `Add at most ${BAPTISM_MAX_LEAD_EMAILS} addresses.` };
  return { ok: true, emails };
}

export const leadEmailsInputSchema = z.strictObject({
  leadEmails: z.union([z.string().max(2000), z.array(z.string().max(320)).max(20)]),
});

export type BaptismRecipientRole = "lead" | "pastor";

/** Placeholders in a club or event name are made harmless, as in every other staff email. */
function plain(value: string): string {
  return value.replaceAll("{{", "{ {").replaceAll("}}", "} }");
}

/**
 * The notice. Takes names, a club name, an event name and a date text only. The same wording goes to the lead and to the
 * pastor, apart from the first line.
 */
export function baptismNoticeContent(input: { names: readonly string[]; clubName: string; eventName: string; dates: string; role: BaptismRecipientRole }) {
  const names = input.names.map(plain);
  const club = plain(input.clubName);
  const event = plain(input.eventName);
  const intro = input.role === "pastor"
    ? `${club}, a club your church sponsors, has asked about baptism at ${event}.`
    : `${club} has asked about baptism at ${event}.`;
  return {
    subject: `Baptism follow-up: ${club}, ${event}`,
    bodyText: [
      intro,
      "",
      names.length === 1 ? `Name: ${names[0]}` : "Names:",
      ...(names.length === 1 ? [] : names.map((name) => `- ${name}`)),
      `Club: ${club}`,
      `Event: ${event}`,
      `Date: ${plain(input.dates)}`,
      "",
      "Please follow up with the family.",
      "",
      "IMAdventist",
    ].join("\n"),
  };
}

/** The longest note staff keep with a name. */
export const BAPTISM_NOTE_MAX_LENGTH = 500;
export const BAPTISM_NOTE_TOO_LONG_MESSAGE = `Keep the note to ${BAPTISM_NOTE_MAX_LENGTH} characters or fewer.`;

export type FollowUpNoteResult = { ok: true; note: string | null } | { ok: false; message: string };

/** The note as kept: trimmed, empty means no note, and at most 500 characters (counted after trimming). The message never repeats the note. */
export function parseFollowUpNote(raw: string): FollowUpNoteResult {
  const note = raw.trim();
  if (note.length > BAPTISM_NOTE_MAX_LENGTH) return { ok: false, message: BAPTISM_NOTE_TOO_LONG_MESSAGE };
  return { ok: true, note: note === "" ? null : note };
}

/**
 * One name's followed-up status and note. Each part is optional, at least one must be sent. The note's length is judged by
 * `parseFollowUpNote` (so the message is friendly); the schema's own cap only refuses an absurd request body.
 */
export const followUpInputSchema = z.strictObject({
  followedUp: z.boolean().optional(),
  note: z.string().max(5000).optional(),
  /** What the form loaded or last saved: when it was followed up (ISO) or null, and the note. The save applies only if these still match. */
  expectedFollowedUpAt: z.string().datetime().nullable(),
  expectedNote: z.string().max(5000).nullable(),
}).refine((input) => input.followedUp !== undefined || input.note !== undefined, { message: "Choose what to change." });

export type FollowUpInput = z.infer<typeof followUpInputSchema>;

export const FOLLOW_UP_CHANGED_MESSAGE = "This name was changed by someone else since you opened the page. Reload to see it.";

export const baptismSwitchInputSchema = z.strictObject({ enabled: z.boolean() });
