import "server-only";

import { randomUUID } from "node:crypto";
import type { MessageTemplateKey, Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { attendeePublicUrl } from "@/modules/attendee-accounts/public-navigation";
import {
  getAccountEmailSender,
  isAccountEmailConfigured,
} from "@/modules/communications/account-email";
import {
  attachPasswordResetCode,
  attachVerificationCode,
  reusePasswordResetCode,
  reuseVerificationCode,
  revokeVerificationCode,
} from "@/modules/attendee-accounts/account-service";
import {
  createOneTimeCode,
  hashOneTimeCode,
  EMAIL_VERIFICATION_LIFETIME_MINUTES,
  SIGN_IN_CODE_LIFETIME_MINUTES,
} from "@/modules/attendee-accounts/codes";
import {
  attachAttendeeSignInCode,
  reuseAttendeeSignInCode,
  revokeAttendeeSignInCode,
} from "@/modules/attendee-accounts/sign-in-code-service";
import {
  attachAttendeeStepUpCode,
  reuseAttendeeStepUpCode,
  revokeAttendeeStepUpCode,
} from "@/modules/attendee-accounts/step-up-service";

/**
 * The two emails an attendee account sends: the code that verifies an address
 * at sign-up, and the code that resets a password.
 *
 * Both travel the account slice of the outbox — `eventId` null, sender from the
 * `ACCOUNT_EMAIL_*` variables — because they belong to a person rather than to
 * an event, and have to work before that person is registered for anything.
 *
 * Each has a second body that carries no code and no sentinel. Whether an
 * address already has an account, and whether that account has a password, are
 * facts these endpoints refuse to disclose; the inbox is the one place it is
 * safe to draw the distinction, so that is the only place it is drawn.
 */

export const VERIFICATION_CODE_SENTINEL = "{{attendee_verification_code}}";
export const PASSWORD_RESET_CODE_SENTINEL = "{{attendee_password_reset_code}}";
export const EDIT_VERIFICATION_CODE_SENTINEL = "{{attendee_edit_verification_code}}";
/** The sign-in code in the body, shown as "518 207" (#1410). Never in the subject. */
export const SIGN_IN_CODE_DISPLAY_SENTINEL = "{{attendee_sign_in_code_display}}";

/** "518207" as "518 207", the way the email shows it and the sign-in field accepts it. */
export function spacedSignInCode(code: string) {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function greeting(displayName: string) {
  return displayName.trim() || "there";
}

function verificationBody(displayName: string) {
  return {
    subject: "Your IMSDA Events verification code",
    bodyText: [
      `Hello ${greeting(displayName)},`,
      "",
      "Enter this code on the page where you started creating your IMSDA Events account:",
      "",
      VERIFICATION_CODE_SENTINEL,
      "",
      `The code expires in ${EMAIL_VERIFICATION_LIFETIME_MINUTES} minutes and can only be used in the browser that asked for it.`,
      "",
      "If you did not start creating an account, you can ignore this. The code is useless on its own, and nothing has been created that can reach your registrations.",
      "",
      "IMSDA Events",
    ].join("\n"),
  };
}

/**
 * Sent by "Send verification email" (a system administrator) to an ACTIVE account
 * whose verification was cleared. The code is spent at /account/verify-email.
 */
function adminVerificationBody(displayName: string) {
  return {
    subject: "Verify your IMSDA Events email address",
    bodyText: [
      `Hello ${greeting(displayName)},`,
      "",
      "An IMSDA Events administrator asked us to verify this email address for your account. Enter this code, with this email address, on the Verify your email page:",
      "",
      `${attendeePublicUrl("/account/verify-email").toString()}`,
      "",
      VERIFICATION_CODE_SENTINEL,
      "",
      `The code expires in ${EMAIL_VERIFICATION_LIFETIME_MINUTES} minutes.`,
      "",
      "If you did not expect this, you can ignore it. Nothing changes unless the code is entered.",
      "",
      "IMSDA Events",
    ].join("\n"),
  };
}

/**
 * Sent when the address already has an account. No sentinel, so there is
 * nothing for the delivery step to mint and nothing the person who asked can
 * complete — while the address's actual owner is told that someone tried.
 */
function alreadyRegisteredBody(displayName: string) {
  return {
    subject: "Your IMSDA Events verification code",
    bodyText: [
      `Hello ${greeting(displayName)},`,
      "",
      "Someone asked to create an IMSDA Events account for this address, but one already exists.",
      "",
      "If that was you, sign in with your existing password instead. If you have forgotten it, use \"Forgot password\" on the sign-in page.",
      "",
      "If it was not you, no action is needed. Nothing has changed, and no new account was created.",
      "",
      "IMSDA Events",
    ].join("\n"),
  };
}

function passwordResetBody(displayName: string) {
  return {
    subject: "Your IMSDA Events password reset code",
    bodyText: [
      `Hello ${greeting(displayName)},`,
      "",
      "Enter this code on the page where you asked to reset your IMSDA Events password:",
      "",
      PASSWORD_RESET_CODE_SENTINEL,
      "",
      `The code expires in ${EMAIL_VERIFICATION_LIFETIME_MINUTES} minutes and can only be used in the browser that asked for it.`,
      "",
      "If you did not ask to reset your password, no action is needed. Your current password still works, and this code cannot be used by anyone who only reads it.",
      "",
      "IMSDA Events",
    ].join("\n"),
  };
}

/**
 * Sent when the address has an account that signs in with Google and has no
 * password at all. Minting a reset code would be worse than useless: it would
 * be a way to put a password on an account whose owner deliberately has none.
 */
function federatedOnlyBody(displayName: string) {
  return {
    subject: "Your IMSDA Events password reset code",
    bodyText: [
      `Hello ${greeting(displayName)},`,
      "",
      "Someone asked to reset the password for this IMSDA Events account, but it has no password — it signs in with Google.",
      "",
      "Use \"Sign in with Google\" on the sign-in page.",
      "",
      "If that was not you, no action is needed. Nothing has changed.",
      "",
      "IMSDA Events",
    ].join("\n"),
  };
}

function editVerificationBody(displayName: string) {
  return {
    subject: "Your IMSDA Events edit verification code",
    bodyText: [
      `Hello ${greeting(displayName)},`,
      "",
      "Enter this code in the signed-in browser where you are editing a registration:",
      "",
      EDIT_VERIFICATION_CODE_SENTINEL,
      "",
      `The code expires in ${EMAIL_VERIFICATION_LIFETIME_MINUTES} minutes, works once, and is tied to the session that requested it.`,
      "",
      "If you did not request a registration change, no action is needed.",
      "",
      "IMSDA Events",
    ].join("\n"),
  };
}

function signInCodeBody() {
  return {
    // No code in the subject: the provider's webhook stores the subject it was sent. The code is in the body only, minted at delivery.
    subject: "Your IMSDA Events sign-in code",
    bodyText: [
      "Enter this code to finish signing in:",
      "",
      SIGN_IN_CODE_DISPLAY_SENTINEL,
      "",
      `It works for ${SIGN_IN_CODE_LIFETIME_MINUTES} minutes. If you didn't try to sign in, change your password. Someone may know it.`,
      "",
      "IMSDA Events",
    ].join("\n"),
  };
}

type AttendeeEmailKind =
  | { kind: "verification"; alreadyRegistered: boolean; adminSent?: boolean }
  | { kind: "password-reset"; federatedOnly: boolean }
  | { kind: "edit-verification" }
  | { kind: "sign-in-code" };

function contentFor(selection: AttendeeEmailKind, displayName: string) {
  if (selection.kind === "verification") {
    return {
      templateKey: "ATTENDEE_EMAIL_VERIFICATION" as MessageTemplateKey,
      trigger: "ATTENDEE_SIGN_UP",
      ...(selection.alreadyRegistered
        ? alreadyRegisteredBody(displayName)
        : selection.adminSent
          ? adminVerificationBody(displayName)
          : verificationBody(displayName)),
    };
  }
  if (selection.kind === "edit-verification") {
    return {
      templateKey: "ATTENDEE_EDIT_VERIFICATION" as MessageTemplateKey,
      trigger: "ATTENDEE_REGISTRATION_EDIT_REQUESTED",
      ...editVerificationBody(displayName),
    };
  }
  if (selection.kind === "sign-in-code") {
    return {
      templateKey: "ATTENDEE_SIGN_IN_CODE" as MessageTemplateKey,
      trigger: "ATTENDEE_SIGN_IN_CODE_REQUESTED",
      ...signInCodeBody(),
    };
  }
  return {
    templateKey: "ATTENDEE_PASSWORD_RESET" as MessageTemplateKey,
    trigger: "ATTENDEE_PASSWORD_RESET_REQUESTED",
    ...(selection.federatedOnly
      ? federatedOnlyBody(displayName)
      : passwordResetBody(displayName)),
  };
}

/**
 * Queues one attendee email. The caller has already decided what happened; this
 * does not re-derive it, and reports nothing a caller could turn into a
 * disclosure.
 */
export async function enqueueAttendeeEmail(input: {
  accountId: string;
  email: string;
  displayName: string;
  selection: AttendeeEmailKind;
  correlationId?: string;
  requestKey?: string;
}): Promise<{ messageId: string }> {
  const sender = getAccountEmailSender();
  const content = contentFor(input.selection, input.displayName);

  const message = await getPrisma().messageOutbox.create({
    data: {
      eventId: null,
      accountAttendeeId: input.accountId,
      templateKey: content.templateKey,
      recipientKind: "ACCOUNT",
      recipientEmail: input.email.trim().toLowerCase(),
      recipientName: input.displayName.trim() || null,
      senderNameSnapshot: sender.name,
      senderEmailSnapshot: sender.address,
      replyToEmailSnapshot: sender.replyTo,
      subjectSnapshot: content.subject,
      bodyTextSnapshot: content.bodyText,
      metadata: {
        trigger: content.trigger,
        accountEmail: true,
        realDelivery: true,
      } satisfies Prisma.InputJsonValue,
      idempotencyKey: `attendee:${content.templateKey}:${input.requestKey ?? randomUUID()}`,
      correlationId: input.correlationId ?? randomUUID(),
      status: "PENDING",
    },
    select: { id: true },
  });
  return { messageId: message.id };
}

/**
 * The sign-in code (#1410), minted at delivery like the others and put into the subject and body only in the
 * message being sent. The stored outbox row keeps the sentinel, and the subject carries no code.
 */
async function prepareSignInCodeForDelivery(input: {
  messageId: string;
  accountAttendeeId: string | null;
  bodyText: string;
  now: Date;
}): Promise<{ bodyText: string; revokeOnDefinitiveFailure?: () => Promise<void> }> {
  if (!input.accountAttendeeId) {
    throw new Error("An attendee email cannot mint a code without an account.");
  }
  // The code goes only to the address the account has now: a message queued for a mailbox that was since replaced must not deliver one.
  const [message, account] = await Promise.all([
    getPrisma().messageOutbox.findUnique({ where: { id: input.messageId }, select: { recipientEmail: true } }),
    getPrisma().attendeeAccount.findUnique({ where: { id: input.accountAttendeeId }, select: { email: true } }),
  ]);
  if (!message || !account || message.recipientEmail.trim().toLowerCase() !== account.email.trim().toLowerCase()) {
    throw new Error("The account's address changed after this message was queued; no code is sent.");
  }
  const reused = await reuseAttendeeSignInCode({
    accountId: input.accountAttendeeId,
    messageId: input.messageId,
    now: input.now,
  });
  const code = reused ?? await attachAttendeeSignInCode({
    accountId: input.accountAttendeeId,
    messageId: input.messageId,
    now: input.now,
  });
  if (!code) {
    // Superseded by a newer code, spent, or expired while queued: sending a code nothing will accept helps nobody.
    throw new Error("There is no live attendee code for this account to send.");
  }
  return {
    bodyText: input.bodyText.replaceAll(SIGN_IN_CODE_DISPLAY_SENTINEL, spacedSignInCode(code)),
    ...(reused
      ? {}
      : { revokeOnDefinitiveFailure: async () => { await revokeAttendeeSignInCode(hashOneTimeCode(code), input.now); } }),
  };
}

/**
 * Mints the code at delivery, exactly as a private registration link is minted
 * at delivery: the credential is created when the message actually leaves, so a
 * database read never yields a usable one, and its twenty minutes start when it
 * is sent rather than when it was queued.
 */
export async function prepareAttendeeEmailBodyForDelivery(input: {
  messageId: string;
  accountAttendeeId: string | null;
  templateKey: string;
  bodyText: string;
  now: Date;
}): Promise<{ bodyText: string; revokeOnDefinitiveFailure?: () => Promise<void> }> {
  if (input.templateKey === "ATTENDEE_SIGN_IN_CODE") return prepareSignInCodeForDelivery(input);
  const reset = input.templateKey === "ATTENDEE_PASSWORD_RESET";
  const edit = input.templateKey === "ATTENDEE_EDIT_VERIFICATION";
  const sentinel = edit
    ? EDIT_VERIFICATION_CODE_SENTINEL
    : reset
      ? PASSWORD_RESET_CODE_SENTINEL
      : VERIFICATION_CODE_SENTINEL;
  if (!input.bodyText.includes(sentinel)) {
    return { bodyText: input.bodyText };
  }
  if (!input.accountAttendeeId) {
    throw new Error("An attendee email cannot mint a code without an account.");
  }

  if (!edit) {
    // The address this message was queued for must still be the account's address. An
    // administrator's email change (or a send that raced one) leaves a message addressed to the
    // OLD mailbox; a code delivered there must never verify, or reset, the new address.
    const [message, account] = await Promise.all([
      getPrisma().messageOutbox.findUnique({ where: { id: input.messageId }, select: { recipientEmail: true } }),
      getPrisma().attendeeAccount.findUnique({ where: { id: input.accountAttendeeId }, select: { email: true } }),
    ]);
    if (!message || !account || message.recipientEmail.trim().toLowerCase() !== account.email.trim().toLowerCase()) {
      throw new Error("The account's address changed after this message was queued; no code is sent.");
    }
  }

  const reuse = edit
    ? reuseAttendeeStepUpCode
    : reset
      ? reusePasswordResetCode
      : reuseVerificationCode;
  const reusedCode = await reuse({
    accountId: input.accountAttendeeId,
    messageId: input.messageId,
    now: input.now,
  });
  if (reusedCode) {
    return { bodyText: input.bodyText.replaceAll(sentinel, reusedCode) };
  }

  const code = createOneTimeCode();
  const attach = edit
    ? attachAttendeeStepUpCode
    : reset
      ? attachPasswordResetCode
      : attachVerificationCode;
  const attached = await attach({
    accountId: input.accountAttendeeId,
    messageId: input.messageId,
    code,
    now: input.now,
  });
  if (!attached) {
    // Whatever this message belonged to has been superseded, spent, or has
    // expired while it sat in the queue. Sending a code nothing will accept is
    // worse than sending nothing, so this fails rather than deliver a dead one.
    throw new Error("There is no live attendee code for this account to send.");
  }

  return {
    bodyText: input.bodyText.replaceAll(sentinel, code),
    revokeOnDefinitiveFailure: async () => {
      if (edit) {
        await revokeAttendeeStepUpCode(hashOneTimeCode(code), input.now);
      } else {
        await revokeVerificationCode(hashOneTimeCode(code), input.now);
      }
    },
  };
}

/** Whether attendee email can leave the building at all. */
export function isAttendeeEmailConfigured() {
  return isAccountEmailConfigured();
}

/**
 * Mints a code without sending it, for the development deployment that has no
 * `ACCOUNT_EMAIL_*` configured. Production cannot reach this: the startup
 * contract requires the sender address and the provider key, so
 * {@link isAttendeeEmailConfigured} is true there and a code is only ever
 * minted inside a delivery attempt.
 */
export async function mintAttendeeCodeWithoutSending(input: {
  accountId: string;
  purpose: "verification" | "password-reset" | "edit-verification" | "sign-in-code";
  messageId?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (input.purpose === "sign-in-code") {
    return attachAttendeeSignInCode({
      accountId: input.accountId,
      messageId: input.messageId ?? `development:${input.purpose}:${input.accountId}:${now.getTime()}`,
      now,
    });
  }
  const code = createOneTimeCode();
  const attach = input.purpose === "edit-verification"
    ? attachAttendeeStepUpCode
    : input.purpose === "password-reset"
      ? attachPasswordResetCode
      : attachVerificationCode;
  const attached = await attach({
    accountId: input.accountId,
    messageId: input.messageId
      ?? `development:${input.purpose}:${input.accountId}:${now.getTime()}`,
    code,
    now,
  });
  return attached ? code : null;
}
