import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildMerchandiseReceiptBlock } from "@/modules/communications/message-blocks";
import { DEFAULT_MESSAGE_TEMPLATES, renderMessageTemplate, validateMessageTemplate } from "@/modules/communications/templates";
import { REGISTRATION_MANAGE_LINK_SENTINEL } from "@/modules/communications/manage-link";
import { REQUIRED_READINESS_TEMPLATE_KEYS } from "@/modules/events/event-readiness-report";

const lines = [
  { productName: "Camp Shirt", variantLabel: "Adult M", quantity: 2, lineTotalCents: 4000 },
  { productName: "Water Bottle", variantLabel: "One size", quantity: 1, lineTotalCents: 1200 },
];

function render(methodLine: string, extra: { feeCents?: number; taxCents?: number; comped?: boolean } = {}) {
  const block = buildMerchandiseReceiptBlock({ receiptNumber: "M-0012", dateText: "March 2, 2027", lines, feeCents: extra.feeCents ?? 0, taxCents: extra.taxCents ?? 0, totalCents: 5200 + (extra.feeCents ?? 0) + (extra.taxCents ?? 0), methodLine, comped: extra.comped });
  const template = DEFAULT_MESSAGE_TEMPLATES.MERCHANDISE_RECEIPT;
  return renderMessageTemplate(
    { subject: template.subject, preheader: null, body: template.body },
    {
      recipient_name: "Avery Guest", event_name: "Sample Men's Camp 2027", confirmation_code: "REG-DEMO123", contact_email: "office@example.test",
      portal_url: REGISTRATION_MANAGE_LINK_SENTINEL, merchandise_receipt_block: block,
    },
  );
}

describe("merchandise receipt template (#148)", () => {
  it("is a valid default and not a readiness requirement", () => {
    expect(validateMessageTemplate(DEFAULT_MESSAGE_TEMPLATES.MERCHANDISE_RECEIPT).isValid).toBe(true);
    expect(REQUIRED_READINESS_TEMPLATE_KEYS as readonly string[]).not.toContain("MERCHANDISE_RECEIPT");
  });

  it("renders a cash receipt in HTML and text with lines, total, receipt number, date and the private link", () => {
    const rendered = render("Cash");
    expect(rendered.isComplete).toBe(true);
    expect(rendered.subject).toBe("Merchandise receipt: Sample Men's Camp 2027 (REG-DEMO123)");
    for (const text of [rendered.body, rendered.bodyHtml]) {
      expect(text).toContain("Camp Shirt");
      expect(text).toContain("Adult M");
      expect(text).toContain("$40.00");
      expect(text).toContain("$52.00");
      expect(text).toContain("M-0012");
      expect(text).toContain("March 2, 2027");
      expect(text).toContain("Cash");
    }
    expect(rendered.body).toContain(REGISTRATION_MANAGE_LINK_SENTINEL);
    expect(rendered.bodyHtml).toContain("<h3");
    expect(rendered.bodyHtml).toContain("<li ");
    expect(rendered.bodyHtml).toContain(REGISTRATION_MANAGE_LINK_SENTINEL);
    expect(rendered.body).not.toMatch(/\{\{|\\/);
  });

  it("shows a check number, a Square reference and a comp wording", () => {
    expect(render("Check #1042").body).toContain("Check #1042");
    expect(render("Check #1042").bodyHtml).toContain("Check #1042");
    expect(render("Card (Square), ref SQ-RCPT-77").body).toContain("Card (Square), ref SQ-RCPT-77");
    const comped = render("Comped — no charge", { comped: true });
    expect(comped.body).toContain("Comped — no charge");
    expect(comped.bodyHtml).toContain("Comped — no charge");
    for (const text of [comped.body, comped.bodyHtml]) {
      expect(text).toContain("$0.00");
      expect(text).toContain("comped; items valued at $52.00");
    }
    expect(comped.body).not.toContain("Total:** $52.00");
  });

  it("shows fee and tax only when nonzero", () => {
    expect(render("Cash").body).not.toMatch(/fee|tax/i);
    const withExtras = render("Cash", { feeCents: 150, taxCents: 100 });
    expect(withExtras.body).toContain("Processing fee: $1.50");
    expect(withExtras.body).toContain("Tax: $1.00");
    expect(withExtras.body).toContain("$54.50");
  });

  it("carries no registration charges or balance", () => {
    const rendered = render("Cash");
    expect(rendered.body).not.toMatch(/balance|registration total|payment status|refund policy/i);
    expect(DEFAULT_MESSAGE_TEMPLATES.MERCHANDISE_RECEIPT.body).not.toMatch(/total_amount|balance_amount|payment_status_block/);
  });

  it("neutralises markup typed into a product name or reference", () => {
    const block = buildMerchandiseReceiptBlock({ receiptNumber: "M-1", dateText: "March 2, 2027", lines: [{ productName: "[Click](https://evil.example)", variantLabel: "M", quantity: 1, lineTotalCents: 100 }], feeCents: 0, taxCents: 0, totalCents: 100, methodLine: "Check #<b>1" });
    const template = DEFAULT_MESSAGE_TEMPLATES.MERCHANDISE_RECEIPT;
    const rendered = renderMessageTemplate({ subject: template.subject, preheader: null, body: template.body }, {
      recipient_name: "A", event_name: "E", confirmation_code: "C", contact_email: "o@example.test", portal_url: REGISTRATION_MANAGE_LINK_SENTINEL, merchandise_receipt_block: block,
    });
    expect(rendered.bodyHtml).not.toContain("evil.example\"");
    expect(rendered.bodyHtml).not.toContain("<b>");
  });
});
