import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), notFound: vi.fn() }));
vi.mock("server-only", () => ({}));

import PublicManageNotFound from "@/app/(public)/manage/[token]/not-found";
import UnsubscribeNotFound from "@/app/(public)/unsubscribe/[token]/not-found";
import { AttendeeRegistrationContactForm } from "@/components/attendee-registration-contact-form";
import { PerPersonPriceNotice } from "@/components/per-person-price-notice";
import { PublicRegistrationForm } from "@/components/public-registration-form";
import { PublicRegistrationRecoveryForm } from "@/components/public-registration-recovery-form";
import { formatCalendarDate } from "@/modules/club-registrations/domain";
import { perPersonPrice } from "@/modules/club-registrations/per-person-price";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";

// Batch 3c of the UI recheck (#1005): wording, dates and the PBE public flow. Synthetic data only.
const read = (file: string) => readFileSync(file, "utf8");

describe("one written-out date for people, ISO kept for machines (item 1)", () => {
  it("writes the day out", () => {
    expect(formatCalendarDate("2026-10-17")).toBe("October 17, 2026");
  });

  it("uses the written-out date on Health, Orders and the order print", () => {
    for (const file of [
      "app/(public)/account/(portal)/clubs/[organizationId]/health/page.tsx",
      "app/(public)/account/(portal)/area/health/page.tsx",
      "app/(workspace)/more/event-health/page.tsx",
      "app/(public)/account/(portal)/clubs/[organizationId]/orders/print/page.tsx",
      "components/club-order-workspace.tsx",
    ]) expect(read(file), file).toContain("formatCalendarDate(");
    expect(read("app/(public)/account/(portal)/clubs/[organizationId]/orders/print/page.tsx")).toContain("formatCalendarDate(header.date)");
    expect(read("components/event-health-sheet.tsx")).toContain('month: "long"');
    expect(read("components/club-order-workspace.tsx")).toContain('dateStyle: "long"');
  });

  it("keeps ISO in the order list export and the header field", () => {
    expect(read("modules/club-orders/repository.ts")).toContain('date: now.toLocaleDateString("en-CA"');
    expect(read("modules/club-orders/domain.ts")).toContain('["Date", header.date]');
  });
});

describe("the PBE public event page (item 2)", () => {
  const page = read("app/(public)/events/[eventSlug]/page.tsx");

  it("puts the options first on a club event, with one director instruction and one help block", () => {
    expect(page).toContain("{autoCards && optionsLayout}");
    expect(page).toContain("{!autoCards && optionsLayout}");
    expect(page.indexOf("{autoCards && optionsLayout}")).toBeLessThan(page.indexOf("<EventInfoCards"));
    expect(page).not.toContain("CLUB_REGISTRATION_CARD_NOTE");
    expect(page).toContain("{!autoCards?.help && (");
    expect(page).not.toContain("use the email your club has on file");
  });

  it("numbers every option card the same way", () => {
    expect(page).not.toMatch(/public-event-form-number[^>]*><UsersRound/);
    expect(page).toContain("landing.forms.length + 1");
  });
});

const field = (key: string, options: { type?: string; scope?: "ATTENDEE" | "REGISTRATION"; required?: boolean; label?: string } = {}) => ({
  id: `f_${key}`, key, label: options.label ?? key, helpText: "", type: options.type ?? "TEXT",
  scope: options.scope ?? "REGISTRATION", required: options.required ?? false, options: [] as string[],
});

const teamDefinition = registrationFormDefinitionSchema.parse({
  title: "Synthetic team", description: "", confirmationMessage: "Received.",
  attendeeRoster: { enabled: true, minAttendees: 2, maxAttendees: 20, attendeeLabel: "Team member or coach", addButtonLabel: "Add another team member or coach" },
  sections: [
    { id: "s_people", title: "People", description: "", fields: [
      field("first_name", { scope: "ATTENDEE", required: true }),
      field("last_name", { scope: "ATTENDEE", required: true }),
      field("alternate", { scope: "ATTENDEE", type: "CHECKBOX", label: "Alternate team member" }),
    ] },
    { id: "s_contact", title: "Contact", description: "", fields: [
      field("email", { type: "EMAIL", required: true }),
      field("release", { type: "CHECKBOX", required: true, label: "Photo release" }),
    ] },
  ],
});

const event = {
  name: "Synthetic Bible Event", slug: "synthetic-bible-event", startsAt: "2027-01-17T15:00:00.000Z", endsAt: "2027-01-17T22:00:00.000Z",
  timezone: "America/Chicago", location: null, capacity: null, billingMode: "DEFERRED_ORGANIZATION_INVOICE" as const,
};
const lifecycle = { phase: "OPEN" as const, capacityDecision: "REGISTER" as const, remainingSpots: null, waitingRegistrations: 0 };
const form = { slug: "team:general", versionId: "v1", versionNumber: 1, definition: teamDefinition };
const group = (extra: Record<string, unknown> = {}) => ({
  submitUrl: "/api/public/events/synthetic-bible-event/general-registrations",
  locationId: null, honorSelections: {}, billingNotice: "There is no fee for this event.", noCost: true, teamName: "Synthetic Team", ...extra,
});
const render = (groupProps: Record<string, unknown>, definition = form) => renderToStaticMarkup(createElement(PublicRegistrationForm, {
  event, form: definition, choiceUsage: {}, pricingDate: "2026-10-15", lifecycle, disableDrafts: true, group: groupProps as ReturnType<typeof group>,
}));

describe("the PBE team step (item 3)", () => {
  it("reads as a team, with the right plural and the real team-size limits", () => {
    const markup = render(group({ teamLimits: { min: 2, max: 7 } }));
    expect(markup).toContain(">Team</p>");
    expect(markup).not.toContain("Household or group");
    expect(markup).toContain("A team has 2 to 7 team members.");
    expect(markup).toContain("coaches do not count toward the team (20 people at most)");
    expect(markup).not.toContain("coachs");
  });

  it("without team limits, says the roster count with a correct plural", () => {
    const markup = render(group({ teamName: null }));
    expect(markup).toContain("Add between 2 and 20 team members or coaches.");
    expect(markup).not.toContain("coachs");
  });

  it("shows no 'Needs attention' on a card nobody has touched, and the validation still blocks continuing", () => {
    const markup = render(group({ teamLimits: { min: 2, max: 7 } }));
    expect(markup).not.toContain("Needs attention");
    const source = read("components/public-registration-form.tsx");
    // The display state is only gated; continuing still runs the same validation first.
    expect(source).toContain("continueAttempted || touchedAttendeeIds.has(attendee.clientId)");
    expect(source).toMatch(/function continueRegistration\(\) \{\s*const stepIssues = allClientIssues\(\)/);
    expect(source).toContain("setContinueAttempted(true);");
  });

  it("shows an optional box like the alternate with a neutral status, not a red 'Not accepted yet'", () => {
    const source = read("components/public-registration-form.tsx");
    expect(source).toContain('optional: !field.required && field.type === "CHECKBOX"');
    expect(source).toContain('acknowledgement.optional ? "is-neutral"');
    expect(source).toContain('acknowledgement.optional ? "No" : "Not accepted yet"');
    expect(read("app/globals.css")).toMatch(/\.public-registration-review-acknowledgements li\.is-neutral \{/);
  });
});

describe("account registrations (item 4)", () => {
  it("says no cost to you when everyone is free, and keeps the church line", () => {
    const free = perPersonPrice({ lineItems: [], roster: true, attendeeCount: 3 });
    expect(free.notice).toBe("No cost to you. Your church is billed after the event.");
    expect(free.uniformAmountCents).toBe(0);
    expect(renderToStaticMarkup(createElement(PerPersonPriceNotice, { price: free }))).toContain("No cost to you. Your church is billed after the event.");
  });

  it("leaves real prices and fees as they are", () => {
    expect(perPersonPrice({ lineItems: [{ label: "Fee", amountCents: 2500, attendeeIndex: 0 }], roster: true, attendeeCount: 1 }).notice).toBe("$25 per person. Your church is billed after the event.");
    const withFee = perPersonPrice({ lineItems: [{ label: "Registration fee", amountCents: 5000 }], roster: true, attendeeCount: 2 });
    expect(withFee.notice).toBe("$0 per person. Your church is billed after the event.");
  });

  it("fills the registration contact box with the current contact", () => {
    const markup = renderToStaticMarkup(createElement(AttendeeRegistrationContactForm, {
      registrationId: "reg-1",
      initialContact: { firstName: "Sam", lastName: "Sample", email: "sam@example.test", phone: "" },
    }));
    expect(markup).toContain("Update registration contact");
    expect(markup).toContain("Sam Sample · sam@example.test");
  });
});

describe("Monthly Records (item 5)", () => {
  it("makes the month being viewed a badge, not a link styled as an action", () => {
    const source = read("app/(public)/account/(portal)/clubs/[organizationId]/records/page.tsx");
    expect(source).toContain('<span aria-current="page" className="count-badge records-viewing-badge">Viewing</span>');
    expect(source).not.toContain('"primary-button" : "secondary-button"');
  });
});

describe("invalid private-link pages (items 6 and 7)", () => {
  it("uses a mail icon, not a back arrow, for Contact IMSDA", () => {
    const markup = renderToStaticMarkup(createElement(PublicManageNotFound));
    expect(markup).toContain("Contact IMSDA");
    expect(markup).toContain("lucide-mail");
    expect(markup).not.toContain("lucide-arrow-left");
  });

  it("titles the staff invitation page as one", () => {
    const source = read("app/(public)/staff-invite/[token]/page.tsx");
    expect(source).toContain('title: "Staff invitation"');
    expect(source).not.toContain("Your registration link");
  });
});

describe("a bad unsubscribe link (item 8)", () => {
  it("explains what happened and offers sign-in, without saying whether an address or subscription exists", () => {
    const markup = renderToStaticMarkup(createElement(UnsubscribeNotFound));
    expect(markup).toContain("This unsubscribe link didn&#x27;t work");
    expect(markup).toContain("Nothing was changed.");
    expect(markup).toContain('href="/account/sign-in"');
    expect(markup).not.toMatch(/no (such )?(address|subscription)|not subscribed|unknown (address|email)|does not exist/i);
  });

  it("keeps the page's 404 contract: it still calls notFound()", () => {
    const source = read("app/(public)/unsubscribe/[token]/page.tsx");
    expect(source.match(/notFound\(\)/g)?.length).toBe(2);
  });
});

describe("Recover registration (item 9)", () => {
  it("labels the two email fields by their method", () => {
    const markup = renderToStaticMarkup(createElement(PublicRegistrationRecoveryForm, {}));
    expect(markup).toContain("Registration contact email (to use with your code)");
    expect(markup).toContain("Registration contact email (to get a link by email)");
    expect(markup.match(/Registration contact email\s*</g)).toBeNull();
  });
});
