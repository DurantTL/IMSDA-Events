import { z } from "zod";
import {
  cloneNeverCopied,
  cloneUnsupportedLabels,
  type PrivateLinkFinding,
  isCopyableMessageTemplate,
  parseFormDefinition,
  sanitizeSourceForClone,
  type SourceConfiguration,
} from "@/modules/event-clones/domain";
import { stripPrivateLinks, type PrivateLinkContext } from "@/modules/event-clones/private-links";
import {
  eventTemplateDescriptionSchema,
  eventTemplateNameSchema,
  eventTemplatePayloadSchema,
  templateAttendeeClassificationSchema,
  templateAttendeeTypeSchema,
  templateBrandingDefaultsSchema,
  templateLocationSchema,
  templateMessageDefaultSchema,
  templateRegistrationFormSchema,
  type EventTemplatePayload,
  type TemplateRegistrationForm,
} from "@/modules/event-templates/domain";
import { calendarDayDifference } from "@/modules/event-locations/domain";
import { replacePolicyVersionAcknowledgments } from "@/modules/forms/form-template-library-domain";
import { templateMealsFromDefinitions } from "@/modules/meals/clone-domain";
import { teamSettingsInputSchema } from "@/modules/club-teams/domain";

/**
 * Saving an event as a template (#154). Everything here is pure: the caller loads the source event's configuration
 * (`loadSourceConfiguration`, which reads configuration tables only) and this module builds the template payload from
 * it, field by field. Nothing is ever spread from a source object into the payload, so a column or row that is added to
 * the source later can never reach a template until someone adds it here on purpose.
 */

/** The configuration read from the source event: the annual clone's reading, plus the one flag a clone does not need. */
export type TemplateSourceConfiguration = {
  config: SourceConfiguration;
  generalRegistrationLink: boolean;
};

export type TemplateFromEventDomain = {
  key: string;
  label: string;
  count: number;
  /** Names of what is copied (never answers, ids or free text beyond the name). */
  items: string[];
  notes: string[];
};

export type TemplateFromEventExclusion = {
  key: string;
  label: string;
  reason: string;
  /** How many source rows or values are left out; `null` when the exclusion is a whole category rather than a count. */
  count: number | null;
  details: string[];
};

export type TemplateFromEventPreview = {
  source: { id: string; name: string; startsOn: string; endsOn: string; audience: "GENERAL" | "CLUB" };
  /** What the template would carry, domain by domain. */
  domains: TemplateFromEventDomain[];
  /** Everything shown as not copied, with counts. */
  exclusions: TemplateFromEventExclusion[];
  /** What is never copied whatever the event holds. */
  neverCopied: readonly string[];
};

/** Ids and version numbers of what the template was built from, stored as the version's provenance. */
export type TemplateFromEventProvenance = {
  sourceEventId: string;
  forms: Array<{ formId: string; versionId: string; versionNumber: number }>;
  messageTemplates: Array<{ key: string; versionId: string; versionNumber: number }>;
};

/** The template's own settings an event can never supply, carried forward from its current version into a new one. */
export type TemplateKeptSettings = Pick<EventTemplatePayload, "reportSelections" | "formTemplateKeys" | "registrationClosesOn" | "starterKey">;

/** What is stored as a version's `exclusions`: keys and counts, plus the redacted link origin and first path segment. No copied text. */
export type StoredTemplateExclusion = { key: string; count: number | null; links?: Array<{ domain: string; link: string }> };

export type TemplateFromEventBuild = {
  payload: EventTemplatePayload;
  preview: TemplateFromEventPreview;
  provenance: TemplateFromEventProvenance;
  storedExclusions: StoredTemplateExclusion[];
  /** Settings kept from the current template version (a new version of an existing template only). */
  kept: Array<{ key: string; label: string; count: number }>;
};

/** A redacted link reduced to its origin and first path segment: no query, no deeper path, no token. */
export function reduceRedactedLink(link: string) {
  const bare = link.split(/[?#]/)[0] ?? "";
  const match = /^(https?:\/\/[^/]+)?(\/[^/]*)?/i.exec(bare);
  return `${match?.[1] ?? ""}${match?.[2] ?? ""}` || "(link)";
}

const MESSAGE_DEFAULT_LIMIT = 30;
const FORM_LIMIT = 20;

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function normalizedName(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/**
 * Builds the template payload and the preview from a source event's configuration. Throws nothing for content a template
 * cannot carry: each such item is left out and reported as an exclusion instead. The payload is parsed with
 * `eventTemplatePayloadSchema` at the end, so what is returned is always a payload the editor and publish accept.
 */
export function buildTemplateFromEvent(
  source: TemplateSourceConfiguration,
  appOrigins: readonly string[],
  existing: Partial<TemplateKeptSettings> | null = null,
): TemplateFromEventBuild {
  const original = source.config;
  // Private links in copied text (a registrant's manage link, a staff API path, a token) are found and removed first.
  const { config, findings } = sanitizeSourceForClone(original, appOrigins);
  const context: PrivateLinkContext = { sourceEventId: original.event.id, sourceSlug: original.event.slug, appOrigins };
  const audience = config.eventDetails.audience;

  /** Free text a template copies is scanned for private links too, beyond what the clone's sanitizing covers. */
  const scrub = (domain: PrivateLinkFinding["domain"], location: string, value: string) => {
    const result = stripPrivateLinks(value, context);
    for (const match of result.matches) findings.push({ domain, location, link: match.redacted, reasons: [] });
    return result.text;
  };
  const scrubOptional = (domain: PrivateLinkFinding["domain"], location: string, value: string | null) => {
    if (value === null) return null;
    const next = scrub(domain, location, value).trim();
    return next === "" ? null : next;
  };

  const domains: TemplateFromEventDomain[] = [];
  const exclusions: TemplateFromEventExclusion[] = [];
  const exclude = (key: string, label: string, reason: string, count: number | null, details: string[] = []) => {
    exclusions.push({ key, label, reason, count, details });
  };
  const invalid: string[] = [];

  // --- Audience, billing, module switches ---------------------------------
  const moduleEnablement = {
    waitlistEnabled: config.moduleToggles.waitlistEnabled,
    autoPromoteWaitlist: config.moduleToggles.autoPromoteWaitlist,
    collectsShirtSizes: config.moduleToggles.collectsShirtSizes,
    checksAdultBackgrounds: config.moduleToggles.checksAdultBackgrounds,
    hostedPaymentLinkEnabled: config.moduleToggles.hostedPaymentLinkEnabled ?? false,
  };
  const switchedOn = (Object.entries(moduleEnablement) as Array<[string, boolean]>).filter(([, on]) => on).map(([key]) => key);
  domains.push({
    key: "audience",
    label: "Audience and billing",
    count: 1,
    items: [audience === "CLUB" ? "Club event" : "General event", config.eventDetails.billingMode === "DEFERRED_ORGANIZATION_INVOICE" ? "Church invoice billing" : "Attendees pay"],
    notes: [],
  });
  domains.push({
    key: "moduleEnablement",
    label: "Module switches",
    count: switchedOn.length,
    items: switchedOn,
    notes: switchedOn.length === 0 ? ["No optional switch is on."] : [],
  });

  // --- Attendee types and classifications ---------------------------------
  const attendeeTypes: EventTemplatePayload["attendeeTypes"] = [];
  const typeCodes = new Set<string>();
  for (const type of config.attendeeTypes) {
    const parsed = templateAttendeeTypeSchema.safeParse({
      code: type.code, label: type.label, description: scrub("attendeeTypes", `Attendee type ${type.code} description`, type.description), sortOrder: type.sortOrder,
      isActive: type.isActive, minimumAge: type.minimumAge, maximumAge: type.maximumAge,
    });
    if (!parsed.success || typeCodes.has(parsed.data.code) || attendeeTypes.length >= 60) {
      invalid.push(`Attendee type ${type.label}`);
      continue;
    }
    typeCodes.add(parsed.data.code);
    attendeeTypes.push(parsed.data);
  }
  domains.push({ key: "attendeeTypes", label: "Attendee types", count: attendeeTypes.length, items: attendeeTypes.map((type) => type.label), notes: [] });

  const attendeeClassifications: EventTemplatePayload["attendeeClassifications"] = [];
  const classificationKeys = new Set<string>();
  for (const classification of config.attendeeClassifications) {
    const parsed = templateAttendeeClassificationSchema.safeParse({
      kind: classification.kind, code: classification.code, label: classification.label,
      description: scrub("attendeeClassifications", `Classification ${classification.code} description`, classification.description), sortOrder: classification.sortOrder, isActive: classification.isActive,
    });
    const key = parsed.success ? `${parsed.data.kind}:${parsed.data.code}` : "";
    if (!parsed.success || classificationKeys.has(key) || attendeeClassifications.length >= 60) {
      invalid.push(`Classification ${classification.label}`);
      continue;
    }
    classificationKeys.add(key);
    attendeeClassifications.push(parsed.data);
  }
  domains.push({
    key: "attendeeClassifications", label: "Attendee classifications", count: attendeeClassifications.length,
    items: attendeeClassifications.map((classification) => classification.label), notes: [],
  });

  // --- Message template defaults ------------------------------------------
  const messageTemplateDefaults: EventTemplatePayload["messageTemplateDefaults"] = [];
  const messageProvenance: TemplateFromEventProvenance["messageTemplates"] = [];
  let nonCopyableMessages = 0;
  for (const template of config.messageTemplates) {
    const parsed = isCopyableMessageTemplate(template)
      ? templateMessageDefaultSchema.safeParse({ key: template.key, isEnabled: template.isEnabled, subjectTemplate: template.subjectTemplate, bodyTemplate: template.bodyTemplate })
      : null;
    if (!parsed?.success || messageTemplateDefaults.length >= MESSAGE_DEFAULT_LIMIT) {
      nonCopyableMessages += 1;
      continue;
    }
    messageTemplateDefaults.push(parsed.data);
    messageProvenance.push({ key: template.key, versionId: template.versionId, versionNumber: template.versionNumber });
  }
  domains.push({
    key: "messageTemplateDefaults", label: "Message template defaults", count: messageTemplateDefaults.length,
    items: messageTemplateDefaults.map((entry) => entry.key), notes: [],
  });

  // --- Branding defaults ---------------------------------------------------
  const brandingCandidate = {
    publicInfoUrl: config.eventDetails.publicInfoUrl,
    supportContact: config.eventDetails.supportContact,
    calendarCategory: config.eventDetails.calendarCategory,
  };
  const brandingItems: string[] = [];
  const brandingValue = <K extends keyof typeof brandingCandidate>(key: K, label: string) => {
    const value = brandingCandidate[key];
    if (value === null) return null;
    const parsed = templateBrandingDefaultsSchema.shape[key].safeParse(value);
    if (!parsed.success) {
      invalid.push(label);
      return null;
    }
    brandingItems.push(label);
    return parsed.data;
  };
  const branding = {
    publicInfoUrl: brandingValue("publicInfoUrl", "Public info link"),
    supportContact: brandingValue("supportContact", "Support contact"),
    calendarCategory: brandingValue("calendarCategory", "Calendar category"),
  };
  domains.push({ key: "brandingDefaults", label: "Public info link, support contact and calendar category", count: brandingItems.length, items: brandingItems, notes: [] });

  // --- Locations: day offsets from the source start, no coordinator --------
  const startsOn = original.event.startsOn;
  const locations: NonNullable<EventTemplatePayload["locations"]> = [];
  const locationNames = new Set<string>();
  let locationDatesDropped = 0;
  for (const location of config.locations) {
    const offset = (date: string | null, minimum: number) => {
      if (date === null) return null;
      const days = calendarDayDifference(startsOn, date);
      if (days < minimum || days > 365) {
        locationDatesDropped += 1;
        return null;
      }
      return days;
    };
    const parsed = templateLocationSchema.safeParse({
      name: location.name, address: scrubOptional("locations", `Location ${location.name} address`, location.address), capacity: location.capacity,
      firstDayOffset: offset(location.firstDay, 0), lastDayOffset: offset(location.lastDay, 0),
      registrationClosesOffset: offset(location.registrationClosesOn, -365),
    });
    const key = parsed.success ? normalizedName(parsed.data.name) : "";
    if (!parsed.success || locationNames.has(key) || locations.length >= 20) {
      invalid.push(`Location ${location.name}`);
      continue;
    }
    locationNames.add(key);
    locations.push(parsed.data);
  }
  domains.push({
    key: "locations", label: "Locations", count: locations.length, items: locations.map((location) => location.name),
    notes: locations.length > 0 ? ["Dates are saved as days from the event's first day."] : [],
  });

  // --- Meals ---------------------------------------------------------------
  const sourceMeals = original.meals ?? { services: [], plans: [] };
  const sanitizedMeals = {
    services: sourceMeals.services.map((service) => ({ ...service, location: scrubOptional("meals", `Meal ${service.name} location`, service.location) })),
    plans: sourceMeals.plans.map((plan) => ({ ...plan, description: scrub("meals", `Meal plan ${plan.code} description`, plan.description).trim() })),
  };
  const mealResult = templateMealsFromDefinitions(sanitizedMeals, startsOn);
  if (mealResult.issue) invalid.push(`Meal definitions (${mealResult.issue})`);
  domains.push({
    key: "meals", label: "Meal services and plans", count: mealResult.meals ? mealResult.meals.services.length + mealResult.meals.plans.length : 0,
    items: mealResult.meals ? [...mealResult.meals.services.map((service) => service.name), ...mealResult.meals.plans.map((plan) => plan.name)] : [],
    notes: mealResult.meals ? ["Dates are saved as days from the event's first day. Definitions and prices only, never orders."] : [],
  });
  if (mealResult.skippedServices + mealResult.skippedPlanServices > 0) {
    exclude("mealsOutsideRange", "Meal services outside the template's date range", "A service before the first day or more than a year after it cannot be saved as a day offset.", mealResult.skippedServices + mealResult.skippedPlanServices);
  }

  // --- Club settings -------------------------------------------------------
  let teamSettings: EventTemplatePayload["teamSettings"];
  const teamToggles = config.moduleToggles.teamSettings;
  if (audience === "CLUB" && teamToggles) {
    const books = stripPrivateLinks(teamToggles.booksLine, context);
    const parsed = teamSettingsInputSchema.safeParse({
      allowMultipleTeams: teamToggles.allowMultipleTeams, minTeamMembers: teamToggles.minTeamMembers, maxTeamMembers: teamToggles.maxTeamMembers,
      maxAlternates: teamToggles.maxAlternates, ageAsOf: null, maxMemberAge: teamToggles.maxMemberAge, booksLine: books.text.trim(), levelInfo: [],
    });
    if (parsed.success) teamSettings = parsed.data;
    else invalid.push("Team rules");
    for (const match of books.matches) findings.push({ domain: "eventDetails", location: "Team rules books line", link: match.redacted, reasons: [] });
  }
  const generalRegistrationLink = audience === "CLUB" && source.generalRegistrationLink ? true : undefined;
  if (audience === "CLUB") {
    domains.push({
      key: "teamSettings", label: "Team rules and general registration link",
      count: (teamSettings ? 1 : 0) + (generalRegistrationLink ? 1 : 0),
      items: [...(teamSettings ? ["Team rules"] : []), ...(generalRegistrationLink ? ["General registration link"] : [])],
      notes: teamSettings ? ["The age date and level dates are for one year and are not copied."] : [],
    });
  }

  // --- Registration forms: current published structure only ----------------
  const registrationForms: TemplateRegistrationForm[] = [];
  const formProvenance: TemplateFromEventProvenance["forms"] = [];
  const formSlugs = new Set<string>();
  const latePriceDetails: string[] = [];
  const policyDetails: string[] = [];
  let choiceLimitCount = 0;
  let formsNotCopied = 0;
  for (const form of config.registrationForms) {
    const definition = parseFormDefinition(form.definition);
    if (!definition || registrationForms.length >= FORM_LIMIT || formSlugs.has(form.slug)) {
      formsNotCopied += 1;
      continue;
    }
    const scrubbed = structuredClone(definition);
    const where = (detail: string) => `Form "${form.name}" ${detail}`;
    scrubbed.title = scrub("registrationForms", where("title"), scrubbed.title).trim();
    if (scrubbed.requireAtLeastOne) scrubbed.requireAtLeastOne.message = scrub("registrationForms", where("required-one message"), scrubbed.requireAtLeastOne.message).trim();
    if (scrubbed.attendeeRoster) {
      scrubbed.attendeeRoster.attendeeLabel = scrub("registrationForms", where("roster label"), scrubbed.attendeeRoster.attendeeLabel).trim();
      scrubbed.attendeeRoster.addButtonLabel = scrub("registrationForms", where("roster button"), scrubbed.attendeeRoster.addButtonLabel).trim();
    }
    for (const section of scrubbed.sections) {
      section.title = scrub("registrationForms", where("section title"), section.title).trim();
      if (section.stepLabel !== undefined) section.stepLabel = scrub("registrationForms", where("step label"), section.stepLabel).trim();
      for (const field of section.fields) {
        field.label = scrub("registrationForms", where("field label"), field.label).trim();
        if (field.acknowledgment?.source === "TEXT") field.acknowledgment.text = scrub("registrationForms", where("acknowledgment text"), field.acknowledgment.text).trim();
        if (field.signature) field.signature.text = scrub("registrationForms", where("signature text"), field.signature.text).trim();
      }
    }
    const replaced = replacePolicyVersionAcknowledgments(scrubbed);
    const next = structuredClone(replaced.definition);
    for (const section of next.sections) {
      for (const field of section.fields) {
        if (field.latePricing) {
          latePriceDetails.push(`Form "${form.name}" field "${field.label}"`);
          delete field.latePricing;
        }
        choiceLimitCount += Object.keys(field.choiceLimits ?? {}).length;
      }
    }
    const parsed = templateRegistrationFormSchema.safeParse({ name: next.title, slug: form.slug, definition: next });
    if (!parsed.success) {
      formsNotCopied += 1;
      continue;
    }
    for (const label of replaced.replacedLabels) policyDetails.push(`Form "${form.name}" field "${label}"`);
    formSlugs.add(parsed.data.slug);
    registrationForms.push(parsed.data);
    formProvenance.push({ formId: form.formId, versionId: form.versionId, versionNumber: form.versionNumber });
  }
  domains.push({
    key: "registrationForms", label: "Registration forms (current published version)", count: registrationForms.length,
    items: registrationForms.map((form) => form.name),
    notes: [
      "Each is created as a draft on the new event.",
      "Choice values are copied exactly as written, because prices, limits and conditions refer to them; their labels and descriptions are checked for private links.",
      ...(choiceLimitCount > 0 ? [`${plural(choiceLimitCount, "choice limit")} copied with the forms; review them for the new event.`] : []),
    ],
  });
  domains.push({
    key: "reportSelections", label: "Report selections", count: 0, items: [],
    notes: ["An event has no report configuration of its own, so there is nothing to save here."],
  });

  // --- Explicit exclusions -------------------------------------------------
  const unsupportedCounts = {
    merchandise: original.unsupported.merchandiseProducts,
    paymentInstructions: original.unsupported.paymentInstructionVersions,
    messageDelivery: original.unsupported.messageDeliverySettings,
    uploadedFiles: original.unsupported.uploadedFiles,
  };
  for (const key of Object.keys(cloneUnsupportedLabels) as Array<keyof typeof cloneUnsupportedLabels>) {
    exclude(`unsupported.${key}`, cloneUnsupportedLabels[key].label, cloneUnsupportedLabels[key].reason, unsupportedCounts[key]);
  }
  exclude("publicContentSections", "Public page content sections", "Section text, links and cards describe one year's event, so staff write them again.", original.contentSections.length);
  exclude("tags", "Tags", "Tags are event-specific labels.", original.tags.length);
  exclude("promoCodes", "Promo codes", "Promo codes carry discounts, limits and dates for one event.", original.promoCodes.length);
  exclude("honors", "Honors sessions, rooms and classes", "Honors scheduling carries capacities and teachers for one event.", original.honorSessions.length + (original.honorRooms?.length ?? 0) + original.honorOfferings.length);
  const lodgingFields = [original.eventDetails.hotelName, original.eventDetails.hotelBookingUrl, original.eventDetails.hotelPhone, original.eventDetails.hotelGroupName, original.eventDetails.hotelRate, original.eventDetails.hotelInstructions];
  exclude("lodging", "Lodging details", "Hotel names, rates and booking links belong to one event.", lodgingFields.filter((value) => value !== null && value !== "").length);
  const pageDetails = [original.eventDetails.location, original.eventDetails.tagline, original.eventDetails.subtitle, original.eventDetails.helpEmail, original.eventDetails.hubTitle, original.eventDetails.hubIntro, original.eventDetails.refundPolicy];
  exclude("eventDetails", "Event page details and venue text", "Venue, tagline, subtitle, help email, hub text and refund policy are written for each event.", pageDetails.filter((value) => value !== null && value !== undefined && value !== "").length);
  exclude("eventDates", "Event dates and time zone", "Start and end dates, the time zone and registration dates are set when an event is created from the template.", null);
  exclude("packetSettings", "Operational packet settings", "Packet sections and grouping are set up again on each event.", original.moduleToggles.operationalPacketConfig ? 1 : 0);
  exclude("community", "Community settings", "Community discussion settings are set up again on each event.", original.moduleToggles.community ? 1 : 0);
  exclude("locationCoordinators", "Location coordinators", "A coordinator is an account link, and links to people are never copied.", original.locations.filter((location) => location.coordinatorAccountId).length);
  exclude("formsWithoutPublishedVersion", "Forms without a published version", "Only a form's current published version is copied; a draft-only or archived form has nothing current to save.", original.formsWithoutPublishedVersion);
  exclude("messageTemplatesWithoutPublishedVersion", "Message templates without a published version", "Only the current published wording is copied.", original.messageTemplatesWithoutPublishedVersion);
  exclude("messageTemplatesNotCopyable", "Message templates that cannot be copied", "Account-only keys, and wording that no longer passes the message checks, are left out.", nonCopyableMessages);
  exclude("formsNotCopyable", "Forms that cannot be copied", "A form whose stored definition is no longer valid, whose address repeats, or beyond the 20 a template holds.", formsNotCopied);
  exclude("latePricing", "Late-pricing dates", "These dates are for one year, so the form field is copied without its late price.", latePriceDetails.length, latePriceDetails);
  exclude("policyAcknowledgments", "Policy acknowledgments replaced", "A policy version belongs to one event, so the acknowledgment becomes typed wording with a placeholder to reword.", policyDetails.length, policyDetails);
  const copiedLinkDomains = new Set<string>(["registrationForms", "messageTemplates", "attendeeTypes", "attendeeClassifications", "locations", "meals"]);
  const copiedFindings = findings
    .filter((finding) => ["Public info link", "Support contact", "Team rules books line"].includes(finding.location) || copiedLinkDomains.has(finding.domain));
  const privateLinkDetails = copiedFindings
    .map((finding) => `${finding.location}: ${finding.link}${finding.reasons.length > 0 ? ` (${finding.reasons.join(", ")})` : ""}`);
  exclude("privateLinks", "Private links removed", "Links that name the source event or carry a token are removed from copied text and settings. Each is shown with its token masked.", privateLinkDetails.length, privateLinkDetails);
  exclude("invalidItems", "Items that cannot be saved in a template", "These no longer pass the template's rules, so they are left out.", invalid.length, invalid);
  exclude("locationDatesOutsideRange", "Location dates outside the template's range", "A date more than a year from the first day cannot be saved as an offset.", locationDatesDropped);
  exclude("reportSelections", "Report selections", "An event has no report configuration of its own.", null);
  exclude("registrationThemes", "Registration themes and presentation blocks", "Not available yet.", null);

  // A new version of an existing template keeps the settings an event can never supply (#154).
  const kept: TemplateFromEventBuild["kept"] = [];
  if (existing) {
    const keptKeys = existing.formTemplateKeys ?? [];
    const keptReports = existing.reportSelections ?? [];
    if (keptKeys.length > 0) kept.push({ key: "formTemplateKeys", label: "Form templates", count: keptKeys.length });
    if (keptReports.length > 0) kept.push({ key: "reportSelections", label: "Report selections", count: keptReports.length });
    if (existing.registrationClosesOn) kept.push({ key: "registrationClosesOn", label: "Registration deadline", count: 1 });
    if (existing.starterKey) kept.push({ key: "starterKey", label: "Starter template identity", count: 1 });
  }
  if (kept.length > 0) {
    domains.push({
      key: "keptFromTemplate", label: "Kept from the current template version", count: kept.length,
      items: kept.map((entry) => entry.label), notes: ["The event cannot supply these, so the new version keeps them as they are. Its forms are added alongside any form templates."],
    });
  }

  const payload = eventTemplatePayloadSchema.parse({
    ...(existing?.starterKey ? { starterKey: existing.starterKey } : {}),
    audience,
    billingMode: config.eventDetails.billingMode,
    formTemplateKeys: existing?.formTemplateKeys ?? [],
    ...(existing?.registrationClosesOn ? { registrationClosesOn: existing.registrationClosesOn } : {}),
    attendeeTypes,
    attendeeClassifications,
    moduleEnablement,
    reportSelections: existing?.reportSelections ?? [],
    messageTemplateDefaults,
    brandingDefaults: branding,
    ...(locations.length > 0 ? { locations } : {}),
    ...(mealResult.meals ? { meals: mealResult.meals } : {}),
    ...(teamSettings ? { teamSettings } : {}),
    ...(generalRegistrationLink ? { generalRegistrationLink } : {}),
    ...(registrationForms.length > 0 ? { registrationForms } : {}),
  });

  return {
    payload,
    preview: {
      source: { id: original.event.id, name: original.event.name, startsOn, endsOn: original.event.endsOn, audience },
      domains,
      exclusions,
      neverCopied: cloneNeverCopied,
    },
    provenance: { sourceEventId: original.event.id, forms: formProvenance, messageTemplates: messageProvenance },
    storedExclusions: exclusions.map((entry) => (entry.key === "privateLinks"
      ? { key: entry.key, count: entry.count, links: copiedFindings.map((finding) => ({ domain: finding.domain, link: reduceRedactedLink(finding.link) })) }
      : { key: entry.key, count: entry.count })),
    kept,
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const previewTemplateFromEventInputSchema = z.object({
  sourceEventId: z.string().trim().min(1).max(100),
}).strict();

export const releaseNoteSchema = z.string().trim().min(3, "Enter a release note of at least 3 characters.").max(2000, "The release note is too long.");

export const saveTemplateFromEventInputSchema = z.object({
  sourceEventId: z.string().trim().min(1).max(100),
  /** The preview's fingerprint: the save is refused when the event changed since it was previewed. */
  fingerprint: z.string().trim().regex(/^[0-9a-f]{64}$/, "Preview the event again."),
  target: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("NEW"), name: eventTemplateNameSchema, description: eventTemplateDescriptionSchema }).strict(),
    z.object({ mode: z.literal("NEW_VERSION"), templateId: z.string().trim().min(1).max(100) }).strict(),
  ]),
  releaseNote: releaseNoteSchema,
  requestKey: z.string().trim().min(8).max(200),
}).strict();

export type SaveTemplateFromEventInput = z.infer<typeof saveTemplateFromEventInputSchema>;

/** The save request without its key: what a retry with the same key is compared against. */
export function saveTemplateRequestInputOf(input: SaveTemplateFromEventInput) {
  return { sourceEventId: input.sourceEventId, fingerprint: input.fingerprint, target: input.target, releaseNote: input.releaseNote };
}
