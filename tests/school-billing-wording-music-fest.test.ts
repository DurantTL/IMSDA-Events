import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ChurchInvoiceNotice, ChurchInvoiceReviewFacts } from "@/components/church-invoice-notice";
import { PublicRegistrationForm } from "@/components/public-registration-form";
import { withAttendeeTypeOptions } from "@/modules/attendee-types/form-options";
import {
  CHURCH_BILLED_ORGANIZATION,
  billedOrganization,
  priceForBilledOrganization,
} from "@/modules/club-registrations/billed-organization";
import { churchInvoiceTerms } from "@/modules/club-registrations/church-invoice-terms";
import { ZERO_PER_PERSON_NOTICE, perPersonPrice } from "@/modules/club-registrations/per-person-price";
import { starterEventTemplates } from "@/modules/event-templates/starters";
import { calculateRosterLineItems, getFormTemplate, registrationFormDefinitionSchema, type RegistrationFormDefinition } from "@/modules/forms/definition";

/**
 * School-billed wording on the public Music Fest form: the summary and review
 * name the school, not a church, and never call an unpriced roster free. A
 * church-billed control keeps its church wording. Synthetic data only.
 */

/** The words a reader sees, without the markup's class names. */
const visibleText = (markup: string) => markup.replace(/<[^>]+>/g, " ");
const SCHOOL_FESTIVAL = "The school will be billed after the festival. No payment is due online.";
const SCHOOL_EVENT = "The school will be billed after the event. No payment is due online.";
const pricingDate = "2027-01-15";

const musicStarter = starterEventTemplates.find((entry) => entry.starterKey === "music_festival")!;
const musicFest = withAttendeeTypeOptions(
  getFormTemplate("music_festival")!.definition,
  musicStarter.attendeeTypes!.map((type) => ({ ...type, id: type.code })) as never,
);
const outdoorSchool = getFormTemplate("outdoor_school")!.definition;

const school = { responsible_organization: "Sample Academy", contact_name: "Pat Teacher", email: "school@example.test", phone: "(515) 555-0100" };
const dorm = { participant_type: "STUDENT_DORM", first_name: "Robin", last_name: "Sample" };
const day = { participant_type: "STUDENT_DAY", first_name: "Lee", last_name: "Sample" };
const teacher = { participant_type: "TEACHER_SPONSOR", first_name: "Ada", last_name: "Sponsor" };
const blank = { first_name: "", last_name: "" };

function rosterPrice(definition: RegistrationFormDefinition, attendees: Array<Record<string, unknown>>) {
  return perPersonPrice({
    lineItems: calculateRosterLineItems(definition, school, attendees, pricingDate),
    roster: true,
    attendeeCount: attendees.length,
    attendeeNames: attendees.map((attendee, index) => String(attendee.first_name || `Person ${index + 1}`)),
  });
}

const lifecycle = { phase: "OPEN" as const, capacityDecision: "REGISTER" as const, remainingSpots: null, waitingRegistrations: 0 };
function renderForm(definition: RegistrationFormDefinition, eventName: string) {
  return renderToStaticMarkup(createElement(PublicRegistrationForm, {
    event: {
      name: eventName, slug: "synthetic-event", startsAt: "2027-04-08T15:00:00.000Z", endsAt: "2027-04-10T22:00:00.000Z",
      timezone: "America/Chicago", location: null, capacity: null, billingMode: "DEFERRED_ORGANIZATION_INVOICE" as const,
    },
    form: { slug: "synthetic-registration", versionId: "v1", versionNumber: 1, definition },
    choiceUsage: {}, pricingDate, lifecycle, disableDrafts: true,
  }));
}

const field = (key: string, extra: Record<string, unknown> = {}) => ({
  id: `f_${key}`, key, label: key, helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] as string[], ...extra,
});
/** A synthetic bill-later form whose responsible organization is a church (or a school), with one attendee fee. */
function synthetic(recipient: Record<string, unknown>, feeCents?: number, attendeeLabel = "Person") {
  return registrationFormDefinitionSchema.parse({
    title: "Synthetic retreat registration", description: "", confirmationMessage: "Received.",
    attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 10, attendeeLabel, addButtonLabel: "Add a person" },
    sections: [
      { id: "s_org", title: "Organization", description: "", fields: [recipient, field("email", { type: "EMAIL", required: true })] },
      { id: "s_people", title: "People", description: "", fields: [
        field("first_name", { scope: "ATTENDEE", required: true }),
        field("last_name", { scope: "ATTENDEE", required: true }),
        field("registration_fee", { type: "CALCULATED", scope: "ATTENDEE", label: "Registration fee", ...(feeCents ? { priceCents: feeCents } : {}) }),
      ] },
    ],
  });
}
const churchField = field("church_name", { type: "SELECT", label: "Church", optionSource: "CHURCHES_DIRECTORY", required: true });
const schoolField = field("responsible_organization", { label: "School name", required: true });

describe("who the bill-later wording names", () => {
  it("names the school on the Music Festival and Outdoor School forms, from their School name question", () => {
    expect(billedOrganization(musicFest, { eventName: "Music Fest 2027" })).toEqual({ kind: "SCHOOL", eventNoun: "festival" });
    expect(billedOrganization(outdoorSchool, { eventName: "Outdoor School 2027" })).toEqual({ kind: "SCHOOL", eventNoun: "event" });
  });

  it("keeps church wording for a church-billed form, even on a GENERAL bill-later event", () => {
    expect(billedOrganization(synthetic(churchField), { eventName: "Synthetic Retreat" })).toEqual(CHURCH_BILLED_ORGANIZATION);
    expect(billedOrganization(getFormTemplate("tlt_retreat")!.definition)).toEqual(CHURCH_BILLED_ORGANIZATION);
    // A responsible organization that is not labeled as a school is not read as one.
    expect(billedOrganization(synthetic(field("responsible_organization", { label: "Church or organization" })))).toEqual(CHURCH_BILLED_ORGANIZATION);
    // The Outdoor School and Music Festival starters share audience and billing mode with church events, so neither decides it.
    expect(musicStarter).toMatchObject({ audience: "GENERAL", billingMode: "DEFERRED_ORGANIZATION_INVOICE" });
  });
});

describe("Music Fest order summary and review wording", () => {
  it("says the school is billed, not the church, and never 'No cost to you' on the initial roster", () => {
    const markup = renderForm(musicFest, "Music Fest 2027");
    expect(markup).toContain(SCHOOL_FESTIVAL);
    expect(markup).not.toContain("No cost to you");
    expect(markup).not.toContain("Your church is billed");
    expect(markup).not.toContain("your church will be invoiced");
  });

  it("does not call an attendee with no type chosen yet free", () => {
    const price = priceForBilledOrganization(rosterPrice(musicFest, [blank]), billedOrganization(musicFest, { eventName: "Music Fest 2027" }));
    expect(price.notice).toBe(SCHOOL_FESTIVAL);
    expect(price.attendeeLines).toEqual([]);
  });

  it("keeps the per-person amount when everyone costs the same", () => {
    const price = priceForBilledOrganization(rosterPrice(musicFest, [dorm, { ...dorm, first_name: "Kai" }]), billedOrganization(musicFest, { eventName: "Music Fest 2027" }));
    expect(price.notice).toBe(`$50 per person. ${SCHOOL_FESTIVAL}`);
    expect(price.uniformAmountCents).toBe(5000);
  });

  it("lists each person's price on a mixed roster, in the summary and on the review step", () => {
    const billed = billedOrganization(musicFest, { eventName: "Music Fest 2027" });
    const price = rosterPrice(musicFest, [dorm, day, teacher, blank]);
    expect(priceForBilledOrganization(price, billed).notice).toBe(`Prices are per person. ${SCHOOL_FESTIVAL}`);
    // Music Fest prices by attendee type, so there is no flat-rate sentence: the per-person notice is the path used.
    expect(churchInvoiceTerms(musicFest, { pricingDate })).toBeNull();
    const markup = renderToStaticMarkup(createElement(ChurchInvoiceNotice, { terms: null, price, billed }));
    expect(markup).toContain(`Prices are per person. ${SCHOOL_FESTIVAL}`);
    expect(markup).toContain("Robin: <span translate=\"no\">$50</span> per person");
    expect(markup).toContain("Lee: <span translate=\"no\">$40</span> per person");
    expect(markup).toContain("Ada: <span translate=\"no\">$0</span> per person");
    expect(visibleText(markup)).not.toMatch(/church/i);
  });

  it("shows the school as the invoice recipient on the review step, with a school fallback", () => {
    const billed = billedOrganization(musicFest, { eventName: "Music Fest 2027" });
    const named = renderToStaticMarkup(createElement(ChurchInvoiceReviewFacts, { recipient: "Sample Academy", billed }));
    expect(named).toContain("No payment due online");
    expect(named).toContain("Sample Academy");
    expect(named).toContain("The school will be billed after the festival.");
    expect(visibleText(named)).not.toMatch(/church/i);
    expect(renderToStaticMarkup(createElement(ChurchInvoiceReviewFacts, { recipient: null, billed }))).toContain("Your school");
  });

  it("names the school in the flat-rate sentence when a school form has one plain fee", () => {
    const def = synthetic(schoolField, 900, "Student");
    const billed = billedOrganization(def, { eventName: "Synthetic Music Festival" });
    const terms = churchInvoiceTerms(def, { pricingDate, attendeeLabel: "Student" });
    expect(terms?.rateSentence).toBe("$9 per student.");
    const price = perPersonPrice({ lineItems: [0, 1].map((attendeeIndex) => ({ label: "Registration fee", amountCents: 900, attendeeIndex })), roster: true, attendeeCount: 2 });
    const markup = renderToStaticMarkup(createElement(ChurchInvoiceNotice, { terms, price, billed }));
    expect(markup).toContain("$9 per student.");
    expect(markup).toContain(SCHOOL_FESTIVAL);
    expect(visibleText(markup)).not.toMatch(/church/i);
  });

  it("uses the same wording on the confirmation's price notice", () => {
    const source = readFileSync("components/public-registration-form.tsx", "utf8");
    expect(source).toContain("priceForBilledOrganization(confirmation.perPerson ??");
    expect(source).toContain("{!waitlisted && billed.kind !== \"SCHOOL\" && <p className=\"public-registration-review-waitlist\">No payment is due online.</p>}");
    expect(source).toContain("<ChurchInvoiceNotice terms={shownInvoiceTerms} price={perPerson} billed={billed} className=\"public-registration-summary-lines\" />");
    expect(source).toContain("<ChurchInvoiceNotice terms={shownInvoiceTerms} price={perPerson} billed={billed} className=\"public-registration-review-lines\" />");
  });
});

describe("Outdoor School shares the school wording", () => {
  it("says the school is billed after the event", () => {
    const markup = renderForm(outdoorSchool, "Outdoor School 2027");
    expect(markup).toContain(SCHOOL_EVENT);
    expect(markup).not.toContain("No cost to you");
    expect(markup).not.toContain("Your church is billed");
  });
});

describe("church-billed control", () => {
  it("keeps the church wording and prices exactly as before", () => {
    const def = synthetic(churchField);
    const markup = renderForm(def, "Synthetic Retreat");
    expect(markup).toContain(ZERO_PER_PERSON_NOTICE);
    expect(markup).not.toContain("The school will be billed");
    const price = perPersonPrice({ lineItems: [0, 1].map((attendeeIndex) => ({ label: "Registration fee", amountCents: 2500, attendeeIndex })), roster: true, attendeeCount: 2 });
    expect(priceForBilledOrganization(price, billedOrganization(def))).toBe(price);
    expect(price.notice).toBe("$25 per person. Your church is billed after the event.");
    expect(renderToStaticMarkup(createElement(ChurchInvoiceReviewFacts, { recipient: null }))).toContain("Your church");
  });

  it("keeps the church flat-rate sentence", () => {
    const def = synthetic(churchField, 900);
    const terms = churchInvoiceTerms(def, { pricingDate });
    const price = perPersonPrice({ lineItems: [{ label: "Registration fee", amountCents: 900, attendeeIndex: 0 }], roster: true, attendeeCount: 1 });
    const markup = renderToStaticMarkup(createElement(ChurchInvoiceNotice, { terms, price, billed: billedOrganization(def) }));
    expect(markup).toContain("your church will be invoiced after the event");
  });
});
