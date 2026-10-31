import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { getAccountEmailSender, isAccountEmailConfigured } from "@/modules/communications/account-email";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";

/**
 * The email a person gets when a club role is given to them (#1410), once per grant, through the account
 * slice of the outbox like the attendee emails. A person who already has two-step sign-in is not told about
 * it. No phone number or reply line is invented: the sender's reply-to, if set, is on the message itself.
 */

function firstNameOf(displayName: string) {
  return displayName.trim().split(/\s+/)[0] || "there";
}

function startDateText(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

/** Pure: the subject and plain-text body. `startsOn` is null when the grant simply starts now. */
export function clubRoleGivenEmail(input: {
  role: ClubRole;
  clubName: string;
  displayName: string;
  startsOn: Date | null;
  portalUrl: string;
  twoStepOn: boolean;
}) {
  const role = clubDirectorRoleLabels[input.role];
  const lines = [
    `Hi ${firstNameOf(input.displayName)},`,
    "",
    `You've been given the ${role} role for ${input.clubName}${input.startsOn ? `, starting ${startDateText(input.startsOn)}` : ""}.`,
    "",
  ];
  if (!input.twoStepOn) {
    lines.push(
      "One thing the first time you open club pages",
      "Club pages hold records about young people, including medical information. To protect them, club pages ask for two-step sign-in: your password plus your phone's fingerprint, face or PIN, or a code from an authenticator app. Setup takes about two minutes, and the page walks you through it.",
      "",
    );
  }
  lines.push(`Open ${input.clubName}: ${input.portalUrl}`, "");
  if (!input.twoStepOn) lines.push("Your own event registrations work without it.", "");
  lines.push("IMSDA Events");
  return { subject: `You're now ${role} of ${input.clubName}`, bodyText: lines.join("\n") };
}

/**
 * Queues that email inside the grant's own transaction, so a grant and its one message stand or fall together.
 * Returns the message id to deliver after the response, or null where account email isn't configured (local
 * development): the grant stands either way.
 */
export async function queueClubRoleGivenEmail(tx: Prisma.TransactionClient, input: {
  grantId: string;
  accountId: string;
  email: string;
  displayName: string;
  organizationId: string;
  clubName: string;
  role: ClubRole;
  startsOn: Date | null;
  twoStepOn: boolean;
}): Promise<string | null> {
  if (!isAccountEmailConfigured()) return null;
  const sender = getAccountEmailSender();
  const content = clubRoleGivenEmail({
    role: input.role,
    clubName: input.clubName,
    displayName: input.displayName,
    startsOn: input.startsOn,
    portalUrl: new URL(`/account/clubs/${encodeURIComponent(input.organizationId)}`, getServerEnv().APP_BASE_URL).toString(),
    twoStepOn: input.twoStepOn,
  });
  const message = await tx.messageOutbox.create({
    data: {
      eventId: null,
      templateKey: "CLUB_TEAM_ROLE_NOTIFICATION",
      recipientKind: "ACCOUNT",
      recipientEmail: input.email,
      recipientName: input.displayName.trim() || null,
      accountAttendeeId: input.accountId,
      senderNameSnapshot: sender.name,
      senderEmailSnapshot: sender.address,
      replyToEmailSnapshot: sender.replyTo,
      subjectSnapshot: content.subject,
      bodyTextSnapshot: content.bodyText,
      metadata: { trigger: "CLUB_TEAM_ROLE_GRANTED", accountEmail: true, realDelivery: true, grantId: input.grantId },
      idempotencyKey: `club-role-notice:${input.grantId}`,
      correlationId: randomUUID(),
      status: "PENDING",
    },
    select: { id: true },
  });
  return message.id;
}
