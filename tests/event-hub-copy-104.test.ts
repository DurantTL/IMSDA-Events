import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EVENT_HUB_EYEBROW,
  DEFAULT_EVENT_HUB_INTRO,
  DEFAULT_EVENT_HUB_TITLE,
  resolveEventHubCopy,
} from "@/modules/attendee-accounts/event-hub-copy";
import { eventSettingsInputSchema } from "@/modules/events/schemas";
import { settingsFieldBlock } from "@/modules/events/settings-layout";
import { sanitizeSourceForClone, type SourceConfiguration } from "@/modules/event-clones/domain";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), listEventsForUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/events/repository", () => ({ listEventsForUser: mocks.listEventsForUser }));

describe("attendee hub copy comes from event configuration (#104)", () => {
  it("defaults to the text the hub always showed", () => {
    expect(resolveEventHubCopy({})).toEqual({
      documentTitle: "Event hub",
      eyebrow: "Your attendee hub",
      intro: "Schedule, updates, resources, passes and assigned sessions in one signed-in place.",
    });
    expect(DEFAULT_EVENT_HUB_TITLE).toBe("Event hub");
    expect(DEFAULT_EVENT_HUB_EYEBROW).toBe("Your attendee hub");
    expect(DEFAULT_EVENT_HUB_INTRO).toContain("signed-in place");
  });

  it("treats null, empty and whitespace as unset", () => {
    for (const blank of [null, undefined, "", "   "]) {
      expect(resolveEventHubCopy({ hubTitle: blank, hubIntro: blank })).toEqual(resolveEventHubCopy({}));
    }
  });

  it("uses the event's own title and intro, trimmed", () => {
    expect(resolveEventHubCopy({ hubTitle: "  Synthetic Weekend guide ", hubIntro: " Everything for the weekend. " })).toEqual({
      documentTitle: "Synthetic Weekend guide",
      eyebrow: "Synthetic Weekend guide",
      intro: "Everything for the weekend.",
    });
  });

  it("lets a title and an intro be set independently", () => {
    expect(resolveEventHubCopy({ hubTitle: "Camp guide" }).intro).toBe(DEFAULT_EVENT_HUB_INTRO);
    expect(resolveEventHubCopy({ hubIntro: "Custom intro." }).documentTitle).toBe(DEFAULT_EVENT_HUB_TITLE);
  });
});

describe("hub copy staff settings (#104)", () => {
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

  it("leaves absent fields undefined so an update keeps the stored value", () => {
    const parsed = eventSettingsInputSchema.parse(settings);
    expect(parsed.hubTitle).toBeUndefined();
    expect(parsed.hubIntro).toBeUndefined();
  });

  it("trims, clears and bounds the fields", () => {
    const parsed = eventSettingsInputSchema.parse({ ...settings, hubTitle: "  Guide ", hubIntro: "" });
    expect(parsed).toMatchObject({ hubTitle: "Guide", hubIntro: null });
    expect(eventSettingsInputSchema.safeParse({ ...settings, hubTitle: "x".repeat(81) }).success).toBe(false);
    expect(eventSettingsInputSchema.safeParse({ ...settings, hubIntro: "x".repeat(601) }).success).toBe(false);
  });

  it("files both fields under the public-info settings block", () => {
    expect(settingsFieldBlock.hubTitle).toBe("public-info");
    expect(settingsFieldBlock.hubIntro).toBe("public-info");
  });
});

describe("clones carry the hub copy (#104)", () => {
  function source(details: Partial<SourceConfiguration["eventDetails"]>): SourceConfiguration {
    return {
      event: { id: "event-src", name: "Annual 2027", slug: "annual-2027", startsOn: "2027-05-05", endsOn: "2027-05-07", isPublished: true },
      eventDetails: {
        location: null, timezone: "America/Denver", publicInfoUrl: null, supportContact: null, tagline: null, subtitle: null,
        helpEmail: null, refundPolicy: null, calendarCategory: null, showOnCalendar: false, hotelName: null, hotelBookingUrl: null,
        hotelPhone: null, hotelGroupName: null, hotelRate: null, hotelInstructions: null, audience: "GENERAL", billingMode: "ATTENDEE_PAY",
        ...details,
      },
      moduleToggles: { waitlistEnabled: false, autoPromoteWaitlist: false, collectsShirtSizes: false, checksAdultBackgrounds: false, community: null },
      contentSections: [], registrationForms: [], formsWithoutPublishedVersion: 0, attendeeTypes: [], attendeeClassifications: [],
      messageTemplates: [], messageTemplatesWithoutPublishedVersion: 0, tags: [], promoCodes: [], honorSessions: [], honorOfferings: [],
      locations: [], unsupported: { merchandiseProducts: 0, paymentInstructionVersions: 0, messageDeliverySettings: 0, uploadedFiles: 0 },
    } as unknown as SourceConfiguration;
  }

  it("keeps a configured title and intro", () => {
    const { config } = sanitizeSourceForClone(source({ hubTitle: "Weekend guide", hubIntro: "Welcome." }));
    expect(config.eventDetails.hubTitle).toBe("Weekend guide");
    expect(config.eventDetails.hubIntro).toBe("Welcome.");
  });

  it("reads an older source without the fields as unset", () => {
    const { config } = sanitizeSourceForClone(source({}));
    expect(config.eventDetails.hubTitle).toBeNull();
    expect(config.eventDetails.hubIntro).toBeNull();
  });
});

describe("the hub record exposes the copy fields (#104)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the event's title and intro with the staff preview", async () => {
    const { getStaffEventHubPreview } = await import("@/modules/attendee-accounts/event-hub-repository");
    const row = {
      id: "event-1", slug: "synthetic-weekend", name: "Synthetic Weekend",
      startsAt: new Date("2026-10-09T21:00:00.000Z"), endsAt: new Date("2026-10-11T17:00:00.000Z"),
      timezone: "America/Chicago", location: "Synthetic Lodge", supportContact: null,
      hubTitle: "Weekend guide", hubIntro: "Welcome.", announcements: [], contentSections: [],
    };
    mocks.getPrisma.mockReturnValue({ event: { findUnique: vi.fn().mockResolvedValue(row) } });
    mocks.listEventsForUser.mockResolvedValue([row]);
    const result = await getStaffEventHubPreview({ id: "user-1" }, "synthetic-weekend");
    expect(result?.hub.event).toMatchObject({ hubTitle: "Weekend guide", hubIntro: "Welcome." });
  });

  it("reads the title by slug for the document title", async () => {
    const { getEventHubTitleBySlug } = await import("@/modules/attendee-accounts/event-hub-repository");
    const findUnique = vi.fn().mockResolvedValue({ hubTitle: "Weekend guide" });
    mocks.getPrisma.mockReturnValue({ event: { findUnique } });
    await expect(getEventHubTitleBySlug("synthetic-weekend")).resolves.toBe("Weekend guide");
    expect(findUnique).toHaveBeenCalledWith({ where: { slug: "synthetic-weekend" }, select: { hubTitle: true } });
    mocks.getPrisma.mockReturnValue({ event: { findUnique: vi.fn().mockResolvedValue(null) } });
    await expect(getEventHubTitleBySlug("missing")).resolves.toBeNull();
  });
});
