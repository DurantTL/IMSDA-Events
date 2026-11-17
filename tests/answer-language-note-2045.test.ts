import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ANSWER_LANGUAGE_NOTE, PublicRegistrationForm } from "@/components/public-registration-form";
import type { StaffSubmitConfig } from "@/components/staff-submit-panel";
import { getFormTemplate } from "@/modules/forms/definition";

// #2045 (Caleb, Nov 17, 2026): every public registration form says at the top that answers may be in English or
// Spanish. Plain text a browser translates (T1): no translate="no" and no lang marker on it. Staff entering a
// registration for someone don't see it.
function renderForm(staffSubmit?: StaffSubmitConfig) {
  const template = getFormTemplate("honors_weekend");
  if (!template) throw new Error("honors_weekend template missing");
  return renderToStaticMarkup(createElement(PublicRegistrationForm, {
    event: {
      name: "Synthetic Spring Weekend",
      slug: "synthetic-spring-weekend",
      startsAt: "2027-03-12T22:00:00.000Z",
      endsAt: "2027-03-14T17:00:00.000Z",
      timezone: "America/Chicago",
      location: "Fictitious Camp",
      capacity: null,
      registrationOpensOn: null,
      registrationClosesOn: null,
      waitlistEnabled: false,
      billingMode: "ATTENDEE_PAYMENT",
      ageOfMajority: 18,
    } as never,
    form: { slug: "registration", versionId: "v1", versionNumber: 1, definition: structuredClone(template.definition) },
    choiceUsage: {},
    pricingDate: "2027-01-01",
    lifecycle: { phase: "OPEN", capacityDecision: "REGISTER", remainingSpots: null, waitingRegistrations: 0 },
    disableDrafts: true,
    staffSubmit,
  }));
}

describe("the answer-language line on public registration forms (#2045)", () => {
  it("is the approved wording", () => {
    expect(ANSWER_LANGUAGE_NOTE).toBe("You may answer in English or Spanish.");
  });

  it("is shown once, as plain intro text right under the form title", () => {
    const markup = renderForm();
    expect(markup.split(ANSWER_LANGUAGE_NOTE)).toHaveLength(2);
    expect(markup).toMatch(new RegExp(`<section class="public-registration-intro">.*?</h2><p>${ANSWER_LANGUAGE_NOTE.replace(/\./g, "\\.")}</p>`));
  });

  it("is not shown when staff enter a registration for someone", () => {
    const markup = renderForm({
      submitUrl: "/api/events/e1/staff-registration-drafts/d1/submit",
      sourceLabel: "Phone",
      source: "PHONE",
      paperLocationHelp: "Where the paper form is kept.",
      canOverride: false,
      overrideRule: null,
      returnHref: "/people",
      returnLabel: "Back",
    });
    expect(markup).not.toContain(ANSWER_LANGUAGE_NOTE);
  });

  it("stays translatable: no translate=\"no\" or lang marker on the line", () => {
    const source = readFileSync(path.resolve(__dirname, "../components/public-registration-form.tsx"), "utf8");
    expect(source).toContain("{!staffSubmit && <p>{ANSWER_LANGUAGE_NOTE}</p>}");
  });
});
