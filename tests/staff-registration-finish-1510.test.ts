import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { PublicRegistrationForm } from "@/components/public-registration-form";
import { staffSubmitExtras, staffSubmitFieldErrors, type StaffSubmitConfig } from "@/components/staff-submit-panel";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { definitionWithoutCardOption } from "@/modules/payments/online-card-fee";
import { staffDraftStatusLabel } from "@/modules/staff-registration-drafts/domain";

/** The staff finish form (#1510): staff mode hides signatures and card choices and adds the paper location and the override. Synthetic data only. */
const field = (key: string, type: string, extra: Record<string, unknown> = {}) => ({
  id: `f_${key}`, key, label: key.replaceAll("_", " "), helpText: "", type, scope: "REGISTRATION", required: false, options: [] as string[], ...extra,
});
const definition = registrationFormDefinitionSchema.parse({
  title: "Synthetic camp", description: "", confirmationMessage: "Received.",
  payment: { enabled: true, currency: "USD", paymentMethodFieldKey: "payment_method", cardOptionValue: "Credit / debit card", percentageBasisPoints: 290, fixedFeeCents: 30, passFeeToRegistrant: true },
  sections: [{ id: "s_main", title: "Details", description: "", fields: [
    field("first_name", "TEXT", { scope: "ATTENDEE", required: true }),
    field("last_name", "TEXT", { scope: "ATTENDEE", required: true }),
    field("email", "EMAIL", { required: true }),
    field("agreement", "ACKNOWLEDGMENT", { required: true, acknowledgment: { source: "TEXT", text: "Synthetic acknowledgment wording." } }),
    field("typed_signature", "SIGNATURE", { required: true, signature: { text: "Synthetic signature statement." } }),
    field("payment_method", "RADIO", { required: true, options: ["Pay later", "Credit / debit card"] }),
  ] }],
});
const event = { name: "Synthetic Camp", slug: "synthetic-camp", startsAt: "2026-12-05T15:00:00.000Z", endsAt: "2026-12-06T22:00:00.000Z", timezone: "America/Chicago", location: null, capacity: null, billingMode: "ATTENDEE_PAY" as const };
const lifecycle = { phase: "OPEN" as const, capacityDecision: "REGISTER" as const, remainingSpots: null, waitingRegistrations: 0 };
const staffSubmit = (extra: Partial<StaffSubmitConfig> = {}): StaffSubmitConfig => ({
  submitUrl: "/api/events/evt-1/staff-registration-drafts/draft-1/submit",
  sourceLabel: "Paper form",
  source: "PAPER",
  paperLocationHelp: "Enter where the paper form is kept. Never write what the paper says.",
  canOverride: false,
  overrideRule: null,
  returnHref: "/people/staff-drafts?event=evt-1",
  returnLabel: "Phone and paper registrations",
  ...extra,
});
const render = (staff?: StaffSubmitConfig, form = definition) => renderToStaticMarkup(createElement(PublicRegistrationForm, {
  event, form: { slug: "camp", versionId: "v1", versionNumber: 1, definition: form }, choiceUsage: {}, pricingDate: "2026-10-15", lifecycle, disableDrafts: true,
  ...(staff ? { staffSubmit: staff } : {}),
}));

describe("the staff finish form", () => {
  it("names the source and that the registration is sent for the registrant", () => {
    const html = render(staffSubmit());
    expect(html).toContain("You&#x27;re sending this registration for the registrant. Source: Paper form.");
  });

  it("hides typed signatures, but a public render still shows them", () => {
    expect(render(staffSubmit())).not.toContain("Synthetic signature statement.");
    expect(render()).toContain("Synthetic signature statement.");
  });

  it("hides the card choice once the page strips it, as the server does", () => {
    const stripped = definitionWithoutCardOption(definition);
    const html = render(staffSubmit(), stripped);
    expect(html).not.toContain("Credit / debit card");
    expect(html).toContain("Pay later");
  });

  it("notes beside an acknowledgment that it is recorded as entered by staff", () => {
    const html = render(staffSubmit());
    expect(html).toContain("Tick an acknowledgment only if the person agreed.");
    expect(html).toContain("not as their own online agreement.");
    expect(render()).not.toContain("Tick an acknowledgment only if the person agreed.");
  });

  it("asks for where the paper form is kept only for a paper source, with the policy help text", () => {
    const paper = render(staffSubmit());
    expect(paper).toContain("Where the paper form is kept");
    expect(paper).toContain("Never write what the paper says.");
    expect(render(staffSubmit({ source: "PHONE", sourceLabel: "Phone" }))).not.toContain("Where the paper form is kept");
  });

  it("shows the reason box naming the rule only when a rule applies and the person may override", () => {
    const withRule = render(staffSubmit({ canOverride: true, overrideRule: "Registration is closed for this event." }));
    expect(withRule).toContain("Reason for going past this rule");
    expect(withRule).toContain("Registration is closed for this event.");
    expect(render(staffSubmit({ canOverride: true }))).not.toContain("Reason for going past this rule");
    expect(render(staffSubmit({ canOverride: false, overrideRule: "Registration is closed for this event." }))).not.toContain("Reason for going past this rule");
  });

  it("has no security check, browser draft notice or account offer", () => {
    const html = render(staffSubmit());
    expect(html).not.toMatch(/Security check|cf-turnstile/i);
    expect(html).not.toContain("Secure event registration");
  });
});

describe("what a staff submit sends", () => {
  it("adds the trimmed paper location for a paper source and none otherwise", () => {
    expect(staffSubmitExtras({ source: "PAPER" }, "  Binder A  ", null, "")).toEqual({ paperLocation: "Binder A" });
    expect(staffSubmitExtras({ source: "PHONE" }, "Binder A", null, "")).toEqual({});
  });

  it("adds the override with a trimmed reason only when a rule applies", () => {
    expect(staffSubmitExtras({ source: "WALK_IN" }, "", "Registration is closed for this event.", "  Phoned after the deadline.  ")).toEqual({ override: { reason: "Phoned after the deadline." } });
    expect(staffSubmitExtras({ source: "WALK_IN" }, "", null, "A reason nobody asked for.")).toEqual({});
  });

  it("refuses a missing paper location and a reason outside 10 to 500 characters before sending", () => {
    const config = { source: "PAPER" as const, paperLocationHelp: "Where it is kept." };
    expect(staffSubmitFieldErrors(config, " ", null, "")).toEqual({ paperLocation: "Where it is kept." });
    expect(staffSubmitFieldErrors(config, "Binder", "Closed.", "short").reason).toMatch(/10 to 500/);
    expect(staffSubmitFieldErrors(config, "Binder", "Closed.", "x".repeat(501)).reason).toMatch(/10 to 500/);
    expect(staffSubmitFieldErrors(config, "Binder", "Closed.", "A good enough reason.")).toEqual({});
  });
});

describe("the draft status in words", () => {
  it("names the staff member for a registration staff sent, and keeps the registrant wording otherwise", () => {
    expect(staffDraftStatusLabel("SUBMITTED", "Alex Staff")).toBe("Sent by staff (Alex Staff)");
    expect(staffDraftStatusLabel("SUBMITTED", null)).toBe("Submitted by registrant");
    expect(staffDraftStatusLabel("HANDED_OFF", "Alex Staff")).toBe("Sent to registrant");
  });
});
