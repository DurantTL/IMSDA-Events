import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventRefundPolicy } from "@/components/event-refund-policy";
import { buildPaymentStatusBlock, buildRefundPolicyBlock } from "@/modules/communications/message-blocks";
import { hasRefundPolicy, refundPolicyParagraphs } from "@/modules/events/refund-policy";
import { eventSettingsInputSchema } from "@/modules/events/schemas";
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
    const block = buildRefundPolicyBlock("[Click](https://evil.example.test) ![x](https://evil.example.test/p.png)");
    expect(block).not.toMatch(/(^|[^\\])\[Click\]\(/);
    expect(block).not.toMatch(/(^|[^\\])!\[x\]/);
  });
});
