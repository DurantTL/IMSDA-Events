import { z } from "zod";
import { REGISTRATION_MANAGE_API_SENTINEL, REGISTRATION_MANAGE_LINK_SENTINEL } from "@/modules/communications/manage-link";
import { clubFormProblem, lockedClubDirectoryFieldKeys } from "@/modules/club-registrations/domain";
import { DIRECTORY_NOT_LISTED_VALUE, notListedCompanionKey, type RegistrationFormDefinition } from "@/modules/forms/definition";

/**
 * The general registration link (#931): one public link per club event where a club director with no account registers a
 * team (the Pathfinder Bible Experience). The director picks the club on the form, and that pick is the match:
 *
 * - the submitted director email belongs to a current director or deputy of that club: the team becomes an ordinary club
 *   registration for it at once;
 * - anything else (another email, or "Not listed"): the team waits as a pending submission (`GeneralLinkSubmission`) until
 *   staff confirm the club or choose the right one.
 *
 * Pure rules, shared by the server, the public page and the tests.
 */

/** The public path of an event's general registration link. Beside `/register/<event>/group`, ahead of the `[formSlug]` route. */
export function generalLinkPath(eventSlug: string) {
  return `/register/${encodeURIComponent(eventSlug)}/general`;
}

/** The link as staff copy it: the app's address and the path. */
export function generalLinkUrl(baseUrl: string, eventSlug: string) {
  return `${baseUrl.replace(/\/+$/, "")}${generalLinkPath(eventSlug)}`;
}

/** The label staff and directors see for the link's registrants. */
export const GENERAL_LINK_LABEL = "Register without an account";

/** The rate-limit form key, apart from the event's ordinary form and the group link. */
export const GENERAL_LINK_RATE_LIMIT_FORM = "general";

/** The most a "reason" for a rejection may hold. */
export const REJECT_REASON_MAX = 500;

/**
 * A director email as it is compared: trimmed and lowercase (Unicode-normalized), the form `AttendeeAccount.email` and
 * `Person.normalizedEmail` are kept in. Comparison is exact on this form, never a "contains" or a domain match.
 */
export function normalizeDirectorEmail(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

/** What the browser sends beside the form answers. */
export const generalLinkExtrasSchema = z.object({
  locationId: z.string().trim().min(1).max(100).nullish(),
  teamName: z.string().max(200).nullish(),
});

export type GeneralLinkExtras = z.infer<typeof generalLinkExtrasSchema>;

/** The registration-scope club directory field, whatever its key. The first one is the club the director picks. */
export function generalLinkClubFieldKey(definition: RegistrationFormDefinition): string | null {
  return lockedClubDirectoryFieldKeys(definition)[0] ?? null;
}

/** The "Not listed" companion text field of the club field, when the form has one. */
export function generalLinkClubOtherKey(definition: RegistrationFormDefinition, clubKey: string): string | null {
  return notListedCompanionKey(definition.sections.flatMap((section) => section.fields), clubKey);
}

/** The line under the club menu on the public general link form (#1031). */
export const GENERAL_LINK_NOT_LISTED_HELP = "Club not listed? Choose 'Not listed' and type your club's name. We'll add it.";

/**
 * The form as the general link shows it: the club question carries the "Not listed" line, unless the form words its own or has no
 * "Not listed" name field to type into (then the line would promise something the form cannot take).
 */
export function generalLinkDisplayDefinition<T extends RegistrationFormDefinition>(definition: T): T {
  const clubKey = generalLinkClubFieldKey(definition);
  if (!clubKey || generalLinkClubOtherKey(definition, clubKey) === null) return definition;
  return {
    ...definition,
    sections: definition.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => (field.key === clubKey && !field.helpText ? { ...field, helpText: GENERAL_LINK_NOT_LISTED_HELP } : field)),
    })),
  };
}

/** Why a form can't be used through the general link, or null. */
export function generalLinkFormProblem(definition: RegistrationFormDefinition): string | null {
  const base = clubFormProblem(definition);
  if (base) return base;
  if (generalLinkClubFieldKey(definition) === null) {
    return "The event's form has no club question that picks from the directory, so a team can't be matched to its club.";
  }
  return null;
}

/** The club answer on a submission: the directory club's name, or "Not listed" and what was typed. */
export function generalLinkClubAnswer(definition: RegistrationFormDefinition, responses: Readonly<Record<string, unknown>>) {
  const clubKey = generalLinkClubFieldKey(definition);
  const picked = clubKey && typeof responses[clubKey] === "string" ? (responses[clubKey] as string).trim() : "";
  const notListed = picked === DIRECTORY_NOT_LISTED_VALUE;
  const otherKey = clubKey ? generalLinkClubOtherKey(definition, clubKey) : null;
  const typed = otherKey && typeof responses[otherKey] === "string" ? (responses[otherKey] as string).trim() : "";
  return {
    /** The directory club's name when one was picked, else null. */
    directoryName: picked && !notListed ? picked : null,
    notListed,
    /** What staff see as the club the director meant. */
    asEntered: (notListed ? typed : picked).slice(0, 200),
  };
}

/** A confirmation code for a team that waits for staff. Distinct from a registration's `REG-` code. */
export function pendingConfirmationCode(randomHex: string) {
  return `PBE-${randomHex.slice(0, 10).toUpperCase()}`;
}

// ---------------------------------------------------------------------------------------------
// Words the director and staff read
// ---------------------------------------------------------------------------------------------

/**
 * What the public page says after any accepted submission, whatever the team's club or email. It is the same words, reference
 * format, price and fields for a team attached at once and one waiting for staff, so the answer never tells a visitor whether an
 * email is a club's director. The details go to the email address that was typed.
 */
export const GENERAL_LINK_RECEIVED_MESSAGE =
  "We have your team's registration, and it is saved. Check the email address you entered for the details; the event team confirms which club it belongs to when that is needed. There is no fee.";

export const GENERAL_LINK_TOO_MANY_MESSAGE = "Too many registrations right now; please try again later.";

/** Most waiting teams one event takes in a rolling hour, from anyone: a cap on what a flood can queue for staff. */
export const PENDING_SUBMISSIONS_PER_HOUR = 60;

/** Staff are told about waiting teams in one digest per event per window, never one email per team. */
export const STAFF_DIGEST_WINDOW_MS = 15 * 60 * 1000;

/** A waiting team's answers are kept until this many days after the event ends, then removed (the submission is marked EXPIRED). */
export const PENDING_RETENTION_DAYS = 30;

/** The team name as it appears in an email to whoever submitted: cut at 60 characters, with nothing else they typed. */
export const EMAIL_TEAM_NAME_MAX = 60;

export function teamNameForEmail(name: string) {
  const trimmed = [REGISTRATION_MANAGE_LINK_SENTINEL, REGISTRATION_MANAGE_API_SENTINEL]
    .reduce((text, sentinel) => text.replaceAll(sentinel, ""), name)
    .replace(/\s+/g, " ")
    .trim();
  return trimmed.length > EMAIL_TEAM_NAME_MAX ? `${trimmed.slice(0, EMAIL_TEAM_NAME_MAX - 1).trimEnd()}\u2026` : trimmed;
}

/** The fixed 15-minute window a moment falls in, for the staff digest's one-per-window key. */
export function staffDigestWindow(now: Date) {
  return Math.floor(now.getTime() / STAFF_DIGEST_WINDOW_MS);
}

/** The day after which a still-waiting team's answers are removed: 30 days after the event's end. */
export function pendingRetentionCutoff(now: Date) {
  return new Date(now.getTime() - PENDING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export function pendingDirectorEmail(input: { eventName: string; teamName: string; confirmationCode: string }) {
  return {
    subject: `We have your team registration for ${input.eventName}`,
    bodyText: [
      `Thank you. We received the registration for the team "${teamNameForEmail(input.teamName)}" for ${input.eventName}.`,
      "",
      "The event team will confirm which club the team belongs to. Nothing more is needed from you. You will get another email when the team is attached to its club.",
      "",
      `Reference: ${input.confirmationCode}`,
    ].join("\n"),
  };
}

/** The line at the top of the director's one email (#931): attached to the club, or, when there was no room, on the waitlist. */
export function matchedConfirmationNote(input: { teamName: string; clubName: string; confirmationCode: string; waitlisted?: boolean }) {
  const team = teamNameForEmail(input.teamName);
  return input.waitlisted
    ? `Your team "${team}" was matched to ${input.clubName}, but there is no room right now, so it is on the waitlist. It is not a confirmed registration yet. Reference: ${input.confirmationCode}.`
    : `Your team "${team}" is attached to ${input.clubName}. Reference: ${input.confirmationCode}.`;
}

export function rejectedDirectorEmail(input: { eventName: string; teamName: string; confirmationCode: string; reason: string }) {
  return {
    subject: `Your team registration for ${input.eventName} was not accepted`,
    bodyText: [
      `The registration for the team "${teamNameForEmail(input.teamName)}" for ${input.eventName} was not accepted by the event team.`,
      "",
      `Reason: ${input.reason}`,
      "",
      "If this looks wrong, reply to this email or contact the event team.",
      "",
      `Reference: ${input.confirmationCode}`,
    ].join("\n"),
  };
}

/** One digest for all the teams waiting in an event: the count and the review link, nothing a submitter typed. */
export function staffPendingDigestNotice(input: { eventName: string; waitingCount: number; reviewUrl: string }) {
  return {
    subject: `Teams waiting for club confirmation: ${input.eventName}`,
    bodyText: [
      `${input.waitingCount} ${input.waitingCount === 1 ? "team is" : "teams are"} waiting for club confirmation for ${input.eventName} (registered through the general registration link).`,
      "",
      `Confirm or change the club: ${input.reviewUrl}`,
      "",
      "You get at most one of these emails every 15 minutes for the event.",
    ].join("\n"),
  };
}

export const GENERAL_LINK_STATUS_LABEL = {
  PENDING: "Pending approval",
  CONFIRMED: "Attached to a club",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
} as const;
