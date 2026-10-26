import { z } from "zod";
import type { ClubFormFillMode } from "@/modules/club-forms/definitions";

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

/** The public submit body. Strict, so nothing but these fields can travel in it. */
export const openApplicationSubmitSchema = z.object({
  organizationId: z.string().trim().min(1).max(80),
  unlistedClubName: z.string().trim().max(UNLISTED_CLUB_NAME_MAX).optional(),
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
