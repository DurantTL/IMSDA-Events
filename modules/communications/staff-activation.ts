import "server-only";

import { getServerEnv } from "@/lib/env";
import { issueAccountToken } from "@/modules/access/auth-service";
import { sendStaffInvitationEmail } from "@/modules/communications/account-email-dispatch";

export type StaffActivationDelivery = {
  /** Whether an activation email was queued for the person. */
  invitationEmailed: boolean;
  /** A one-time link to hand over, only where account email is not configured (development). */
  setupUrl?: string;
  setupExpiresAt?: string;
};

/**
 * Gets a staff login's activation link to the person: an email when this deployment can send account email, otherwise
 * a one-time link (`/reset-password?token=`) for the administrator to pass on. Used when a colleague is added to an
 * event, when People & access invites someone, and when a pending invite is resent (#1276). Issuing a new token spends
 * the older ones, so a resend retires the previous link.
 */
export async function deliverStaffActivation(input: {
  userId: string;
  email: string;
  displayName: string;
}): Promise<StaffActivationDelivery> {
  const invited = await sendStaffInvitationEmail(input);
  if (invited.configured) return { invitationEmailed: invited.queued };
  const issued = await issueAccountToken(input.email);
  if (!issued) return { invitationEmailed: false };
  return {
    invitationEmailed: false,
    setupUrl: new URL(`/reset-password?token=${encodeURIComponent(issued.token)}`, getServerEnv().APP_BASE_URL).toString(),
    setupExpiresAt: issued.expiresAt.toISOString(),
  };
}
