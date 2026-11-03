// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cancellationRequestEdited } from "@/components/cancellation-request-panel";
import { contactEdited } from "@/components/public-registration-contact-form";

/** #1468 round 3f: the public contact and cancellation request forms. Synthetic data only. */

const saved = { firstName: "Sample", lastName: "Person", email: "sample@example.org", phone: "(515) 555-0100" };

describe("contactEdited", () => {
  it("is clean when opened and when a changed field is changed back", () => {
    expect(contactEdited(saved, saved)).toBe(false);
    expect(contactEdited({ ...saved, firstName: "Other" }, saved)).toBe(true);
    expect(contactEdited({ ...saved, firstName: "Sample" }, saved)).toBe(false);
  });
  it("ignores phone formatting and edge spaces", () => {
    expect(contactEdited({ ...saved, phone: "515-555-0100" }, saved)).toBe(false);
    expect(contactEdited({ ...saved, email: " sample@example.org " }, saved)).toBe(false);
  });
  it("counts a different phone, email or last name", () => {
    expect(contactEdited({ ...saved, phone: "(515) 555-0111" }, saved)).toBe(true);
    expect(contactEdited({ ...saved, email: "new@example.org" }, saved)).toBe(true);
    expect(contactEdited({ ...saved, lastName: "Else" }, saved)).toBe(true);
  });
});

describe("cancellationRequestEdited", () => {
  const clean = {
    available: true, scope: "FULL_REGISTRATION" as const, baselineScope: "FULL_REGISTRATION" as const,
    attendeeCount: 0, chargeCount: 0, outcomeShown: false, reason: "", contactMethod: "EMAIL" as const, replaceConfirmed: false,
  };
  it("is clean when opened, or when no request can be made", () => {
    expect(cancellationRequestEdited(clean)).toBe(false);
    expect(cancellationRequestEdited({ ...clean, available: false, reason: "x", outcomeShown: true })).toBe(false);
  });
  it("counts a changed choice and ticked options for the chosen scope only", () => {
    expect(cancellationRequestEdited({ ...clean, scope: "ATTENDEE" })).toBe(true);
    expect(cancellationRequestEdited({ ...clean, attendeeCount: 2 })).toBe(false);
    expect(cancellationRequestEdited({ ...clean, scope: "ATTENDEE", baselineScope: "ATTENDEE", attendeeCount: 1 })).toBe(true);
    expect(cancellationRequestEdited({ ...clean, scope: "COMPONENT", baselineScope: "COMPONENT", chargeCount: 1 })).toBe(true);
    expect(cancellationRequestEdited({ ...clean, scope: "COMPONENT", baselineScope: "COMPONENT", attendeeCount: 1 })).toBe(false);
  });
  it("counts a typed reason, phone or replace box only while the outcome is shown", () => {
    expect(cancellationRequestEdited({ ...clean, reason: "Plans changed" })).toBe(false);
    expect(cancellationRequestEdited({ ...clean, outcomeShown: true, reason: "  " })).toBe(false);
    expect(cancellationRequestEdited({ ...clean, outcomeShown: true, reason: "Plans changed" })).toBe(true);
    expect(cancellationRequestEdited({ ...clean, outcomeShown: true, contactMethod: "PHONE" })).toBe(true);
    expect(cancellationRequestEdited({ ...clean, outcomeShown: true, replaceConfirmed: true })).toBe(true);
  });
});

describe("both public forms mount the guard", () => {
  it.each(["components/public-registration-contact-form.tsx", "components/cancellation-request-panel.tsx"])("%s", (path) => {
    expect(readFileSync(join(__dirname, "..", path), "utf8")).toMatch(/useUnsavedChangesGuard\(/);
  });
});
