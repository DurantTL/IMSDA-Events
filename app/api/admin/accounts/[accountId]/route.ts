import { after } from "next/server";
import { z } from "zod";
import { deliverQueuedAttendeeEmail } from "@/modules/attendee-accounts/attendee-email-dispatch";
import { HAND_LINK_NOTE_MAX, HAND_LINK_REASON_CODES } from "@/modules/account-merge/hand-link-reasons";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireSystemAdministrator } from "@/modules/organizations/access";
import { setAreaCoordinator } from "@/modules/organizations/area-coordinators";
import {
  findStaffUserIdByEmail,
  linkStaffAndAttendeeByHand,
  unlinkStaffAndAttendee,
} from "@/modules/account-merge/hand-link";
import { changeAttendeeEmail, resetAttendeeTwoStep, sendAttendeeVerificationByAdmin, signOutAttendeeEverywhere } from "@/modules/system-admin/user-admin";
import { userAdminApiError } from "@/modules/system-admin/user-admin-api";
import { withRequestContext } from "@/lib/request-context";

// A reason code from a fixed list plus an optional note (5 to 500 characters for "Other"; the server re-checks).
const handLinkReason = z.object({
  code: z.enum(HAND_LINK_REASON_CODES),
  note: z.string().trim().max(HAND_LINK_NOTE_MAX, `Keep the note to ${HAND_LINK_NOTE_MAX} characters.`).optional(),
}).strict();

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reset-two-step") }).strict(),
  z.object({ action: z.literal("sign-out") }).strict(),
  z.object({ action: z.literal("area-coordinator"), on: z.boolean() }).strict(),
  // Hand-linking a person's team sign-in and this account when their emails differ (#554).
  z.object({ action: z.literal("link-staff"), staffEmail: z.string().trim().toLowerCase().pipe(z.email("Enter the team account's email.")), reason: handLinkReason }).strict(),
  z.object({ action: z.literal("unlink-staff"), reason: handLinkReason }).strict(),
  z.object({ action: z.literal("send-verification") }).strict(),
  z.object({ action: z.literal("change-email"), email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")) }).strict(),
]);

/** System administrator actions on an attendee account (#386). Audited. */
async function postHandler(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator();
    const { accountId } = await context.params;
    const input = actionSchema.parse(await request.json());
    if (input.action === "reset-two-step") {
      await resetAttendeeTwoStep(accountId, actor.id);
      return Response.json({ message: "Two-step sign-in reset and signed out everywhere. Club roles will set it up again at their next sign-in." });
    }
    if (input.action === "area-coordinator") {
      await setAreaCoordinator(accountId, input.on, actor.id);
      return Response.json({
        message: input.on
          ? "Now an Area Coordinator: sees every club, view only, after a second sign-in step."
          : "No longer an Area Coordinator.",
      });
    }
    if (input.action === "link-staff") {
      await linkStaffAndAttendeeByHand(
        { userId: await findStaffUserIdByEmail(input.staffEmail), attendeeAccountId: accountId, reason: input.reason },
        actor.id,
      );
      return Response.json({ message: "Linked. Sign-in is unchanged: the team account still signs in to the staff workspace only with its own password and second step." });
    }
    if (input.action === "unlink-staff") {
      await unlinkStaffAndAttendee({ attendeeAccountId: accountId, reason: input.reason }, actor.id);
      return Response.json({ message: "Unlinked." });
    }
    if (input.action === "send-verification") {
      const { messageId } = await sendAttendeeVerificationByAdmin(accountId, actor.id);
      if (messageId) after(() => deliverQueuedAttendeeEmail(messageId));
      return Response.json({ message: "Verification email sent to the account's current address. The email is verified when the person enters the code." });
    }
    if (input.action === "sign-out") {
      await signOutAttendeeEverywhere(accountId, actor.id);
      return Response.json({ message: "Signed out everywhere." });
    }
    await changeAttendeeEmail(accountId, input.email, actor.id);
    return Response.json({ message: "Email changed and signed out everywhere." });
  } catch (error) {
    return userAdminApiError(error, "Updating an account");
  }
}

export const POST = withRequestContext(postHandler);
