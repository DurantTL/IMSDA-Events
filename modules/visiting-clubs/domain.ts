import { z } from "zod";
import { EMAIL_FIELD_MESSAGE, emailAddressSchema, newPhoneSchema } from "@/lib/field-validation";

/**
 * Visiting club invites (#835). Client-safe: the director's form imports the wording and the schema, so nothing here
 * may reach `node:` or the database.
 *
 * A visiting club is a guest for one event, not a permanent club. Staff email a visiting director a private link for
 * that event; the director signs in, asks for their club, and staff approve it. The link by itself grants nothing.
 */

export const VISITING_CLUB_STATUSES = ["PENDING", "APPROVED", "DECLINED"] as const;
export type VisitingClubStatusValue = (typeof VISITING_CLUB_STATUSES)[number];

export const VISITING_CLUB_TYPES = ["PATHFINDER", "ADVENTURER"] as const;
export type VisitingClubTypeValue = (typeof VISITING_CLUB_TYPES)[number];
export const visitingClubTypeLabels: Record<VisitingClubTypeValue, string> = {
  PATHFINDER: "Pathfinder club",
  ADVENTURER: "Adventurer club",
};

/** The text kept on the guest club's organization (`sourceOrgType`), so staff can tell a guest from a conference club. */
export const visitingClubSourceOrgType: Record<VisitingClubTypeValue, string> = {
  PATHFINDER: "Visiting Pathfinder Club",
  ADVENTURER: "Visiting Adventurer Club",
};

/** How long a private visiting club link stays usable. */
export const VISITING_CLUB_INVITE_LIFETIME_DAYS = 30;
export const VISITING_DECLINE_REASON_MAX = 500;

/** The one sentence the director agrees to. Their own conference does the screening; we do not ask for Sterling. */
export const VISITING_SCREENING_CONFIRMATION =
  "I confirm that the adults coming with this club have been screened under my own conference's adult screening policy.";

/** Shown when a signed-in account is not the address the link was sent to. Reveals nothing else. */
export const VISITING_EMAIL_MISMATCH_MESSAGE =
  "This link was sent to a different email address. Sign in with the account for the address it was sent to, or ask the conference for a new link.";

/** Collapses runs of whitespace so "  Jo   Smith " and "Jo Smith" are the same name. */
export function cleanVisitingText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

const requiredText = (label: string, max: number, min = 2) =>
  z.string().trim().min(min, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`);

const requiredEmail = emailAddressSchema.refine((value) => value !== "", EMAIL_FIELD_MESSAGE);

/** A required phone: blank is not a number. Stored normalised. */
const requiredPhone = newPhoneSchema.refine((value) => value !== "", "Give a phone number for the director.");

/** What staff send to create a link: the event and the director's address, plus an optional name for the greeting. */
export const visitingClubInviteInputSchema = z.strictObject({
  eventId: z.string().trim().min(1, "Choose the event.").max(100),
  email: requiredEmail,
  name: z.string().trim().max(120).optional().default(""),
});
export type VisitingClubInviteInput = z.infer<typeof visitingClubInviteInputSchema>;

/**
 * What the visiting director sends. The director's name and email come from their signed-in account on the server,
 * never from the form, and the event comes from the invite, never from the form.
 */
export const visitingClubRequestInputSchema = z.strictObject({
  clubName: requiredText("The club name", 120),
  clubType: z.enum(VISITING_CLUB_TYPES, { error: "Choose Pathfinder or Adventurer." }),
  homeConference: requiredText("Your home conference", 120),
  homeChurch: requiredText("Your home church", 120),
  directorPhone: requiredPhone,
  screeningConfirmed: z.literal(true, { error: "Tick the box to confirm your conference's adult screening." }),
});
export type VisitingClubRequestInput = z.infer<typeof visitingClubRequestInputSchema>;

export const visitingClubDecisionSchema = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("approve") }),
  z.strictObject({
    decision: z.literal("decline"),
    declineReason: z.string().trim().max(VISITING_DECLINE_REASON_MAX, `Keep the reason under ${VISITING_DECLINE_REASON_MAX} characters.`).optional(),
  }),
]);
export type VisitingClubDecision = z.infer<typeof visitingClubDecisionSchema>;

export type VisitingClubInviteState = "OPEN" | "USED" | "CANCELLED" | "EXPIRED";

/** The state of an invite at `now`. A used link stays Used even after its expiry date. */
export function visitingInviteState(
  invite: { usedAt: Date | null; cancelledAt: Date | null; expiresAt: Date },
  now: Date,
): VisitingClubInviteState {
  if (invite.usedAt) return "USED";
  if (invite.cancelledAt) return "CANCELLED";
  if (invite.expiresAt <= now) return "EXPIRED";
  return "OPEN";
}

/** The views of the staff page's Visiting clubs section. */
export const VISITING_PATH = "/admin/clubs/applications?status=visiting";

export function visitingRequestHref(requestId: string): string {
  return `/admin/clubs/applications?visiting=${encodeURIComponent(requestId)}`;
}

export function visitingClubInvitePath(token: string) {
  return `/account/visiting-club/${encodeURIComponent(token)}`;
}
