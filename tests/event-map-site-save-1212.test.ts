import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));

import { createEvent, updateEventSettings } from "@/modules/events/repository";
import { eventSettingsInputSchema } from "@/modules/events/schemas";
import { draftFromEvent } from "@/modules/events/settings-draft";

/** The host-site pin on an event save (#1212), through the real repository with a mocked transaction. */
const organizations: Record<string, { isActive: boolean }> = { active: { isActive: true }, inactive: { isActive: false } };

const base = { ...draftFromEvent(null), name: "Synthetic Retreat", slug: "synthetic-retreat", startsOn: "2027-10-08", endsOn: "2027-10-10", mapSiteOrganizationId: undefined };
const parse = (overrides: Record<string, unknown> = {}) => eventSettingsInputSchema.parse({ ...base, ...overrides });

function setup(storedSite: string | null) {
  const eventUpdate = vi.fn().mockResolvedValue({});
  const eventCreate = vi.fn().mockResolvedValue({ id: "event-new", name: "Synthetic Retreat", slug: "synthetic-retreat", audience: "GENERAL" });
  const orgFind = vi.fn(async ({ where }: { where: { id: string } }) => organizations[where.id] ?? null);
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    event: {
      findUnique: vi.fn().mockResolvedValue({
        name: "Synthetic Retreat", slug: "synthetic-retreat", startsAt: new Date("2027-10-08T12:00:00Z"), endsAt: new Date("2027-10-10T12:00:00Z"),
        timezone: "America/Chicago", audience: "GENERAL", billingMode: "ATTENDEE_PAY", isPublished: false, mapSiteOrganizationId: storedSite,
      }),
      update: eventUpdate,
      create: eventCreate,
    },
    organization: { findUnique: orgFind },
    eventPaymentInstructionVersion: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    promoCode: { count: vi.fn().mockResolvedValue(0) },
    platformSettings: { upsert: vi.fn().mockResolvedValue({ defaultAttendeeEditPolicy: "VERIFY_EVERY_EDIT" }) },
    eventModule: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    eventMembership: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  dependencies.getPrisma.mockReturnValue({
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
    event: { findUnique: vi.fn().mockResolvedValue(null) },
    registrationForm: { findMany: vi.fn().mockResolvedValue([]) },
    eventPaymentInstructionVersion: { findFirst: vi.fn().mockResolvedValue(null) },
  });
  return { eventUpdate, eventCreate, orgFind };
}

beforeEach(() => vi.clearAllMocks());

describe("saving the map pin (#1212)", () => {
  it("keeps the stored pin when none is sent", async () => {
    const { eventUpdate, orgFind } = setup("active");
    await updateEventSettings("event-1", parse(), "user-1");
    expect("mapSiteOrganizationId" in (eventUpdate.mock.calls[0][0].data as object)).toBe(false);
    expect(orgFind).not.toHaveBeenCalled();
  });

  it("clears the pin on null", async () => {
    const { eventUpdate } = setup("active");
    await updateEventSettings("event-1", parse({ mapSiteOrganizationId: null }), "user-1");
    expect(eventUpdate.mock.calls[0][0].data).toMatchObject({ mapSiteOrganizationId: null });
  });

  it("saves a changed pin to an active site", async () => {
    const { eventUpdate } = setup(null);
    await updateEventSettings("event-1", parse({ mapSiteOrganizationId: "active" }), "user-1");
    expect(eventUpdate.mock.calls[0][0].data).toMatchObject({ mapSiteOrganizationId: "active" });
  });

  it("still saves an unchanged pin whose site has since become inactive", async () => {
    const { eventUpdate, orgFind } = setup("inactive");
    await updateEventSettings("event-1", parse({ mapSiteOrganizationId: "inactive" }), "user-1");
    expect(orgFind).not.toHaveBeenCalled();
    expect(eventUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed pin to an inactive or unknown site, writing nothing", async () => {
    for (const site of ["inactive", "missing"]) {
      const { eventUpdate } = setup(null);
      await expect(updateEventSettings("event-1", parse({ mapSiteOrganizationId: site }), "user-1")).rejects.toMatchObject({ code: "EVENT_MAP_SITE_INVALID" });
      expect(eventUpdate).not.toHaveBeenCalled();
    }
  });

  it("rejects creating an event with an inactive site, and accepts an active one", async () => {
    const rejected = setup(null);
    await expect(createEvent(parse({ mapSiteOrganizationId: "inactive" }), "user-1")).rejects.toMatchObject({ code: "EVENT_MAP_SITE_INVALID" });
    expect(rejected.eventCreate).not.toHaveBeenCalled();
    const accepted = setup(null);
    await createEvent(parse({ mapSiteOrganizationId: "active" }), "user-1");
    expect(accepted.eventCreate.mock.calls[0][0].data).toMatchObject({ mapSiteOrganizationId: "active" });
  });
});
