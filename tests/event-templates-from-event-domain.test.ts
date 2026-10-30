import { describe, expect, it } from "vitest";
import type { SourceConfiguration } from "@/modules/event-clones/domain";
import { cloneNeverCopied } from "@/modules/event-clones/domain";
import { eventTemplatePayloadSchema, validateEventTemplatePayloadReferences, EventTemplateReferenceError } from "@/modules/event-templates/domain";
import {
  buildTemplateFromEvent,
  saveTemplateFromEventInputSchema,
  saveTemplateRequestInputOf,
} from "@/modules/event-templates/from-event-domain";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { operationalReportKinds } from "@/modules/reporting/operational-reports";
import { templateMealsFromDefinitions } from "@/modules/meals/clone-domain";

const origins = ["https://events.imsda.test"];
const SECRET = "SYNTHETICTOKEN0123456789";
const manageLink = `https://events.imsda.test/manage/${SECRET}`;

function formDefinition() {
  return registrationFormDefinitionSchema.parse({
    title: "Synthetic retreat form",
    description: `Questions? Use your private link ${manageLink} any time.`,
    confirmationMessage: "Received.",
    attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 5 },
    sections: [{
      id: "sec_one", title: "Everything", description: "", fields: [
        { id: "f_first", key: "first_name", label: "First name", type: "TEXT", scope: "ATTENDEE", required: true, options: [], helpText: `See ${manageLink}` },
        { id: "f_last", key: "last_name", label: "Last name", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
        { id: "f_meal", key: "extra_meal", label: "Extra meal", type: "CHECKBOX", scope: "REGISTRATION", required: false, options: [], priceCents: 1500, latePricing: { startsOn: "2027-04-01", label: "Late pricing", priceCents: 2000 } },
        { id: "f_ack", key: "policy_ack", label: "Camp policy", type: "ACKNOWLEDGMENT", scope: "REGISTRATION", required: true, options: [], acknowledgment: { source: "POLICY_VERSION", policyVersionId: "policy-version-9" } },
      ],
    }],
  });
}

function source(overrides: Partial<SourceConfiguration> = {}): SourceConfiguration {
  return {
    event: { id: "event-src", name: "Synthetic Retreat 2027", slug: "synthetic-retreat-2027", startsOn: "2027-05-05", endsOn: "2027-05-07", isPublished: true },
    eventDetails: {
      location: "Synthetic Lodge", timezone: "America/Chicago",
      publicInfoUrl: `https://events.imsda.test/e/synthetic-retreat-2027?token=${SECRET}`, supportContact: "Synthetic Office (515) 555-0100",
      tagline: "A tagline", subtitle: null, helpEmail: "help@example.test", refundPolicy: "Synthetic refund policy.", calendarCategory: "Retreats", showOnCalendar: true,
      hotelName: "Synthetic Inn", hotelBookingUrl: "https://example.test/book", hotelPhone: null, hotelGroupName: null, hotelRate: null, hotelInstructions: null,
      audience: "GENERAL", billingMode: "ATTENDEE_PAY",
    },
    moduleToggles: {
      waitlistEnabled: true, autoPromoteWaitlist: true, collectsShirtSizes: true, checksAdultBackgrounds: false, hostedPaymentLinkEnabled: false,
      community: { isEnabled: true, allowNewPosts: true, allowReplies: true, conductText: "Be kind.", retentionDays: 30 },
    },
    contentSections: [{ kind: "RICH_TEXT", title: "Welcome", body: "Text", position: 1, links: [], assetLinkCount: 0 }],
    registrationForms: [{ formId: "form-1", name: "Retreat form", slug: "retreat-form", versionId: "form-version-4", versionNumber: 4, definition: formDefinition() }],
    formsWithoutPublishedVersion: 2,
    attendeeTypes: [{ code: "ADULT", label: "Adult", description: "", sortOrder: 0, isActive: true, minimumAge: 18, maximumAge: null }],
    attendeeClassifications: [{ kind: "CATEGORY", code: "GUEST", label: "Guest", description: "", sortOrder: 0, isActive: true }],
    messageTemplates: [
      { key: "EVENT_ANNOUNCEMENT", isEnabled: true, versionId: "mv-1", versionNumber: 2, subjectTemplate: "News from {{event_name}}", bodyTemplate: `Hi {{recipient_name}}. Manage: ${manageLink}` },
      { key: "ACCOUNT_ACTIVATION", isEnabled: true, versionId: "mv-2", versionNumber: 1, subjectTemplate: "Activate", bodyTemplate: "Account only." },
    ],
    messageTemplatesWithoutPublishedVersion: 1,
    tags: [{ name: "VIP", normalizedName: "vip", color: "#000000", description: "", isActive: true }],
    promoCodes: [
      { id: "promo-1", code: "EARLY", normalizedCode: "EARLY", discountType: "FIXED_CENTS", discountValue: 500, startsOn: "2027-01-10", endsOn: "2027-02-10", minimumSubtotalCents: null, maximumUses: null, maximumDiscountCents: null },
    ],
    meals: {
      services: [
        { name: "Friday supper", mealType: "SUPPER", serviceDate: "2027-05-07", startTime: "18:00", endTime: null, location: null, ticketing: "TICKETED", capacity: null, position: 1 },
        { name: "Last year breakfast", mealType: "BREAKFAST", serviceDate: "2026-05-07", startTime: "07:00", endTime: null, location: null, ticketing: "TICKETED", capacity: null, position: 2 },
      ],
      plans: [{
        code: "FULL", name: "Full plan", description: "", payer: "ATTENDEE", isDefaultTicketPlan: true, includesAllServices: false, defaultEntitlement: "PAID", position: 1,
        services: [{ serviceName: "Friday supper", serviceDate: "2027-05-07", entitlement: "PAID" }, { serviceName: "Last year breakfast", serviceDate: "2026-05-07", entitlement: "PAID" }],
        prices: [{ mealType: "SUPPER", ageGroup: "ADULT", attendeeTypeCode: null, amountCents: 1200 }],
      }],
    },
    locations: [
      { name: "North Site", address: "1 Synthetic Road", capacity: 40, sortOrder: 0, firstDay: "2027-05-06", lastDay: "2027-05-07", registrationClosesOn: "2027-05-01", coordinatorAccountId: "account-coordinator-1" },
    ],
    honorSessions: [], honorRooms: [], honorOfferings: [],
    unsupported: { merchandiseProducts: 3, paymentInstructionVersions: 1, messageDeliverySettings: 1, uploadedFiles: 2 },
    ...overrides,
  };
}

function build(config = source(), generalRegistrationLink = false) {
  return buildTemplateFromEvent({ config, generalRegistrationLink }, origins);
}

describe("buildTemplateFromEvent (#154)", () => {
  const result = build();
  const serialized = JSON.stringify(result.payload);

  it("builds a payload the template schema accepts, with exactly the allow-listed keys", () => {
    expect(eventTemplatePayloadSchema.safeParse(result.payload).success).toBe(true);
    expect(Object.keys(result.payload).sort()).toEqual([
      "attendeeClassifications", "attendeeTypes", "audience", "billingMode", "brandingDefaults", "formTemplateKeys", "locations", "meals",
      "messageTemplateDefaults", "moduleEnablement", "registrationForms", "reportSelections",
    ]);
    expect(Object.keys(result.payload.brandingDefaults).sort()).toEqual(["calendarCategory", "publicInfoUrl", "supportContact"]);
    expect(Object.keys(result.payload.moduleEnablement).sort()).toEqual(["autoPromoteWaitlist", "checksAdultBackgrounds", "collectsShirtSizes", "hostedPaymentLinkEnabled", "waitlistEnabled"]);
  });

  it("copies nothing identifying: no source id, slug, token, account link, policy version or form id", () => {
    for (const forbidden of ["event-src", "synthetic-retreat-2027", SECRET, "/manage/", "account-coordinator-1", "policy-version-9", "form-1", "form-version-4", "mv-1", "Synthetic Retreat 2027", "promo-1", "EARLY"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("removes private links from copied text and drops a private settings URL, and reports each with its token masked", () => {
    expect(result.payload.brandingDefaults.publicInfoUrl).toBeNull();
    expect(result.payload.brandingDefaults.supportContact).toBe("Synthetic Office (515) 555-0100");
    const privateLinks = result.preview.exclusions.find((entry) => entry.key === "privateLinks")!;
    expect(privateLinks.count).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(result.preview)).not.toContain(SECRET);
    expect(privateLinks.details.join(" ")).toContain("Public info link");
  });

  it("turns policy-version acknowledgments into placeholders and removes late pricing, reporting both", () => {
    const form = result.payload.registrationForms![0]!;
    const fields = form.definition.sections.flatMap((section) => section.fields);
    const ack = fields.find((field) => field.key === "policy_ack")!;
    expect(ack.acknowledgment?.source).toBe("TEXT");
    expect(fields.find((field) => field.key === "extra_meal")!.latePricing).toBeUndefined();
    expect(fields.find((field) => field.key === "extra_meal")!.priceCents).toBe(1500);
    expect(result.preview.exclusions.find((entry) => entry.key === "policyAcknowledgments")!.details).toEqual(['Form "Retreat form" field "Camp policy"']);
    expect(result.preview.exclusions.find((entry) => entry.key === "latePricing")!.details).toEqual(['Form "Retreat form" field "Extra meal"']);
    expect(() => validateEventTemplatePayloadReferences(result.payload)).not.toThrow();
  });

  it("copies only copyable message templates", () => {
    expect(result.payload.messageTemplateDefaults.map((entry) => entry.key)).toEqual(["EVENT_ANNOUNCEMENT"]);
    expect(result.payload.messageTemplateDefaults[0]!.bodyTemplate).not.toContain("/manage/");
    expect(result.preview.exclusions.find((entry) => entry.key === "messageTemplatesNotCopyable")!.count).toBe(1);
    expect(result.provenance.messageTemplates).toEqual([{ key: "EVENT_ANNOUNCEMENT", versionId: "mv-1", versionNumber: 2 }]);
  });

  it("saves locations and meals as day offsets, without the coordinator", () => {
    expect(result.payload.locations).toEqual([{ name: "North Site", address: "1 Synthetic Road", capacity: 40, firstDayOffset: 1, lastDayOffset: 2, registrationClosesOffset: -4 }]);
    expect(result.payload.meals!.services).toHaveLength(1);
    expect(result.payload.meals!.services[0]).toMatchObject({ name: "Friday supper", dayOffset: 2 });
    expect(result.payload.meals!.plans[0]!.services).toEqual([{ serviceName: "Friday supper", dayOffset: 2, entitlement: "PAID" }]);
    expect(result.preview.exclusions.find((entry) => entry.key === "locationCoordinators")!.count).toBe(1);
    expect(result.preview.exclusions.find((entry) => entry.key === "mealsOutsideRange")!.count).toBe(2);
  });

  it("records provenance of the forms and messages it copied", () => {
    expect(result.provenance).toEqual({
      sourceEventId: "event-src",
      forms: [{ formId: "form-1", versionId: "form-version-4", versionNumber: 4 }],
      messageTemplates: [{ key: "EVENT_ANNOUNCEMENT", versionId: "mv-1", versionNumber: 2 }],
    });
  });

  it("shows every unsupported and template-specific exclusion explicitly, with counts", () => {
    const byKey = Object.fromEntries(result.preview.exclusions.map((entry) => [entry.key, entry]));
    expect(byKey["unsupported.merchandise"]!.count).toBe(3);
    expect(byKey["unsupported.paymentInstructions"]!.count).toBe(1);
    expect(byKey["unsupported.messageDelivery"]!.count).toBe(1);
    expect(byKey["unsupported.uploadedFiles"]!.count).toBe(2);
    expect(byKey.publicContentSections!.count).toBe(1);
    expect(byKey.tags!.count).toBe(1);
    expect(byKey.promoCodes!.count).toBe(1);
    expect(byKey.lodging!.count).toBe(2);
    expect(byKey.community!.count).toBe(1);
    expect(byKey.formsWithoutPublishedVersion!.count).toBe(2);
    expect(byKey.messageTemplatesWithoutPublishedVersion!.count).toBe(1);
    expect(byKey.reportSelections).toBeDefined();
    expect(byKey.registrationThemes!.reason).toBe("Not available yet.");
    expect(result.preview.neverCopied).toBe(cloneNeverCopied);
    expect(cloneNeverCopied.join(" ")).toMatch(/Registrations/);
    expect(cloneNeverCopied.join(" ")).toMatch(/Payments/);
  });

  it("copies team rules without the one-year dates, and the general link, only for a club event", () => {
    const club = source({
      eventDetails: { ...source().eventDetails, audience: "CLUB", billingMode: "DEFERRED_ORGANIZATION_INVOICE" },
      moduleToggles: { ...source().moduleToggles, teamSettings: { allowMultipleTeams: true, minTeamMembers: 4, maxTeamMembers: 8, maxAlternates: 2, maxMemberAge: 15, booksLine: "Synthetic books" } },
    });
    const built = build(club, true);
    expect(built.payload.teamSettings).toMatchObject({ allowMultipleTeams: true, minTeamMembers: 4, ageAsOf: null, levelInfo: [] });
    expect(built.payload.generalRegistrationLink).toBe(true);
    const general = build(source({ moduleToggles: { ...source().moduleToggles, teamSettings: club.moduleToggles.teamSettings } }), true);
    expect(general.payload.teamSettings).toBeUndefined();
    expect(general.payload.generalRegistrationLink).toBeUndefined();
  });

  it("leaves out a form whose stored definition is invalid and reports it", () => {
    const config = source();
    config.registrationForms.push({ formId: "form-bad", name: "Broken", slug: "broken", versionId: "v", versionNumber: 1, definition: { nonsense: true } });
    const built = build(config);
    expect(built.payload.registrationForms).toHaveLength(1);
    expect(built.preview.exclusions.find((entry) => entry.key === "formsNotCopyable")!.count).toBe(1);
  });

  it("builds an empty but valid payload for an event with nothing configured", () => {
    const built = build(source({
      registrationForms: [], attendeeTypes: [], attendeeClassifications: [], messageTemplates: [], locations: [], meals: undefined,
      eventDetails: { ...source().eventDetails, publicInfoUrl: null, supportContact: null, calendarCategory: null },
    }));
    expect(built.payload.registrationForms).toBeUndefined();
    expect(built.payload.locations).toBeUndefined();
    expect(built.payload.meals).toBeUndefined();
  });
});

describe("private links in every copied string (#154)", () => {
  const link = (route: string) => `https://events.imsda.test/${route}/${SECRET}`;

  it("strips token links on other private routes and reports them masked", () => {
    const config = source({
      attendeeTypes: [{ code: "ADULT", label: "Adult", description: `Details ${link("club-forms")}`, sortOrder: 0, isActive: true, minimumAge: 18, maximumAge: null }],
      attendeeClassifications: [{ kind: "CATEGORY", code: "GUEST", label: "Guest", description: `See ${link("health-records")}`, sortOrder: 0, isActive: true }],
      locations: [{ name: "North Site", address: `1 Road ${link("staff-invite")}`, capacity: 40, sortOrder: 0, firstDay: null, lastDay: null, registrationClosesOn: null }],
      meals: {
        services: [{ name: "Friday supper", mealType: "SUPPER", serviceDate: "2027-05-07", startTime: "18:00", endTime: null, location: `Hall ${link("unsubscribe")}`, ticketing: "TICKETED", capacity: null, position: 1 }],
        plans: [{ code: "FULL", name: "Full plan", description: `Plan ${link("clubs/register")}`, payer: "ATTENDEE", isDefaultTicketPlan: true, includesAllServices: true, defaultEntitlement: "PAID", position: 1, services: [], prices: [] }],
      },
    });
    const built = build(config);
    expect(JSON.stringify(built.payload)).not.toContain(SECRET);
    expect(JSON.stringify(built.preview)).not.toContain(SECRET);
    expect(built.preview.exclusions.find((entry) => entry.key === "privateLinks")!.count).toBeGreaterThanOrEqual(5);
  });

  it("scans form labels, titles, acknowledgment and signature text, roster labels and the required-one message", () => {
    const base = formDefinition();
    const definition = registrationFormDefinitionSchema.parse({
      title: `Form ${link("manage")}`,
      confirmationMessage: "Received.",
      attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 5, attendeeLabel: "Person /manage/SHORTTOK1", addButtonLabel: "Add one /manage/SHORTTOK1" },
      requireAtLeastOne: { fieldKeys: ["first_name", "last_name"], message: `Pick one ${link("club-forms")}` },
      sections: [{
        id: "sec_one", title: `Section ${link("health-records")}`, description: "", fields: [
          { id: "f_first", key: "first_name", label: `First ${link("staff-invite")}`, type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
          { id: "f_last", key: "last_name", label: "Last name", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
          { id: "f_ack", key: "typed_ack", label: "Typed", type: "ACKNOWLEDGMENT", scope: "REGISTRATION", required: true, options: [], acknowledgment: { source: "TEXT", text: `I agree ${link("unsubscribe")} to this.` } },
          { id: "f_sig", key: "signed", label: "Signed", type: "SIGNATURE", scope: "REGISTRATION", required: true, options: [], signature: { text: `I sign ${link("unsubscribe")} here.` } },
        ],
      }],
    });
    void base;
    const built = build(source({ registrationForms: [{ formId: "form-2", name: "Other", slug: "other", versionId: "v", versionNumber: 1, definition }] }));
    expect(built.payload.registrationForms).toHaveLength(1);
    expect(JSON.stringify(built.payload)).not.toContain(SECRET);
    expect(JSON.stringify(built.payload)).not.toContain("/manage/");
    expect(JSON.stringify(built.payload)).not.toContain("SHORTTOK1");
  });

  it("stores exclusions as keys and counts, with link origins and first segments only", () => {
    const built = build();
    const stored = JSON.stringify(built.storedExclusions);
    for (const forbidden of [SECRET, "token=", "Retreat form", "Synthetic Inn", "Camp policy", "North Site", "Extra meal"]) expect(stored).not.toContain(forbidden);
    const links = built.storedExclusions.find((entry) => entry.key === "privateLinks")!.links!;
    expect(links.length).toBeGreaterThan(0);
    for (const entry of links) {
      expect(entry.link).toMatch(/^(https:\/\/events\.imsda\.test(\/(manage|api|club-forms|health-records|unsubscribe|staff-invite|clubs|pay))?|\/(manage|api))$/);
      expect(entry.reasons.length).toBeGreaterThan(0);
    }
    expect(built.storedExclusions.every((entry) => Object.keys(entry).every((key) => ["key", "count", "links"].includes(key)))).toBe(true);
  });
});

describe("stored links, labels and form details (#154)", () => {
  it("never stores a slug, an id or a secret from another site, and keeps the reason keys", () => {
    const config = source({
      messageTemplates: [{ key: "EVENT_ANNOUNCEMENT", isEnabled: true, versionId: "mv-1", versionNumber: 1, subjectTemplate: "News", bodyTemplate: "See https://other.example.test/page?token=OTHERSECRET9 and /synthetic-retreat-2027/photos and /api/events/event-src/x" }],
    });
    const built = build(config);
    const stored = JSON.stringify(built.storedExclusions);
    for (const forbidden of ["OTHERSECRET9", "synthetic-retreat-2027", "event-src", "photos", "page"]) expect(stored).not.toContain(forbidden);
    const links = built.storedExclusions.find((entry) => entry.key === "privateLinks")!.links!;
    expect(links.some((entry) => entry.link === "https://other.example.test" && entry.reasons.includes("tokenParameter"))).toBe(true);
    expect(links.some((entry) => entry.reasons.includes("sourceReference"))).toBe(true);
    expect(links.some((entry) => entry.link === "/api" && entry.reasons.includes("sourceAdminApi"))).toBe(true);
  });

  it("scans attendee type labels, location names and meal names, and says why an item could not be copied", () => {
    const built = build(source({
      attendeeTypes: [{ code: "ADULT", label: `${manageLink}`, description: "", sortOrder: 0, isActive: true, minimumAge: null, maximumAge: null }],
      attendeeClassifications: [{ kind: "CATEGORY", code: "GUEST", label: `Guest ${manageLink}`, description: "", sortOrder: 0, isActive: true }],
      locations: [{ name: `Camp ${manageLink}`, address: null, capacity: null, sortOrder: 0, firstDay: null, lastDay: null, registrationClosesOn: null }],
      meals: {
        services: [{ name: `Supper ${manageLink}`, mealType: "SUPPER", serviceDate: "2027-05-07", startTime: "18:00", endTime: null, location: null, ticketing: "TICKETED", capacity: null, position: 1 }],
        plans: [{ code: "FULL", name: `Plan ${manageLink}`, description: "", payer: "ATTENDEE", isDefaultTicketPlan: true, includesAllServices: false, defaultEntitlement: "PAID", position: 1, services: [{ serviceName: `Supper ${manageLink}`, serviceDate: "2027-05-07", entitlement: "PAID" }], prices: [] }],
      },
    }));
    expect(JSON.stringify(built.payload)).not.toContain(SECRET);
    expect(built.payload.attendeeTypes).toEqual([]);
    expect(built.payload.attendeeClassifications[0]!.label).toBe("Guest");
    expect(built.payload.locations![0]!.name).toBe("Camp");
    expect(built.payload.meals!.services[0]!.name).toBe("Supper");
    expect(built.payload.meals!.plans[0]!.services).toEqual([{ serviceName: "Supper", dayOffset: 2, entitlement: "PAID" }]);
    const invalid = built.preview.exclusions.find((entry) => entry.key === "invalidItems")!;
    expect(invalid.details).toEqual(["Attendee type ADULT (a label or text was only a private link)"]);
    expect(JSON.stringify(built.preview)).not.toContain(SECRET);
  });

  it("keeps the event's form name, and says why a form was not copied", () => {
    const only = registrationFormDefinitionSchema.parse({
      title: "Only link form", confirmationMessage: "Received.",
      sections: [{ id: "sec_one", title: "Everything", description: "", fields: [{ id: "f_a", key: "field_a", label: manageLink, type: "TEXT", scope: "REGISTRATION", required: false, options: [] }] }],
    });
    const config = source({
      registrationForms: [
        { formId: "form-1", name: "Event form name", slug: "event-form", versionId: "v1", versionNumber: 1, definition: { ...formDefinition(), title: "Different definition title" } },
        { formId: "form-2", name: "Link form", slug: "link-form", versionId: "v2", versionNumber: 1, definition: only },
      ],
    });
    const built = build(config);
    expect(built.payload.registrationForms!.map((form) => form.name)).toEqual(["Event form name"]);
    const details = built.preview.exclusions.find((entry) => entry.key === "formsNotCopyable")!.details;
    expect(details).toEqual(["Link form: a label or text was only a private link"]);
  });
});

describe("a new version keeps the template's own settings (#154)", () => {
  it("drops a kept form template key the event's own copy replaces, so a round trip does not duplicate the form", () => {
    const built = buildTemplateFromEvent({ config: source(), generalRegistrationLink: false, formTemplateKeys: { "form-1": "simple_rsvp" } }, origins, {
      reportSelections: [], formTemplateKeys: ["simple_rsvp", "other_form"], registrationClosesOn: undefined, starterKey: undefined,
    });
    expect(built.payload.formTemplateKeys).toEqual(["other_form"]);
    expect(built.payload.registrationForms).toHaveLength(1);
    expect(JSON.stringify(built.preview.domains)).toContain("replaced by the event's own copy");
  });

  it("takes the event's own deadline, else keeps the old one flagged for review, and never lists kept report selections as excluded", () => {
    const existing = { reportSelections: operationalReportKinds.slice(0, 1), formTemplateKeys: [], registrationClosesOn: "2026-04-01", starterKey: undefined };
    const fromEvent = buildTemplateFromEvent({ config: source(), generalRegistrationLink: false, registrationClosesOn: "2027-04-02" }, origins, existing);
    expect(fromEvent.payload.registrationClosesOn).toBe("2027-04-02");
    expect(fromEvent.kept.find((entry) => entry.key === "registrationClosesOn")!.label).toContain("taken from the event");
    const stale = buildTemplateFromEvent({ config: source(), generalRegistrationLink: false }, origins, existing);
    expect(stale.payload.registrationClosesOn).toBe("2026-04-01");
    expect(stale.kept.find((entry) => entry.key === "registrationClosesOn")!.label).toContain("review it");
    expect(stale.preview.exclusions.some((entry) => entry.key === "reportSelections")).toBe(false);
    expect(build().preview.exclusions.some((entry) => entry.key === "reportSelections")).toBe(true);
  });

  it("carries reportSelections, formTemplateKeys, registrationClosesOn and starterKey forward and says so", () => {
    const built = buildTemplateFromEvent({ config: source(), generalRegistrationLink: false }, origins, {
      reportSelections: operationalReportKinds.slice(0, 2),
      formTemplateKeys: ["simple_rsvp"], registrationClosesOn: "2027-04-01", starterKey: "fall_camporee",
    });
    expect(built.payload.reportSelections).toEqual(operationalReportKinds.slice(0, 2));
    expect(built.payload.formTemplateKeys).toEqual(["simple_rsvp"]);
    expect(built.payload.registrationClosesOn).toBe("2027-04-01");
    expect(built.payload.starterKey).toBe("fall_camporee");
    expect(built.payload.registrationForms).toHaveLength(1);
    expect(built.kept.map((entry) => entry.key).sort()).toEqual(["formTemplateKeys", "registrationClosesOn", "reportSelections", "starterKey"]);
    expect(built.preview.domains.some((domain) => domain.key === "keptFromTemplate")).toBe(true);
  });

  it("keeps nothing for a new template", () => {
    const built = build();
    expect(built.kept).toEqual([]);
    expect(built.payload.starterKey).toBeUndefined();
  });
});

describe("a template with a policy-version acknowledgment fails the reference check (#154)", () => {
  it("names the form and the acknowledgment", () => {
    const payload = eventTemplatePayloadSchema.parse({ registrationForms: [{ name: "Retreat form", slug: "retreat-form", definition: formDefinition() }] });
    expect(() => validateEventTemplatePayloadReferences(payload)).toThrow(EventTemplateReferenceError);
  });

  it("rejects a repeated form address", () => {
    const definition = registrationFormDefinitionSchema.parse({ title: "Other", confirmationMessage: "Received.", sections: [{ id: "sec_x", title: "Section", description: "", fields: [{ id: "f_name", key: "name_field", label: "Name", type: "TEXT", scope: "REGISTRATION", required: true, options: [] }] }] });
    const form = { name: "A", slug: "same", definition };
    expect(eventTemplatePayloadSchema.safeParse({ registrationForms: [form, form] }).success).toBe(false);
  });
});

describe("templateMealsFromDefinitions", () => {
  it("returns no meals for an event with none", () => {
    expect(templateMealsFromDefinitions({ services: [], plans: [] }, "2027-05-05")).toMatchObject({ meals: null, issue: null });
  });
});

describe("save input", () => {
  const base = { sourceEventId: "event-src", fingerprint: "a".repeat(64), releaseNote: "  Reviewed for 2028.  ", requestKey: "idempotency-key-0001" };

  it("requires a release note of at least three characters, trimmed", () => {
    expect(saveTemplateFromEventInputSchema.safeParse({ ...base, releaseNote: "  ok ", target: { mode: "NEW_VERSION", templateId: "t" } }).success).toBe(false);
    const parsed = saveTemplateFromEventInputSchema.parse({ ...base, target: { mode: "NEW", name: "Retreat", description: "" } });
    expect(parsed.releaseNote).toBe("Reviewed for 2028.");
  });

  it("is strict about unknown keys and a missing fingerprint", () => {
    expect(saveTemplateFromEventInputSchema.safeParse({ ...base, extra: 1, target: { mode: "NEW", name: "Retreat" } }).success).toBe(false);
    expect(saveTemplateFromEventInputSchema.safeParse({ ...base, fingerprint: "x", target: { mode: "NEW", name: "Retreat" } }).success).toBe(false);
    expect(saveTemplateFromEventInputSchema.safeParse({ ...base, target: { mode: "NEW", name: "Retreat", templateId: "t" } }).success).toBe(false);
  });

  it("compares retries without the key", () => {
    const input = saveTemplateFromEventInputSchema.parse({ ...base, target: { mode: "NEW_VERSION", templateId: "t" } });
    expect(saveTemplateRequestInputOf(input)).not.toHaveProperty("requestKey");
  });
});
