import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two emails of lost-device recovery (#221) and the pieces around "Sign out everywhere else": the code email
 * (code in the body only, minted at delivery from the recovery store, never from the sign-in one), the notice
 * (time in Central, labeled, no code and no link), the daily cap and the no-method path of the send, and the
 * signed-in-devices list. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getServerEnv: vi.fn(),
  getResendEmailAvailability: vi.fn(),
  attachRecovery: vi.fn(),
  reuseRecovery: vi.fn(),
  revokeRecovery: vi.fn(),
  attachSignIn: vi.fn(),
  reuseSignIn: vi.fn(),
  after: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSignInStep: vi.fn() }));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/integrations/email/resend", () => ({ getResendEmailAvailability: mocks.getResendEmailAvailability }));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: vi.fn() }));
vi.mock("@/modules/attendee-accounts/account-service", () => ({
  attachVerificationCode: vi.fn(), attachPasswordResetCode: vi.fn(), reuseVerificationCode: vi.fn(), reusePasswordResetCode: vi.fn(), revokeVerificationCode: vi.fn(),
}));
vi.mock("@/modules/attendee-accounts/step-up-service", () => ({
  attachAttendeeStepUpCode: vi.fn(), reuseAttendeeStepUpCode: vi.fn(), revokeAttendeeStepUpCode: vi.fn(), bindAttendeeStepUpMessage: vi.fn(async () => true),
}));
vi.mock("@/modules/attendee-accounts/sign-in-code-service", () => ({
  attachAttendeeSignInCode: mocks.attachSignIn, reuseAttendeeSignInCode: mocks.reuseSignIn, revokeAttendeeSignInCode: vi.fn(),
}));
vi.mock("@/modules/attendee-accounts/two-step-recovery", () => ({
  TWO_STEP_RECOVERY_DAILY_LIMIT: 3,
  attachAttendeeTwoStepRecoveryCode: mocks.attachRecovery,
  reuseAttendeeTwoStepRecoveryCode: mocks.reuseRecovery,
  revokeAttendeeTwoStepRecoveryCode: mocks.revokeRecovery,
  accountHasTwoStepMethod: vi.fn(),
  beginAttendeeTwoStepRecovery: vi.fn(),
  countRecentCompletedTwoStepRecoveries: vi.fn(),
}));

import {
  TWO_STEP_RECOVERY_CODE_DISPLAY_SENTINEL,
  enqueueAttendeeEmail,
  prepareAttendeeEmailBodyForDelivery,
} from "@/modules/attendee-accounts/attendee-email";
import { notifyTwoStepRecovered } from "@/modules/attendee-accounts/two-step-recovery-issue";
import { emailLayoutContent } from "@/modules/communications/email-layout";

const messageOutbox = { create: vi.fn(), findUnique: vi.fn() };
const attendeeAccount = { findUnique: vi.fn() };
// 15:14 UTC on Nov 9, 2026 is 9:14 AM Central Standard Time.
const NOW = new Date("2026-11-09T15:14:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerEnv.mockReturnValue({
    APP_BASE_URL: "https://events.imsda.org",
    ACCOUNT_EMAIL_SENDER_NAME: "IMAdventist",
    ACCOUNT_EMAIL_SENDER_ADDRESS: "no-reply@imsda.org",
    ACCOUNT_EMAIL_REPLY_TO: "help@imsda.org",
  });
  mocks.getResendEmailAvailability.mockReturnValue({ deliveryConfigured: true, webhookConfigured: true });
  messageOutbox.create.mockResolvedValue({ id: "msg_1" });
  messageOutbox.findUnique.mockResolvedValue({ recipientEmail: "director@example.test" });
  attendeeAccount.findUnique.mockResolvedValue({ email: "director@example.test", displayName: "Test Director" });
  mocks.getPrisma.mockReturnValue({ messageOutbox, attendeeAccount });
  mocks.attachRecovery.mockResolvedValue("518207");
  mocks.reuseRecovery.mockResolvedValue(null);
});

const queued = () => messageOutbox.create.mock.calls[0][0].data;

describe("the recovery code email", () => {
  it("queues a plain subject and a body placeholder, never a code", async () => {
    await enqueueAttendeeEmail({ accountId: "acct_1", email: "Director@Example.com", displayName: "Test Director", selection: { kind: "two-step-recovery-code" } });
    const data = queued();
    expect(data.templateKey).toBe("ATTENDEE_TWO_STEP_RECOVERY_CODE");
    expect(data.subjectSnapshot).toBe("Your IMAdventist two-step recovery code");
    expect(data.bodyTextSnapshot).toContain(TWO_STEP_RECOVERY_CODE_DISPLAY_SENTINEL);
    expect(`${data.subjectSnapshot}\n${data.bodyTextSnapshot}`).not.toMatch(/\b\d{3}\s?\d{3}\b/);
    expect(data.bodyTextSnapshot).not.toMatch(/two-factor|2fa|mfa/i);
  });

  it("mints the spaced code at delivery from the recovery store only, in the body and the code box", async () => {
    await enqueueAttendeeEmail({ accountId: "acct_1", email: "director@example.test", displayName: "Test Director", selection: { kind: "two-step-recovery-code" } });
    const prepared = await prepareAttendeeEmailBodyForDelivery({
      messageId: "msg_1", accountAttendeeId: "acct_1", templateKey: "ATTENDEE_TWO_STEP_RECOVERY_CODE", bodyText: queued().bodyTextSnapshot, now: NOW,
    });
    expect(prepared.bodyText).toContain("518 207");
    expect(prepared.bodyText).not.toContain(TWO_STEP_RECOVERY_CODE_DISPLAY_SENTINEL);
    expect(prepared.codeBox).toEqual({ code: "518 207", caption: "Works for 10 minutes" });
    expect(mocks.attachRecovery).toHaveBeenCalledWith({ accountId: "acct_1", messageId: "msg_1", now: NOW });
    expect(mocks.attachSignIn).not.toHaveBeenCalled();
    expect(mocks.reuseSignIn).not.toHaveBeenCalled();
  });

  it("resends the same code on a retry, and refuses to deliver a code nothing will accept", async () => {
    mocks.reuseRecovery.mockResolvedValue("123456");
    const retried = await prepareAttendeeEmailBodyForDelivery({
      messageId: "msg_1", accountAttendeeId: "acct_1", templateKey: "ATTENDEE_TWO_STEP_RECOVERY_CODE", bodyText: `x ${TWO_STEP_RECOVERY_CODE_DISPLAY_SENTINEL}`, now: NOW,
    });
    expect(retried.bodyText).toBe("x 123 456");
    expect(mocks.attachRecovery).not.toHaveBeenCalled();
    mocks.reuseRecovery.mockResolvedValue(null);
    mocks.attachRecovery.mockResolvedValue(null);
    await expect(prepareAttendeeEmailBodyForDelivery({
      messageId: "msg_1", accountAttendeeId: "acct_1", templateKey: "ATTENDEE_TWO_STEP_RECOVERY_CODE", bodyText: TWO_STEP_RECOVERY_CODE_DISPLAY_SENTINEL, now: NOW,
    })).rejects.toThrow(/no live attendee code/i);
  });

  it("is a branded email with its own reason line", () => {
    const code = emailLayoutContent({ templateKey: "ATTENDEE_TWO_STEP_RECOVERY_CODE", recipientEmail: "director@example.test", replyToEmail: "help@imsda.org" });
    expect(code.context).toBe("general");
    expect(code.whyLine).toBe("You got this because someone signed in to IMAdventist as director@example.test and asked to recover two-step sign-in.");
    const notice = emailLayoutContent({ templateKey: "ATTENDEE_TWO_STEP_RECOVERY_NOTICE", recipientEmail: "director@example.test", replyToEmail: "help@imsda.org" });
    expect(notice.whyLine).toBe("You got this because two-step sign-in was reset on the IMAdventist account for director@example.test.");
  });
});

describe("the recovery notice email", () => {
  it("is queued after a recovery, to the account's own address, with the time in Central and labeled", async () => {
    await notifyTwoStepRecovered("acct_1", NOW);
    const data = queued();
    expect(data.templateKey).toBe("ATTENDEE_TWO_STEP_RECOVERY_NOTICE");
    expect(data.recipientEmail).toBe("director@example.test");
    expect(data.subjectSnapshot).toBe("Two-step sign-in was reset on your IMAdventist account");
    expect(data.bodyTextSnapshot).toContain("November 9, 2026 at 9:14 AM CST");
    expect(data.bodyTextSnapshot).toContain("Your passkeys and authenticator app were removed and your other devices were signed out.");
    expect(data.bodyTextSnapshot).toContain("Wasn't you?\nReset your password right away and contact the conference office.");
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("carries no code, no link that grants access and no sentinel", async () => {
    await notifyTwoStepRecovered("acct_1", NOW);
    const text = `${queued().subjectSnapshot}\n${queued().bodyTextSnapshot}`;
    expect(text).not.toMatch(/\b\d{3}\s?\d{3}\b/);
    expect(text).not.toMatch(/https?:\/\/|\{\{/);
  });

  it("never fails the recovery when the mail cannot be queued", async () => {
    messageOutbox.create.mockRejectedValue(new Error("outbox down"));
    await expect(notifyTwoStepRecovered("acct_1", NOW)).resolves.toBeUndefined();
    expect(mocks.logError).toHaveBeenCalledWith("The two-step recovery notice could not be queued", expect.any(Error), { accountId: "acct_1" });
  });
});
