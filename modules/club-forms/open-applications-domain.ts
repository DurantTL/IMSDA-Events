import { z } from "zod";
import type { ClubFormFillMode } from "@/modules/club-forms/definitions";
import { DIRECTORY_NOT_LISTED_VALUE, notListedCompanions, type RegistrationFormDefinition } from "@/modules/forms/definition";

/**
 * Pure rules for open applications (#1229): one reusable public link per club year that anyone can fill in, with the
 * applicant picking a club or "Not listed". Nothing here reads the database.
 */

/** The club choice that means "my club is not in the directory"; the applicant then types its name. */
export const NOT_LISTED_CLUB = "NOT_LISTED";
export const OPEN_APPLICATION_OFF_MESSAGE = "Not available yet.";
export const OPEN_APPLICATION_CLOSED_MESSAGE = "Applications are closed for this club year.";
export const UNLISTED_CLUB_NAME_MAX = 120;

export type OpenApplicationState = "OPEN" | "OFF" | "CLOSED" | "NOT_AN_OPEN_FORM";

/**
 * Whether an open application can be used. A form that is not an open application at all is "not found" (the same
 * answer as an unknown key), so the page never says which forms exist; then the on/off switch; then the year's close.
 */
export function openApplicationState(input: { fillMode: ClubFormFillMode; enabled: boolean; closed: boolean }): OpenApplicationState {
  if (input.fillMode !== "OPEN_APPLICATION") return "NOT_AN_OPEN_FORM";
  if (!input.enabled) return "OFF";
  if (input.closed) return "CLOSED";
  return "OPEN";
}

/** The public application page for a form, as a path. */
export function openApplicationPath(templateKey: string) {
  return `/clubs/forms/apply/${encodeURIComponent(templateKey)}`;
}

/** The absolute address to copy onto the website, or the path when no base address is configured. */
export function openApplicationUrl(baseUrl: string | undefined, templateKey: string) {
  const path = openApplicationPath(templateKey);
  if (!baseUrl) return path;
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return path;
  }
}

/** The idempotency key a browser makes for one application: URL-safe, so a UUID fits. */
export const idempotencyKeySchema = z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/, "The request key is not valid.");

/**
 * Control characters and whitespace runs become single spaces: the typed name goes into the staff alert email's
 * subject and body, so it must not be able to start a new line there.
 */
export function cleanTypedName(value: string) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\s]+/g, " ").trim();
}

/** The public submit body. Strict, so nothing but these fields can travel in it. */
export const openApplicationSubmitSchema = z.object({
  organizationId: z.string().trim().min(1).max(80),
  unlistedClubName: z.string().max(400).transform(cleanTypedName).pipe(z.string().max(UNLISTED_CLUB_NAME_MAX)).optional(),
  idempotencyKey: idempotencyKeySchema,
  answers: z.record(z.string().max(80), z.unknown()),
}).strict().superRefine((value, context) => {
  if (value.organizationId === NOT_LISTED_CLUB && !value.unlistedClubName) {
    context.addIssue({ code: "custom", path: ["unlistedClubName"], message: "Type your club's name." });
  }
});

export type OpenApplicationSubmitInput = z.infer<typeof openApplicationSubmitSchema>;

/**
 * Splits the enabled templates for a director's Forms page (#1229): forms for families and individuals (sent by
 * link), and club forms (the club fills them in; open applications are among them, shown with the application link).
 */
export function groupClubFormsByFillMode<T extends { fillMode: ClubFormFillMode }>(templates: readonly T[]) {
  return {
    families: templates.filter((template) => template.fillMode === "FAMILY"),
    club: templates.filter((template) => template.fillMode !== "FAMILY"),
  };
}

type FieldLike = RegistrationFormDefinition["sections"][number]["fields"][number];

/**
 * The form's club-directory field that names the applicant's own club, and its "Not listed" companions (#1229). Only
 * the first one: a later club-directory field (a previous or partner club) is the applicant's to answer.
 */
function clubDirectoryFields(definition: RegistrationFormDefinition) {
  const all: FieldLike[] = definition.sections.flatMap((section) => section.fields);
  const controllers = all.filter((field) => field.optionSource === "CLUBS_DIRECTORY").slice(0, 1);
  const companions = controllers.flatMap((controller) => notListedCompanions(all, controller.key).map((companion) => ({ controller, companion })));
  return { controllers, companions };
}

/**
 * An open application asks for the club once, in its own picker. The form's own club-directory field and its "Not
 * listed" companion are left out of what the applicant sees, so the two cannot disagree.
 */
export function withoutClubDirectoryFields(definition: RegistrationFormDefinition): RegistrationFormDefinition {
  const { controllers, companions } = clubDirectoryFields(definition);
  const hidden = new Set([...controllers.map((field) => field.key), ...companions.map((pair) => pair.companion.key)]);
  if (hidden.size === 0) return definition;
  return {
    ...definition,
    sections: definition.sections
      .map((section) => ({ ...section, fields: section.fields.filter((field) => !hidden.has(field.key)) }))
      .filter((section) => section.fields.length > 0),
  };
}

/**
 * The applicant's answers with the form's club-directory fields set from the chosen club: its name, or "Not listed"
 * plus the typed name in the companion. Whatever the client sent for those keys is dropped.
 */
export function withChosenClubAnswers(
  definition: RegistrationFormDefinition,
  answers: Record<string, unknown>,
  club: { name: string } | { unlistedName: string },
): Record<string, unknown> {
  const { controllers, companions } = clubDirectoryFields(definition);
  const next = { ...answers };
  for (const field of [...controllers, ...companions.map((pair) => pair.companion)]) delete next[field.key];
  for (const controller of controllers) next[controller.key] = "name" in club ? club.name : DIRECTORY_NOT_LISTED_VALUE;
  if ("unlistedName" in club) for (const pair of companions) next[pair.companion.key] = club.unlistedName;
  return next;
}
