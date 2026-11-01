/**
 * The four emails from the approved mockup (#1443), rendered through the real pieces and saved as HTML and plain text.
 * They are the files to open in Outlook, Gmail and iPhone Mail when checking a client. Synthetic data only. A change
 * to the layout shows up here as a diff to review; update with `npx vitest run -u tests/email-layout-snapshots-1443.test.ts`.
 */
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

import { enqueueAttendeeEmail, prepareAttendeeEmailBodyForDelivery } from "@/modules/attendee-accounts/attendee-email";
import { markdownToPlainText, renderEmailBodyHtml } from "@/modules/communications/email-html";
import {
  appendEmailPlainTextFooter,
  emailLayoutContent,
  plainTextToEmailBodyHtml,
  renderEmailLayoutDocument,
} from "@/modules/communications/email-layout";
import { DEFAULT_EMAIL_LAYOUT_SETTINGS } from "@/modules/communications/email-layout-domain";
import { clubRoleGivenEmail } from "@/modules/organizations/club-role-notice";

const SITE = "https://events.example.org";
const NOW = new Date("2026-11-09T12:00:00Z");

type Built = { html: string; text: string };

/** What delivery does for one message: the layout content, the HTML document and the text part with its footer. */
function build(input: {
  templateKey: Parameters<typeof emailLayoutContent>[0]["templateKey"];
  subject: string;
  text: string;
  bodyHtml?: string;
  codeBox?: { code: string; caption: string };
  recipientEmail: string;
  eventScoped?: boolean;
  replyToEmail?: string | null;
  preheader?: string;
}): Built {
  const layout = emailLayoutContent({
    templateKey: input.templateKey,
    settings: DEFAULT_EMAIL_LAYOUT_SETTINGS,
    recipientEmail: input.recipientEmail,
    replyToEmail: input.replyToEmail ?? null,
    eventScoped: input.eventScoped,
  });
  return {
    html: `${renderEmailLayoutDocument({
      title: input.subject,
      bodyHtml: input.bodyHtml ?? plainTextToEmailBodyHtml(input.text, { codeBox: input.codeBox, buttonOrigins: [SITE] }),
      preheader: input.preheader,
      headerName: layout.headerName,
      whyLine: layout.whyLine,
      helpLine: layout.helpLine,
    })}\n`,
    text: appendEmailPlainTextFooter(input.bodyHtml ? markdownToPlainText(input.text) : input.text, layout),
  };
}

async function saveSnapshots(name: string, built: Built) {
  await expect(built.html).toMatchFileSnapshot(`./__snapshots__/email-layout-1443/${name}.html`);
  await expect(built.text).toMatchFileSnapshot(`./__snapshots__/email-layout-1443/${name}.txt`);
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getServerEnv.mockReturnValue({
    APP_BASE_URL: SITE,
    ACCOUNT_EMAIL_SENDER_NAME: "IMSDA Events",
    ACCOUNT_EMAIL_SENDER_ADDRESS: "no-reply@example.org",
    ACCOUNT_EMAIL_REPLY_TO: "help@example.org",
  });
  dependencies.getResendEmailAvailability.mockReturnValue({ deliveryConfigured: true, webhookConfigured: true });
  dependencies.attachAttendeeSignInCode.mockResolvedValue("482913");
  dependencies.reuseAttendeeSignInCode.mockResolvedValue(null);
});

describe("saved snapshots of the four mockup emails (#1443)", () => {
  it("sign-in code", async () => {
    const messageOutbox = { create: vi.fn().mockResolvedValue({ id: "msg_1" }), findUnique: vi.fn().mockResolvedValue({ recipientEmail: "director@example.org" }) };
    dependencies.getPrisma.mockReturnValue({ messageOutbox, attendeeAccount: { findUnique: vi.fn().mockResolvedValue({ email: "director@example.org" }) } });
    await enqueueAttendeeEmail({ accountId: "acct_1", email: "director@example.org", displayName: "Morgan Reed", selection: { kind: "sign-in-code" } });
    const queued = messageOutbox.create.mock.calls[0][0].data;
    const prepared = await prepareAttendeeEmailBodyForDelivery({ messageId: "msg_1", accountAttendeeId: "acct_1", templateKey: "ATTENDEE_SIGN_IN_CODE", bodyText: queued.bodyTextSnapshot, now: NOW });
    const built = build({ templateKey: "ATTENDEE_SIGN_IN_CODE", subject: queued.subjectSnapshot, text: prepared.bodyText, codeBox: prepared.codeBox, recipientEmail: "director@example.org", replyToEmail: "help@example.org", preheader: "Enter this code to finish signing in. It works for 10 minutes." });
    // The code is in the box and the body only, never in the subject; the box says how long it works.
    expect(queued.subjectSnapshot).not.toMatch(/\d/);
    expect(built.html).toContain(">482 913</div>");
    expect(built.html).toContain("Works for 10 minutes");
    expect(built.html).toContain("Don&#39;t share this code with anyone. IMSDA staff will never ask for it.");
    expect(built.html).toContain("Didn&#39;t try to sign in?");
    expect(built.text).toContain("It works for 10 minutes. Don't share this code with anyone.");
    await saveSnapshots("sign-in-code", built);
  });

  it("club role given", async () => {
    const content = clubRoleGivenEmail({ role: "DIRECTOR", clubName: "Riverton Pathfinders", displayName: "Morgan Reed", startsOn: new Date("2026-11-09T18:00:00Z"), portalUrl: `${SITE}/account/clubs/riverton`, twoStepOn: false });
    const built = build({ templateKey: "CLUB_TEAM_ROLE_NOTIFICATION", subject: content.subject, text: content.bodyText, recipientEmail: "director@example.org", replyToEmail: "help@example.org", preheader: "You've been given the Director role for Riverton Pathfinders." });
    expect(built.html).toContain("Button not working?");
    expect(built.html).toContain(`href="${SITE}/account/clubs/riverton"`);
    expect(built.text).toContain(`Open Riverton Pathfinders: ${SITE}/account/clubs/riverton`);
    await saveSnapshots("club-role-given", built);
  });

  it("registration confirmation with a balance due", async () => {
    const source = [
      "# We received your registration for Women's Retreat 2027",
      "",
      "Hello Morgan Reed,",
      "",
      "Your place is recorded. A balance remains on this registration.",
      "",
      "### Your registration",
      "",
      "- **Confirmation code:** WR27-4K8P",
      "- **Dates:** April 16-18, 2027",
      "- **Location:** Riverbend Lodge, Ames, Iowa",
      "- **Attendees:** Morgan Reed, Jordan Reed",
      "- **Paid so far:** $60.00 of $245.00",
      "- **Balance due:** $185.00",
      "",
      `[View, pay, or edit your registration](${SITE}/r/WR27-4K8P){.button}`,
      "",
      "Your balance is due by March 31, 2027. You can pay online any time from the link above.",
    ].join("\n");
    const built = build({
      templateKey: "REGISTRATION_CONFIRMATION_UNPAID",
      subject: "Registration received - balance due for Women's Retreat 2027",
      text: source,
      bodyHtml: renderEmailBodyHtml(source),
      recipientEmail: "morgan.reed@example.org",
      eventScoped: true,
      replyToEmail: "womensretreat@example.org",
      preheader: "Your place is recorded. $185.00 remains on registration WR27-4K8P.",
    });
    expect(built.html).toContain("Questions about this event? Email womensretreat@example.org.");
    expect(built.html).toContain(">Balance due:</strong> $185.00");
    await saveSnapshots("registration-confirmation-balance-due", built);
  });

  it("scheduled event message", async () => {
    const source = [
      "# What to know before you arrive",
      "",
      "Hello Morgan Reed,",
      "",
      "We're looking forward to worshiping with you next week. A few things to help your arrival go smoothly:",
      "",
      "- **Check-in** opens Friday, June 11 at 2:00 p.m. at the main lodge.",
      "- **Bring** a Bible, bedding, a flashlight and a reusable water bottle.",
      "- **Meals** start with Friday supper. Your meal plan is on your registration page.",
      "",
      `[View your registration](${SITE}/r/CM27-7H2Q){.button}`,
    ].join("\n");
    const built = build({
      templateKey: "EVENT_ANNOUNCEMENT",
      subject: "Camp Meeting 2027: what to know before you arrive",
      text: source,
      bodyHtml: renderEmailBodyHtml(source),
      recipientEmail: "morgan.reed@example.org",
      eventScoped: true,
      replyToEmail: "campmeeting@example.org",
      preheader: "Check-in opens Friday at 2:00 p.m. Here's what to bring.",
    });
    await saveSnapshots("scheduled-event-message", built);
  });
});
