import { z } from "zod";
import { clubFormProblem, lockedClubDirectoryFieldKeys } from "@/modules/club-registrations/domain";
import { DIRECTORY_NOT_LISTED_VALUE, type RegistrationFormDefinition } from "@/modules/forms/definition";

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
  return definition.sections.flatMap((section) => section.fields).find((field) => (
    field.conditional?.fieldKey === clubKey
    && field.conditional.operator === "EQUALS"
    && field.conditional.value === DIRECTORY_NOT_LISTED_VALUE
  ))?.key ?? null;
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

export const GENERAL_LINK_PENDING_MESSAGE =
  "We have your team's registration, and it is saved. We could not match your email to a director or deputy of the club you chose, so the event team will confirm which club it belongs to. You will get an email when it is attached to your club. There is no fee.";

export const GENERAL_LINK_ATTACHED_MESSAGE = (clubName: string) =>
  `Your team's registration has been received and attached to ${clubName}. There is no fee.`;

export function pendingDirectorEmail(input: { eventName: string; teamName: string; confirmationCode: string }) {
  return {
    subject: `We have your team registration for ${input.eventName}`,
    bodyText: [
      `Thank you. We received the registration for the team "${input.teamName}" for ${input.eventName}.`,
      "",
      "We could not match this email to a current director or deputy of the club you chose, so the event team will confirm which club the team belongs to. Nothing more is needed from you. You will get another email when the team is attached to its club.",
      "",
      `Reference: ${input.confirmationCode}`,
    ].join("\n"),
  };
}

export function attachedDirectorEmail(input: { eventName: string; teamName: string; clubName: string; confirmationCode: string }) {
  return {
    subject: `Your team is attached to ${input.clubName}`,
    bodyText: [
      `The team "${input.teamName}" for ${input.eventName} is attached to ${input.clubName}.`,
      "",
      "When the club's director or deputy signs in to the club portal, the team appears under the club's registrations and can be viewed or changed there.",
      "",
      `Reference: ${input.confirmationCode}`,
    ].join("\n"),
  };
}

export function rejectedDirectorEmail(input: { eventName: string; teamName: string; confirmationCode: string; reason: string }) {
  return {
    subject: `Your team registration for ${input.eventName} was not accepted`,
    bodyText: [
      `The registration for the team "${input.teamName}" for ${input.eventName} was not accepted by the event team.`,
      "",
      `Reason: ${input.reason}`,
      "",
      "If this looks wrong, reply to this email or contact the event team.",
      "",
      `Reference: ${input.confirmationCode}`,
    ].join("\n"),
  };
}

export function staffPendingNotice(input: { eventName: string; clubNameAsEntered: string; reviewUrl: string }) {
  return {
    subject: `A team is waiting for club confirmation: ${input.eventName}`,
    bodyText: [
      `A team registered through the general registration link for ${input.eventName} could not be matched to a club automatically.`,
      "",
      `The club named: ${input.clubNameAsEntered || "not listed"}`,
      "",
      `Confirm or change the club: ${input.reviewUrl}`,
    ].join("\n"),
  };
}

export const GENERAL_LINK_STATUS_LABEL = {
  PENDING: "Waiting for staff",
  CONFIRMED: "Attached to a club",
  REJECTED: "Rejected",
} as const;
