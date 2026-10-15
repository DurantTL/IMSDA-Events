import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  eventFindFirst: vi.fn(),
  attendeeCount: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    event: { findFirst: prismaMocks.eventFindFirst },
    // Read when the landing page loads its published content sections.
    eventContentSection: { findMany: vi.fn().mockResolvedValue([]) },
    registrationAttendee: { count: prismaMocks.attendeeCount },
  }),
}));

import { getPublicEventLanding } from "@/modules/events/public-repository";
import { getFormTemplate } from "@/modules/forms/definition";

const now = new Date("2026-07-23T18:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.attendeeCount.mockResolvedValue(4);
  prismaMocks.eventFindFirst.mockResolvedValue({
    id: "event-public",
    slug: "public-retreat",
    name: "Public Retreat",
    startsAt: new Date("2026-08-14T21:00:00.000Z"),
    endsAt: new Date("2026-08-16T17:00:00.000Z"),
    timezone: "America/Chicago",
    location: "Fictitious Conference Center",
    capacity: 100,
    publicInfoUrl: null,
    supportContact: "events@example.test",
    isPublished: true,
    registrationOpensOn: null,
    registrationClosesOn: null,
    waitlistEnabled: true,
    registrationForms: [],
    announcements: [
      {
        id: "private-announcement-id",
        createdByUserId: "private-creator-id",
        title: "Arrival information",
        body: "Use the south entrance.",
        audience: { type: "ALL_ATTENDEES" },
        placement: "HOME_BANNER",
        status: "PUBLISHED",
        priority: "IMPORTANT",
        publishedAt: new Date("2026-07-22T13:30:00.000Z"),
        internalNotes: "never return this",
      },
      {
        title: "Targeted reminder",
        body: "Private target.",
        audience: { type: "REGISTRATION_STATUS", statuses: ["CONFIRMED"] },
        placement: "EVENT_FEED",
        status: "PUBLISHED",
        priority: "URGENT",
        publishedAt: new Date("2026-07-22T14:00:00.000Z"),
      },
      {
        title: "Future message",
        body: "Not yet.",
        audience: { type: "ALL_ATTENDEES" },
        placement: "EVENT_FEED",
        status: "PUBLISHED",
        priority: "NORMAL",
        publishedAt: new Date("2026-07-24T14:00:00.000Z"),
      },
    ],
  });
});

describe("public event landing repository announcements", () => {
  it("queries an exact public audience and returns an allow-listed feed", async () => {
    const landing = await getPublicEventLanding("public-retreat", now);

    expect(prismaMocks.eventFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "public-retreat", isPublished: true, archivedAt: null },
        select: expect.objectContaining({
          announcements: {
            where: {
              status: "PUBLISHED",
              publishedAt: { lte: now },
              audience: { equals: { type: "ALL_ATTENDEES" } },
            },
            orderBy: [
              { priority: "desc" },
              { publishedAt: "desc" },
              { createdAt: "desc" },
              { id: "asc" },
            ],
            select: {
              title: true,
              body: true,
              audience: true,
              placement: true,
              status: true,
              priority: true,
              publishedAt: true,
            },
          },
        }),
      }),
    );
    expect(landing?.announcements).toEqual([
      expect.objectContaining({
        title: "Arrival information",
        body: "Use the south entrance.",
        priority: "IMPORTANT",
        placement: "HOME_BANNER",
      }),
    ]);
    expect(JSON.stringify(landing?.announcements)).not.toContain(
      "private-announcement-id",
    );
    expect(JSON.stringify(landing?.announcements)).not.toContain(
      "private-creator-id",
    );
    expect(JSON.stringify(landing?.announcements)).not.toContain(
      "internalNotes",
    );
    expect(JSON.stringify(landing?.announcements)).not.toContain(
      "Targeted reminder",
    );
    expect(JSON.stringify(landing?.announcements)).not.toContain(
      "Future message",
    );
  });
});

describe("public event landing repository forms and lifecycle", () => {
  async function landingWith(registrationForms: unknown[]) {
    const current = await prismaMocks.eventFindFirst();
    prismaMocks.eventFindFirst.mockResolvedValue({ ...current, registrationForms });
    return getPublicEventLanding("public-retreat", now);
  }

  it("does not say registration is open when an open event lists no forms", async () => {
    const landing = await landingWith([]);
    expect(landing?.lifecycle.state).toBe("OPEN");
    expect(landing?.lifecycle.statusLabel).toBe("Registration opening soon");
    expect(landing?.lifecycle.emptyForms.title).toBe("Registration forms are being prepared");
  });

  it("treats a form with an invalid definition as not listed", async () => {
    const landing = await landingWith([
      { id: "f1", name: "Broken", slug: "broken", createdAt: new Date("2026-01-01"), versions: [{ id: "v1", versionNumber: 1, status: "PUBLISHED", definition: { nonsense: true } }] },
    ]);
    expect(landing?.forms).toHaveLength(0);
    expect(landing?.lifecycle.statusLabel).toBe("Registration opening soon");
  });

  it("keeps Registration open when a valid published form is listed", async () => {
    const template = getFormTemplate("honors_weekend");
    if (!template) throw new Error("honors_weekend template missing");
    const landing = await landingWith([
      { id: "f2", name: "Honors", slug: "honors", createdAt: new Date("2026-01-01"), versions: [{ id: "v2", versionNumber: 1, status: "PUBLISHED", definition: structuredClone(template.definition) }] },
    ]);
    expect(landing?.forms).toHaveLength(1);
    expect(landing?.lifecycle.statusLabel).toBe("Registration open");
  });
});
