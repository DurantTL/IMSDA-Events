import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getServerEnv: vi.fn(),
  getResendEmailAvailability: vi.fn(),
  attachAttendeeSignInCode: vi.fn(),
  reuseAttendeeSignInCode: vi.fn(),
  revokeAttendeeSignInCode: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/lib/env", () => ({ getServerEnv: dependencies.getServerEnv }));
vi.mock("@/integrations/email/resend", () => ({ getResendEmailAvailability: dependencies.getResendEmailAvailability }));
vi.mock("@/modules/attendee-accounts/account-service", () => ({
  attachVerificationCode: vi.fn(),
  attachPasswordResetCode: vi.fn(),
  reuseVerificationCode: vi.fn(),
  reusePasswordResetCode: vi.fn(),
  revokeVerificationCode: vi.fn(),
}));
vi.mock("@/modules/attendee-accounts/step-up-service", () => ({
  attachAttendeeStepUpCode: vi.fn(),
  reuseAttendeeStepUpCode: vi.fn(),
  revokeAttendeeStepUpCode: vi.fn(),
}));
vi.mock("@/modules/attendee-accounts/sign-in-code-service", () => ({
  attachAttendeeSignInCode: dependencies.attachAttendeeSignInCode,
  reuseAttendeeSignInCode: dependencies.reuseAttendeeSignInCode,
  revokeAttendeeSignInCode: dependencies.revokeAttendeeSignInCode,
}));

import {
  SIGN_IN_CODE_DISPLAY_SENTINEL,
  SIGN_IN_CODE_SENTINEL,
  enqueueAttendeeEmail,
  prepareAttendeeEmailBodyForDelivery,
  spacedSignInCode,
} from "@/modules/attendee-accounts/attendee-email";
import { hashOneTimeCode } from "@/modules/attendee-accounts/codes";

const messageOutbox = { create: vi.fn(), findUnique: vi.fn() };
const attendeeAccount = { findUnique: vi.fn() };
const NOW = new Date("2026-12-01T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getServerEnv.mockReturnValue({
    APP_BASE_URL: "https://events.imsda.org",
    ACCOUNT_EMAIL_SENDER_NAME: "IMSDA Events",
    ACCOUNT_EMAIL_SENDER_ADDRESS: "no-reply@imsda.org",
    ACCOUNT_EMAIL_REPLY_TO: "help@imsda.org",
  });
  dependencies.getResendEmailAvailability.mockReturnValue({ deliveryConfigured: true, webhookConfigured: true });
  messageOutbox.create.mockResolvedValue({ id: "msg_1" });
  messageOutbox.findUnique.mockResolvedValue({ recipientEmail: "director@example.test" });
  attendeeAccount.findUnique.mockResolvedValue({ email: "director@example.test" });
  dependencies.getPrisma.mockReturnValue({ messageOutbox, attendeeAccount });
  dependencies.attachAttendeeSignInCode.mockResolvedValue("518207");
  dependencies.reuseAttendeeSignInCode.mockResolvedValue(null);
});

async function queued() {
  await enqueueAttendeeEmail({ accountId: "acct_1", email: "Director@Example.com", displayName: "Test Director", selection: { kind: "sign-in-code" } });
  return messageOutbox.create.mock.calls[0][0].data;
}

describe("what the sign-in code puts in the outbox (#1410)", () => {
  it("queues placeholders in the subject and body, never a code", async () => {
    const data = await queued();
    expect(data.templateKey).toBe("ATTENDEE_SIGN_IN_CODE");
    expect(data.subjectSnapshot).toBe(`Your IMSDA Events sign-in code: ${SIGN_IN_CODE_SENTINEL}`);
    expect(data.bodyTextSnapshot).toContain(SIGN_IN_CODE_DISPLAY_SENTINEL);
    expect(`${data.subjectSnapshot}\n${data.bodyTextSnapshot}`).not.toMatch(/\b\d{3}\s?\d{3}\b/);
  });

  it("says what the approved copy says", async () => {
    const data = await queued();
    expect(data.bodyTextSnapshot).toContain("Enter this code to finish signing in:");
    expect(data.bodyTextSnapshot).toContain("It works for 10 minutes. If you didn't try to sign in, change your password. Someone may know it.");
  });
});

describe("what delivery does with it", () => {
  const body = async () => (await queued()).bodyTextSnapshot as string;

  it("puts the code in the subject and the spaced code in the body, only in the message being sent", async () => {
    const prepared = await prepareAttendeeEmailBodyForDelivery({
      messageId: "msg_1", accountAttendeeId: "acct_1", templateKey: "ATTENDEE_SIGN_IN_CODE", bodyText: await body(), now: NOW,
    });
    expect(prepared.subject).toBe("Your IMSDA Events sign-in code: 518207");
    expect(prepared.bodyText).toContain("518 207");
    expect(prepared.bodyText).not.toContain("{{");
    expect(spacedSignInCode("518207")).toBe("518 207");
    // The stored row was queued with placeholders only.
    expect(JSON.stringify(messageOutbox.create.mock.calls)).not.toContain("518207");
  });

  it("a retry of the same message resends the same code and does not withdraw it", async () => {
    dependencies.reuseAttendeeSignInCode.mockResolvedValue("518207");
    const prepared = await prepareAttendeeEmailBodyForDelivery({
      messageId: "msg_1", accountAttendeeId: "acct_1", templateKey: "ATTENDEE_SIGN_IN_CODE", bodyText: await body(), now: NOW,
    });
    expect(prepared.subject).toContain("518207");
    expect(dependencies.attachAttendeeSignInCode).not.toHaveBeenCalled();
    expect(prepared).not.toHaveProperty("revokeOnDefinitiveFailure");
  });

  it("withdraws a freshly minted code if the message definitively fails to leave", async () => {
    const prepared = await prepareAttendeeEmailBodyForDelivery({
      messageId: "msg_1", accountAttendeeId: "acct_1", templateKey: "ATTENDEE_SIGN_IN_CODE", bodyText: await body(), now: NOW,
    });
    await prepared.revokeOnDefinitiveFailure?.();
    expect(dependencies.revokeAttendeeSignInCode).toHaveBeenCalledWith(hashOneTimeCode("518207"), NOW);
  });

  it("sends nothing when the pending code was superseded or spent while queued", async () => {
    dependencies.attachAttendeeSignInCode.mockResolvedValue(null);
    await expect(prepareAttendeeEmailBodyForDelivery({
      messageId: "msg_1", accountAttendeeId: "acct_1", templateKey: "ATTENDEE_SIGN_IN_CODE", bodyText: await body(), now: NOW,
    })).rejects.toThrow("no live attendee code");
  });

  it("sends nothing to a mailbox the account no longer has", async () => {
    attendeeAccount.findUnique.mockResolvedValue({ email: "new-address@example.test" });
    await expect(prepareAttendeeEmailBodyForDelivery({
      messageId: "msg_1", accountAttendeeId: "acct_1", templateKey: "ATTENDEE_SIGN_IN_CODE", bodyText: await body(), now: NOW,
    })).rejects.toThrow("address changed");
    expect(dependencies.attachAttendeeSignInCode).not.toHaveBeenCalled();
  });
});
