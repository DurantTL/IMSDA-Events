import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { EventRefundPolicy } from "@/components/event-refund-policy";
import { buildPaymentStatusBlock, buildRefundPolicyBlock } from "@/modules/communications/message-blocks";
import { hasRefundPolicy, refundPolicyParagraphs } from "@/modules/events/refund-policy";
import { eventSettingsInputSchema } from "@/modules/events/schemas";
import { renderEmailBodyHtml } from "@/modules/communications/email-html";
import { enqueuePublicRegistrationMessages, type RegistrationMessageInput } from "@/modules/communications/messaging-repository";
import { renderMessageTemplate, DEFAULT_MESSAGE_TEMPLATES } from "@/modules/communications/templates";
import { isRegistrationConfirmation } from "@/modules/communications/transactional-messages";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { settingsFieldBlock } from "@/modules/events/settings-layout";

const POLICY = "Full refunds until October 1.\nAfter that, half.\n\n\nNo refunds after the event starts.";

const settings = {
  name: "Synthetic Weekend",
  slug: "synthetic-weekend",
  startsOn: "2026-11-06",
  endsOn: "2026-11-08",
  timezone: "America/Chicago",
  location: null,
  publicInfoUrl: null,
  supportContact: null,
  collectsShirtSizes: false,
  registrationOpensOn: null,
  registrationClosesOn: null,
  waitlistEnabled: false,
  autoPromoteWaitlist: false,
  capacity: null,
};

const balance = { state: "BALANCE_DUE" as const, totalCents: 5000, paidCents: 0, balanceCents: 5000 };

describe("refund policy text (#891)", () => {
  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    expect(refundPolicyParagraphs(POLICY)).toEqual([
      "Full refunds until October 1.\nAfter that, half.",
      "No refunds after the event starts.",
    ]);
  });

  it("treats empty, blank and missing policies as none", () => {
    for (const value of [null, undefined, "", "  \n \n\t"]) {
      expect(hasRefundPolicy(value)).toBe(false);
      expect(refundPolicyParagraphs(value)).toEqual([]);
    }
  });
});

describe("refund policy setting (#891)", () => {
  it("is optional, trimmed, cleared when blank and capped", () => {
    expect(eventSettingsInputSchema.parse(settings).refundPolicy).toBeUndefined();
    expect(eventSettingsInputSchema.parse({ ...settings, refundPolicy: "  Refunds by Oct 1.  " }).refundPolicy).toBe("Refunds by Oct 1.");
    expect(eventSettingsInputSchema.parse({ ...settings, refundPolicy: "   " }).refundPolicy).toBeNull();
    expect(eventSettingsInputSchema.safeParse({ ...settings, refundPolicy: "x".repeat(4001) }).success).toBe(false);
  });

  it("lives in the public information block of event settings", () => {
    expect(settingsFieldBlock.refundPolicy).toBe("public-info");
  });
});

describe("refund policy display (#891)", () => {
  it("renders a heading and one paragraph per block", () => {
    const html = renderToStaticMarkup(createElement(EventRefundPolicy, { policy: POLICY }));
    expect(html).toContain("Refund policy");
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  it("renders nothing, not even a heading, without a policy", () => {
    expect(renderToStaticMarkup(createElement(EventRefundPolicy, { policy: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(EventRefundPolicy, { policy: "  \n " }))).toBe("");
  });

  it("escapes markup instead of injecting it", () => {
    const html = renderToStaticMarkup(createElement(EventRefundPolicy, { policy: "<script>alert(1)</script> & <b>bold</b>" }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("refund policy in the confirmation email (#891)", () => {
  it("adds a policy section after the payment status of a confirmed registration", () => {
    const block = buildPaymentStatusBlock({ ...balance, refundPolicy: POLICY });
    expect(block).toContain("### Balance due");
    expect(block.indexOf("### Refund policy")).toBeGreaterThan(block.indexOf("### Balance due"));
    expect(block).toContain("No refunds after the event starts");
  });

  it("adds nothing when there is no policy", () => {
    expect(buildPaymentStatusBlock({ ...balance, refundPolicy: null })).toBe(buildPaymentStatusBlock(balance));
    expect(buildPaymentStatusBlock({ ...balance, refundPolicy: "  " })).not.toContain("Refund policy");
    expect(buildRefundPolicyBlock(undefined)).toBe("");
  });

  it("is not added to waitlist or cancellation messages", () => {
    for (const state of ["WAITLISTED", "WAITLIST_PROMOTED", "CANCELLED"] as const) {
      expect(buildPaymentStatusBlock({ ...balance, state, refundPolicy: POLICY })).not.toContain("Refund policy");
    }
  });

  it("neutralises Markdown links and images in staff text", () => {
    const hostile = "[Click](https://evil.example.test) ![x](https://evil.example.test/p.png) <a href=\"https://evil.example.test\">go</a>";
    const html = renderEmailBodyHtml(buildRefundPolicyBlock(hostile));
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<img");
  });

  it("reads cleanly in the text part and stays inert in the HTML part of a rendered confirmation", () => {
    const policy = "Full refund by Oct. 1 (minus a $10 fee).\n\n[Click](https://evil.example.test) ![x](https://evil.example.test/p.png)";
    const rendered = renderMessageTemplate(
      { subject: "Hi", body: "Hello.\n\n{{payment_status_block}}\n\nBye." },
      { payment_status_block: buildPaymentStatusBlock({ ...balance, refundPolicy: policy }) },
    );
    expect(rendered.body).toContain("Full refund by Oct. 1 (minus a $10 fee).");
    expect(rendered.body).not.toContain("\\");
    expect(rendered.bodyHtml).not.toContain("<img");
    expect(rendered.bodyHtml).not.toContain("<a");
    expect(rendered.bodyHtml).toContain("Refund policy");
  });

  it("escapes the organization and billing contact in the church-billed block", () => {
    const block = buildPaymentStatusBlock({
      state: "ORGANIZATION_INVOICED", totalCents: 0, paidCents: 0, balanceCents: 0,
      organization: "[Club](https://evil.example.test)", billingContact: "![x](https://evil.example.test/p.png)",
    });
    const rendered = renderMessageTemplate({ subject: "Hi", body: "{{payment_status_block}}" }, { payment_status_block: block });
    expect(rendered.bodyHtml).not.toContain("<a");
    expect(rendered.bodyHtml).not.toContain("<img");
    expect(rendered.body).not.toContain("\\");
    expect(rendered.body).toContain("Responsible organization: **[Club](https://evil.example.test)**");
  });
});

describe("which messages carry the policy (#891)", () => {
  it("is on every registration confirmation, a worker's included, and nothing else", () => {
    for (const key of ["REGISTRATION_CONFIRMATION_PAID", "REGISTRATION_CONFIRMATION_UNPAID", "REGISTRATION_CONFIRMATION_ORGANIZATION_BILLED", "WORKER_CONFIRMATION"]) {
      expect(isRegistrationConfirmation(key), key).toBe(true);
    }
    for (const key of ["REGISTRATION_REACTIVATED", "PAYMENT_RECEIPT", "REFUND_NOTICE", "BALANCE_REMINDER", "WAITLIST_JOINED", "REGISTRATION_CANCELLED", "EVENT_ANNOUNCEMENT"]) {
      expect(isRegistrationConfirmation(key), key).toBe(false);
    }
  });

  it("the default confirmation template includes it through the payment status block", () => {
    const body = DEFAULT_MESSAGE_TEMPLATES.REGISTRATION_CONFIRMATION_PAID.body;
    expect(body).toContain("{{payment_status_block}}");
  });
});

const definition = registrationFormDefinitionSchema.parse({
  title: "Synthetic form",
  description: "Synthetic form.",
  confirmationMessage: "Received.",
  attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 5, attendeeLabel: "Person", addButtonLabel: "Add" },
  sections: [{ id: "details", title: "Details", description: "", fields: [
    { id: "first_field", key: "first_name", label: "First name", type: "TEXT", scope: "ATTENDEE", required: true, helpText: "", options: [] },
    { id: "last_field", key: "last_name", label: "Last name", type: "TEXT", scope: "ATTENDEE", required: true, helpText: "", options: [] },
  ] }],
});

function enqueueFixture(refundPolicy: string | null) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `message-${create.mock.calls.length}`, ...data }));
  const tx = {
    eventMessageSettings: { findUnique: vi.fn().mockResolvedValue({ deliveryMode: "LOCAL_CAPTURE", senderName: "IMSDA Events", senderEmail: "events@example.test", replyToEmail: "office@example.test", internalNotificationEmails: [] }) },
    eventMessageTemplate: { findMany: vi.fn().mockResolvedValue([]) },
    event: { findUnique: vi.fn().mockResolvedValue({ supportContact: "office@example.test", refundPolicy, paymentInstructionVersions: [] }) },
    registrationAttendee: { findMany: vi.fn().mockResolvedValue([{ id: "attendee-1" }]) },
    messageOutbox: { create, findMany: vi.fn().mockResolvedValue([]) },
    messageOutboxFile: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    messageTemplateVersionFile: { findMany: vi.fn().mockResolvedValue([]) },
    messageFile: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { tx, create };
}

const enqueueInput = (attendeeType: "ATTENDEE" | "WORKER"): RegistrationMessageInput => ({
  staffCopyEnabled: true,
  event: { id: "event-1", name: "Synthetic Retreat", slug: "synthetic-retreat", startsAt: new Date("2027-02-19T21:00:00.000Z"), endsAt: new Date("2027-02-21T17:00:00.000Z"), timezone: "America/Chicago", location: "Camp", billingMode: "ATTENDEE_PAY" },
  registration: { id: "registration-1", confirmationCode: "REG-TEST", attendeeType },
  formVersionId: "version-1",
  submissionIdempotencyKey: "2f0e3c1a-7a55-4c43-8e1c-2f6f6f4a9a10",
  identity: { firstName: "Pat", lastName: "Tester", email: "pat@example.test" } as RegistrationMessageInput["identity"],
  definition,
  responses: {},
  calculation: { subtotalCents: 5000, processingFeeCents: 0, totalCents: 5000, lineItems: [] },
});

describe("the confirmation sent at registration (#891)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("includes the refund policy in the registrant's text and HTML, for an attendee and a worker", async () => {
    for (const attendeeType of ["ATTENDEE", "WORKER"] as const) {
      const { tx, create } = enqueueFixture("Refunds until Oct. 1 (minus a $10 fee).");
      await enqueuePublicRegistrationMessages(tx as never, enqueueInput(attendeeType));
      const registrant = create.mock.calls.map(([call]) => call.data).find((data) => data.recipientKind === "REGISTRANT");
      expect(String(registrant?.bodyTextSnapshot), attendeeType).toContain("Refunds until Oct. 1 (minus a $10 fee).");
      expect(String(registrant?.bodyTextSnapshot)).not.toContain("\\");
      expect(String(registrant?.bodyHtmlSnapshot)).toContain("Refund policy");
    }
  });

  it("has no refund section when the event has no policy", async () => {
    const { tx, create } = enqueueFixture(null);
    await enqueuePublicRegistrationMessages(tx as never, enqueueInput("ATTENDEE"));
    const registrant = create.mock.calls.map(([call]) => call.data).find((data) => data.recipientKind === "REGISTRANT");
    expect(String(registrant?.bodyTextSnapshot)).not.toContain("Refund policy");
  });
});
