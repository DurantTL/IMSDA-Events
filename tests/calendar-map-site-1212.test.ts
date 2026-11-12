import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));

import { calendarMapPoint } from "@/modules/calendar/map-point";
import { mapSiteLabel } from "@/modules/events/map-site-domain";
import { assertMapSiteUsable } from "@/modules/events/map-site";
import { eventSettingsInputSchema } from "@/modules/events/schemas";
import { draftFromEvent, eventSettingsRequestBody } from "@/modules/events/settings-draft";

const site = (overrides: Record<string, unknown> = {}) => ({
  id: "org-1",
  name: "Maple Grove Church",
  isActive: true,
  churchLocation: { latitude: 41.5, longitude: -93.6 },
  ...overrides,
});

describe("calendarMapPoint", () => {
  it("gives a point only for an active site with coordinates", () => {
    expect(calendarMapPoint(site())).toEqual({ siteId: "org-1", siteName: "Maple Grove Church", latitude: 41.5, longitude: -93.6 });
    expect(calendarMapPoint(null)).toBeUndefined();
    expect(calendarMapPoint(undefined)).toBeUndefined();
    expect(calendarMapPoint(site({ isActive: false }))).toBeUndefined();
    expect(calendarMapPoint(site({ churchLocation: null }))).toBeUndefined();
    expect(calendarMapPoint(site({ churchLocation: { latitude: 41.5, longitude: null } }))).toBeUndefined();
    expect(calendarMapPoint(site({ churchLocation: { latitude: 120, longitude: -93.6 } }))).toBeUndefined();
  });
});

describe("mapSiteLabel", () => {
  it("adds the town when known", () => {
    expect(mapSiteLabel("Camp Heritage", "Clarksburg", "MO")).toBe("Camp Heritage (Clarksburg, MO)");
    expect(mapSiteLabel("Camp Heritage", "", "MO")).toBe("Camp Heritage (MO)");
    expect(mapSiteLabel("Camp Heritage", "", "")).toBe("Camp Heritage");
  });
});

describe("event settings map site save", () => {
  const base = { ...draftFromEvent(null), name: "Spring Camporee", slug: "spring-camporee", startsOn: "2027-04-02", endsOn: "2027-04-04", mapSiteOrganizationId: undefined };

  it("keeps the stored site when absent, clears it on null or blank, and carries an id", () => {
    expect(eventSettingsInputSchema.parse(base).mapSiteOrganizationId).toBeUndefined();
    expect(eventSettingsInputSchema.parse({ ...base, mapSiteOrganizationId: null }).mapSiteOrganizationId).toBeNull();
    expect(eventSettingsInputSchema.parse({ ...base, mapSiteOrganizationId: "  " }).mapSiteOrganizationId).toBeNull();
    expect(eventSettingsInputSchema.parse({ ...base, mapSiteOrganizationId: "org-1" }).mapSiteOrganizationId).toBe("org-1");
    expect(eventSettingsInputSchema.safeParse({ ...base, mapSiteOrganizationId: "x".repeat(65) }).success).toBe(false);
  });

  it("sends a blank picker as null in the save body", () => {
    const draft = eventSettingsInputSchema.parse({ ...base, mapSiteOrganizationId: "org-1" });
    expect(eventSettingsRequestBody(draft).mapSiteOrganizationId).toBe("org-1");
    expect(eventSettingsRequestBody({ ...draft, mapSiteOrganizationId: "" }).mapSiteOrganizationId).toBeNull();
    expect(draftFromEvent(null).mapSiteOrganizationId).toBeNull();
  });

  it("accepts no pin and an existing active organization, and rejects a missing or inactive one", async () => {
    const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
      if (where.id === "active") return { isActive: true };
      if (where.id === "inactive") return { isActive: false };
      return null;
    });
    const tx = { organization: { findUnique } } as never;
    await expect(assertMapSiteUsable(tx, null)).resolves.toBeUndefined();
    await expect(assertMapSiteUsable(tx, undefined)).resolves.toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
    await expect(assertMapSiteUsable(tx, "active")).resolves.toBeUndefined();
    await expect(assertMapSiteUsable(tx, "inactive")).rejects.toMatchObject({ code: "EVENT_MAP_SITE_INVALID" });
    await expect(assertMapSiteUsable(tx, "missing")).rejects.toMatchObject({ code: "EVENT_MAP_SITE_INVALID" });
  });
});
