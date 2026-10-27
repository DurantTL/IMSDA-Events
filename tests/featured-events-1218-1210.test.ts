import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  updateEventSettings: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/events/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/events/repository")>("@/modules/events/repository");
  return { ...actual, findActiveMembership: dependencies.findActiveMembership, updateEventSettings: dependencies.updateEventSettings };
});

import { PATCH } from "@/app/api/events/[eventId]/route";
import { EventPhotoCard, eventCardImage } from "@/components/event-photo-card";
import type { CalendarItem } from "@/modules/calendar/domain";
import { listEventCardImages, listFeaturedEventRows } from "@/modules/events/featured";
import {
  activeFeaturedRows,
  featuredItemsFor,
  homeFeaturedLimit,
  isFeaturedOn,
  sortFeaturedRows,
  withoutFeatured,
  type FeaturedEventRow,
} from "@/modules/events/featured-domain";
import { eventSettingsInputSchema } from "@/modules/events/schemas";
import { draftFromEvent, eventSettingsRequestBody } from "@/modules/events/settings-draft";

const actualRepository = await vi.importActual<typeof import("@/modules/events/repository")>("@/modules/events/repository");

const css = readFileSync("app/globals.css", "utf8");

const row = (slug: string, overrides: Partial<FeaturedEventRow> = {}): FeaturedEventRow => ({
  slug, featuredOrder: null, featureUntil: null, startsOn: "2026-12-05", endsOn: "2026-12-06", ...overrides,
});

const item = (slug: string, overrides: Partial<CalendarItem> = {}): CalendarItem => ({
  key: `event-${slug}`, kind: "EVENT", title: `Title ${slug}`, description: "", startsOn: "2026-12-05", endsOn: "2026-12-06",
  timeLabel: "", location: "", category: "", href: `/events/${slug}`, status: "SCHEDULED", registrationOpen: false, ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe("featured rules (#1218)", () => {
  it("puts order 1 first, unnumbered events after numbered ones, then earlier start, then slug", () => {
    const sorted = sortFeaturedRows([
      row("c"), row("b", { featuredOrder: 2 }), row("a", { featuredOrder: 1 }), row("d", { startsOn: "2026-11-01" }),
    ]);
    expect(sorted.map((r) => r.slug)).toEqual(["a", "b", "d", "c"]);
  });

  it("features through the chosen date, or the start date when none is set, and then drops out by itself", () => {
    expect(isFeaturedOn(row("a", { featureUntil: "2026-11-30" }), "2026-11-30")).toBe(true);
    expect(isFeaturedOn(row("a", { featureUntil: "2026-11-30" }), "2026-12-01")).toBe(false);
    expect(isFeaturedOn(row("a"), "2026-12-05")).toBe(true);
    expect(isFeaturedOn(row("a"), "2026-12-06")).toBe(false);
  });

  it("stops featuring once the event has ended, even with a later feature-until date", () => {
    expect(isFeaturedOn(row("a", { featureUntil: "2027-01-31" }), "2026-12-06")).toBe(true);
    expect(isFeaturedOn(row("a", { featureUntil: "2027-01-31" }), "2026-12-07")).toBe(false);
  });

  it("shows at most three on the homepage, after dropping expired ones", () => {
    const rows = [1, 2, 3, 4, 5].map((n) => row(`e${n}`, { featuredOrder: n }));
    rows.push(row("old", { featuredOrder: 1, featureUntil: "2026-01-01" }));
    const shown = activeFeaturedRows(rows, "2026-10-27", homeFeaturedLimit);
    expect(homeFeaturedLimit).toBe(3);
    expect(shown.map((r) => r.slug)).toEqual(["e1", "e2", "e3"]);
    expect(activeFeaturedRows(rows, "2026-10-27")).toHaveLength(5);
    expect(activeFeaturedRows(rows, "2026-10-27").map((r) => r.slug)).not.toContain("old");
  });

  it("returns nothing when nothing is featured, so the homepage is as before", () => {
    expect(activeFeaturedRows([], "2026-10-27", 3)).toEqual([]);
    expect(featuredItemsFor([item("a")], [])).toEqual([]);
  });

  it("uses each event's own calendar item (so its status is the shared one) in featured order, and skips an event with none", () => {
    const items = [item("a", { registrationOpen: true, registrationStatus: "OPEN" }), item("b"), item("x", { kind: "ENTRY", href: "/events/c" })];
    const picked = featuredItemsFor(items, [row("b"), row("c"), row("a")]);
    expect(picked.map((i) => i.key)).toEqual(["event-b", "event-a"]);
    expect(picked[1]).toBe(items[0]);
  });

  it("removes featured items from a list so no card shows twice", () => {
    expect(withoutFeatured([item("a"), item("b")], [item("a")]).map((i) => i.key)).toEqual(["event-b"]);
  });

  it("removes every item of a featured event, such as its other linked dates (#1086)", () => {
    const other = item("a", { key: "entry-2", kind: "ENTRY" });
    expect(withoutFeatured([item("a"), other, item("b")], [item("a")]).map((i) => i.key)).toEqual(["event-b"]);
  });

  it("keeps a featured event's other dates on the full calendar list", () => {
    const other = item("a", { key: "entry-2", kind: "ENTRY" });
    expect(withoutFeatured([item("a"), other, item("b")], [item("a")], "item").map((i) => i.key)).toEqual(["entry-2", "event-b"]);
  });

  it("keeps three eligible events when a top-ranked row has no calendar item", () => {
    const rows = [row("ghost", { featuredOrder: 1 }), row("a", { featuredOrder: 2 }), row("b", { featuredOrder: 3 }), row("c", { featuredOrder: 4 }), row("d", { featuredOrder: 5 })];
    const picked = featuredItemsFor([item("a"), item("b"), item("c"), item("d")], activeFeaturedRows(rows, "2026-10-27")).slice(0, homeFeaturedLimit);
    expect(picked.map((i) => i.key)).toEqual(["event-a", "event-b", "event-c"]);
  });
});

describe("featured query (#1218)", () => {
  it("asks only for published, calendar-visible, unarchived featured events, and filters expiry at read time", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { slug: "live", startsAt: new Date("2026-12-05T18:00:00Z"), endsAt: new Date("2026-12-06T18:00:00Z"), timezone: "America/Chicago", featuredOrder: 2, featureUntil: null },
      { slug: "first", startsAt: new Date("2026-12-12T18:00:00Z"), endsAt: new Date("2026-12-13T18:00:00Z"), timezone: "America/Chicago", featuredOrder: 1, featureUntil: "2026-12-01" },
      { slug: "expired", startsAt: new Date("2026-10-01T18:00:00Z"), endsAt: new Date("2026-10-02T18:00:00Z"), timezone: "America/Chicago", featuredOrder: 1, featureUntil: null },
    ]);
    dependencies.getPrisma.mockReturnValue({ event: { findMany } });
    const rows = await listFeaturedEventRows("2026-10-27");
    expect(findMany.mock.calls[0][0].where).toEqual({ featured: true, isPublished: true, archivedAt: null, showOnCalendar: true });
    expect(rows.map((r) => r.slug)).toEqual(["first", "live"]);
  });

  it("returns an empty list when nothing is featured", async () => {
    dependencies.getPrisma.mockReturnValue({ event: { findMany: vi.fn().mockResolvedValue([]) } });
    expect(await listFeaturedEventRows("2026-10-27", 3)).toEqual([]);
  });

  it("reads card photos only from published header sections of published events, and skips unreadable data", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { data: { assetId: "asset-1", alt: "A lake", subtitle: "", button: { label: "Register", target: "REGISTER" } }, event: { slug: "with-photo" } },
      { data: { nonsense: true }, event: { slug: "broken" } },
    ]);
    dependencies.getPrisma.mockReturnValue({ eventContentSection: { findMany } });
    const images = await listEventCardImages(["with-photo", "broken"]);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ kind: "HERO", isPublished: true, event: { isPublished: true, archivedAt: null } });
    expect([...images.keys()]).toEqual(["with-photo"]);
    expect((await listEventCardImages([])).size).toBe(0);
  });
});

describe("who may feature an event (#1218)", () => {
  const body = {
    name: "Synthetic Retreat", slug: "synthetic-retreat", startsOn: "2026-12-05", endsOn: "2026-12-06", timezone: "America/Chicago",
    location: null, capacity: null, publicInfoUrl: null, supportContact: null, registrationOpensOn: null, registrationClosesOn: null,
    collectsShirtSizes: false, waitlistEnabled: false, autoPromoteWaitlist: false,
    featured: true, featuredOrder: 1, featureUntil: "2026-12-01",
  };
  const patch = () => new Request("https://events.imsda.test/api/events/event-1", {
    method: "PATCH",
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const context = { params: Promise.resolve({ eventId: "event-1" }) };

  it("lets an event administrator feature it", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: null } });
    dependencies.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "u1", role: "EVENT_ADMIN", status: "ACTIVE", permissions: [] });
    dependencies.updateEventSettings.mockResolvedValue({ id: "event-1" });
    expect((await PATCH(patch(), context)).status).toBe(200);
    expect(dependencies.updateEventSettings).toHaveBeenCalledWith("event-1", expect.objectContaining({ featured: true, featuredOrder: 1, featureUntil: "2026-12-01" }), "u1");
  });

  it.each(["REGISTRATION_MANAGER", "FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF"])("refuses %s", async (role) => {
    dependencies.getCurrentSession.mockResolvedValue({ user: { id: "u2", globalRole: null } });
    dependencies.findActiveMembership.mockResolvedValue({ eventId: "event-1", userId: "u2", role, status: "ACTIVE", permissions: [] });
    expect((await PATCH(patch(), context)).status).toBe(403);
    expect(dependencies.updateEventSettings).not.toHaveBeenCalled();
  });

  it("refuses someone with no assignment to the event, and someone signed out", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: { id: "u3", globalRole: null } });
    dependencies.findActiveMembership.mockResolvedValue(null);
    expect((await PATCH(patch(), context)).status).toBe(403);
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await PATCH(patch(), context)).status).toBe(401);
    expect(dependencies.updateEventSettings).not.toHaveBeenCalled();
  });

  it("validates the order and date, and keeps stored values when the fields are absent", () => {
    const { featured: _f, featuredOrder: _o, featureUntil: _u, ...rest } = body;
    void _f; void _o; void _u;
    const absent = eventSettingsInputSchema.parse(rest);
    expect(absent.featured).toBeUndefined();
    expect(eventSettingsInputSchema.safeParse({ ...body, featuredOrder: 0 }).success).toBe(false);
    expect(eventSettingsInputSchema.safeParse({ ...body, featuredOrder: 1.5 }).success).toBe(false);
    expect(eventSettingsInputSchema.safeParse({ ...body, featureUntil: "soon" }).success).toBe(false);
    expect(eventSettingsInputSchema.safeParse({ ...body, featuredOrder: null, featureUntil: null }).success).toBe(true);
  });

  it("carries the three fields through the settings form draft and request body", () => {
    const draft = draftFromEvent({ featured: true, featuredOrder: 2, featureUntil: "2026-12-01" } as never);
    expect(draft).toMatchObject({ featured: true, featuredOrder: 2, featureUntil: "2026-12-01" });
    expect(draftFromEvent(null)).toMatchObject({ featured: false, featuredOrder: null, featureUntil: null });
    expect(eventSettingsRequestBody({ ...draft, featuredOrder: 0 as never, featureUntil: "" as never })).toMatchObject({ featuredOrder: null, featureUntil: null });
  });
});

describe("featured changes are audited (#1218)", () => {
  const input = {
    name: "Synthetic Retreat", slug: "synthetic-retreat", startsOn: "2027-10-08", endsOn: "2027-10-10", timezone: "America/Chicago" as const,
    location: null, capacity: null, publicInfoUrl: null, supportContact: null, registrationOpensOn: null, registrationClosesOn: null,
    collectsShirtSizes: false, checksAdultBackgrounds: false, hostedPaymentLinkEnabled: false, attendeeEditPolicy: "VERIFY_EVERY_EDIT" as const,
    billingMode: "ATTENDEE_PAY" as const, audience: "GENERAL" as const, seminarPreferenceClosesOn: null, seminarPreferenceSelfServiceLocked: false,
    waitlistEnabled: false, autoPromoteWaitlist: false,
  };
  function setup(current: { featured: boolean; featuredOrder: number | null; featureUntil: string | null }) {
    const eventUpdate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      event: {
        findUnique: vi.fn().mockResolvedValue({
          ...input, startsAt: new Date("2027-10-08T12:00:00Z"), endsAt: new Date("2027-10-10T12:00:00Z"), isPublished: true, ...current,
        }),
        update: eventUpdate,
      },
      eventPaymentInstructionVersion: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
      promoCode: { count: vi.fn().mockResolvedValue(0) },
      auditLog: { create: auditCreate },
    };
    dependencies.getPrisma.mockReturnValue({
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
      event: { findUnique: vi.fn().mockResolvedValue(null) },
      registrationForm: { findMany: vi.fn().mockResolvedValue([]) },
      eventPaymentInstructionVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    return { eventUpdate, auditCreate };
  }

  it("writes who, what and the old and new values when an event is featured", async () => {
    const { eventUpdate, auditCreate } = setup({ featured: false, featuredOrder: null, featureUntil: null });
    await actualRepository.updateEventSettings("event-1", { ...input, featured: true, featuredOrder: 1, featureUntil: "2027-10-01" }, "user-9");
    expect(eventUpdate.mock.calls[0][0].data).toMatchObject({ featured: true, featuredOrder: 1, featureUntil: "2027-10-01" });
    const entries = auditCreate.mock.calls.map((call) => call[0].data);
    const featuredEntry = entries.find((entry) => entry.action === "EVENT_FEATURED_CHANGED");
    expect(featuredEntry).toMatchObject({
      eventId: "event-1", actorUserId: "user-9", entityType: "Event", entityId: "event-1",
      metadata: {
        before: { featured: false, featuredOrder: null, featureUntil: null },
        after: { featured: true, featuredOrder: 1, featureUntil: "2027-10-01" },
      },
    });
    expect(entries.some((entry) => entry.action === "EVENT_SETTINGS_UPDATED")).toBe(true);
  });

  it("writes no featured entry, and leaves the stored values alone, when a save does not touch them", async () => {
    const { eventUpdate, auditCreate } = setup({ featured: true, featuredOrder: 2, featureUntil: null });
    await actualRepository.updateEventSettings("event-1", input, "user-9");
    const data = eventUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect("featured" in data || "featuredOrder" in data || "featureUntil" in data).toBe(false);
    expect(auditCreate.mock.calls.map((call) => call[0].data.action)).toEqual(["EVENT_SETTINGS_UPDATED"]);
  });

  it("records unfeaturing", async () => {
    const { auditCreate } = setup({ featured: true, featuredOrder: 1, featureUntil: null });
    await actualRepository.updateEventSettings("event-1", { ...input, featured: false }, "user-9");
    expect(auditCreate.mock.calls.map((call) => call[0].data).find((entry) => entry.action === "EVENT_FEATURED_CHANGED")?.summary).toMatch(/Stopped featuring/);
  });
});

describe("photo cards and the Coming up strip (#1210, #1218)", () => {
  const render = (node: React.ReactNode) => renderToStaticMarkup(createElement("ul", null, node));

  it("styles the strip and Featured headings like the old Coming up heading", () => {
    expect(css).toMatch(/\.event-featured > h2, \.event-photo-strip-head h2 \{ margin: 0; color: var\(--ink\); font-size: 1\.25rem; \}/);
  });

  it("renders a linked card with date, title and the shared status, and a decorative resized photo", () => {
    const images = new Map([["fall", { assetId: "asset-1" }]]);
    const open = item("fall", { registrationOpen: true, registrationStatus: "OPEN" });
    const html = render(createElement(EventPhotoCard, { item: open, image: eventCardImage(open, images) }));
    expect(html).toContain('<a class="event-photo-card-link" href="/events/fall">Title fall</a>');
    expect(html).toContain("<h3>");
    expect(html).toContain("December 5–6, 2026");
    expect(html).toContain("Registration open");
    expect(html).toContain('alt=""');
    expect(html).toContain("/api/public/events/fall/assets/asset-1?w=640");
    expect(html).toMatch(/srcSet="[^"]*\?w=960 960w/);
    expect(html).toContain('width="640"');
    expect(html).toContain('height="360"');
    expect(html).not.toContain("is-plain");
  });

  it("gives an event with no photo the navy card with its date", () => {
    const html = render(createElement(EventPhotoCard, { item: item("plain"), image: eventCardImage(item("plain"), new Map()) }));
    expect(html).toContain("is-plain");
    expect(html).toContain("event-photo-card-date-block");
    expect(html).not.toContain("<img");
  });

  it("uses an h4 title under the calendar's Featured h3", () => {
    const html = render(createElement(EventPhotoCard, { item: item("x"), headingLevel: 4 }));
    expect(html).toContain("<h4>");
    expect(html).not.toContain("<h3>");
  });

  it("marks a cancelled item and keeps a link-less item as plain text", () => {
    const html = render([
      createElement(EventPhotoCard, { key: "a", item: item("gone", { status: "CANCELLED" }) }),
      createElement(EventPhotoCard, { key: "b", item: item("none", { kind: "ENTRY", href: null }) }),
    ]);
    expect(html).toContain("is-cancelled");
    expect(html).toContain("Cancelled");
    expect(html).toMatch(/<span class="event-photo-card-link">Title none<\/span>/);
  });

  it("builds the homepage strip as a labelled list with a See all link", () => {
    const page = readFileSync("app/page.tsx", "utf8");
    expect(page).toContain('<ul aria-labelledby="home-upcoming-heading" className="event-photo-list">');
    expect(page).toContain('id="home-upcoming-heading"');
    expect(page).toContain('href="/calendar?view=list">See all');
    expect(page).toContain('<ul aria-labelledby="home-featured-heading"');
  });

  it("keeps the strip inside its own box, motion off for reduced motion, text and taps at the floors", () => {
    expect(css).toMatch(/\.event-photo-list \{[^}]*overflow-x: auto[^}]*scroll-snap-type: x mandatory/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.event-photo-list \{ scroll-snap-type: none; scroll-behavior: auto; \}/);
    expect(css).toMatch(/\.event-photo-list > li \{ flex: 0 0 min\(78vw, 300px\)/);
    expect(css).toMatch(/\.event-photo-see-all \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.event-photo-card:focus-within \{ outline: 3px solid/);
    expect(css).toMatch(/\.event-photo-card-link::after \{ content: ""; position: absolute; inset: 0; \}/);
    expect(css).toMatch(/\.event-photo-card-media \{ aspect-ratio: 16 \/ 9; background: var\(--imsda-navy\)/);
    const block = css.slice(css.indexOf("/* Photo cards:"), css.indexOf("/* Registration form builder editor shell (#1132)"));
    expect(block).not.toMatch(/gradient|backdrop-filter/);
    expect([...block.matchAll(/font-size: ([\d.]+)rem/g)].every((m) => Number(m[1]) >= 0.875)).toBe(true);
  });
});

describe("calendar list view pins featured events (#1218)", () => {
  it("renders a Featured group above the list in list view only, and keeps the pinned event out of the list", () => {
    const page = readFileSync("app/(public)/calendar/page.tsx", "utf8");
    expect(page).toContain('view === "list" ? featuredItemsFor(items, await listFeaturedEventRows(today)) : []');
    expect(page).toContain('<ul aria-labelledby="calendar-featured-heading" className="event-featured-list">');
    expect(page).toContain("headingLevel={4}");
    expect(page).toContain("groupByMonth(listItems, today)");
    expect(page.indexOf("calendar-featured-heading")).toBeLessThan(page.indexOf("groupByMonth(listItems"));
  });
});
