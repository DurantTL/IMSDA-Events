import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Event page publishing (#1514): scheduled publish, published versions and rollback, and the private preview link.
 * Synthetic data and an in-memory stand-in for the database.
 */

type Section = {
  id: string; eventId: string; kind: string; title: string; body: string; tone: string | null; placement: string;
  items: unknown; data: unknown; position: number; isPublished: boolean; scheduledPublishAt: Date | null;
  links: Array<{ label: string; description: string; url: string | null; assetId: string | null }>;
};
type Version = { id: string; eventId: string; versionNumber: number; sections: unknown; source: string; restoredFromId: string | null; createdByUserId: string | null; createdAt: Date; createdBy?: { displayName: string } | null };
type PreviewLink = { id: string; eventId: string; tokenHash: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null; revokedByUserId: string | null };

const db = vi.hoisted(() => ({
  sections: [] as Section[],
  versions: [] as Version[],
  links: [] as PreviewLink[],
  audits: [] as Array<{ action: string; actorUserId: string | null; metadata: Record<string, unknown> | null; summary: string }>,
  failEvent: null as string | null,
  nextId: 1,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/modules/events/image-library", () => ({ keepHeaderImageInLibrary: async () => undefined }));

function matches(section: Section, where: Record<string, any> = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (where.eventId !== undefined && section.eventId !== where.eventId) return false;
  if (where.kind !== undefined && section.kind !== where.kind) return false;
  if (where.isPublished !== undefined && section.isPublished !== where.isPublished) return false;
  if (where.id?.in && !where.id.in.includes(section.id)) return false;
  if (where.scheduledPublishAt?.lte && !(section.scheduledPublishAt && section.scheduledPublishAt <= where.scheduledPublishAt.lte)) return false;
  return true;
}

vi.mock("@/lib/prisma", () => {
  const tx = {
    eventAsset: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, contentType: "image/png" })) },
    eventContentSection: {
      findMany: async (args: { where?: Record<string, unknown>; distinct?: string[] } = {}) => {
        const rows = db.sections.filter((section) => matches(section, args.where)).sort((a, b) => a.position - b.position);
        if (args.distinct?.includes("eventId")) return [...new Map(rows.map((row) => [row.eventId, { eventId: row.eventId }])).values()];
        return rows.map((row) => ({ ...row }));
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => { db.sections = db.sections.filter((section) => !matches(section, where)); },
      create: async ({ data }: { data: Record<string, any> }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        db.sections.push({
          id: `sec-${db.nextId++}`, eventId: data.eventId, kind: data.kind, title: data.title, body: data.body, tone: data.tone, placement: data.placement,
          items: data.items, data: data.data, position: data.position, isPublished: data.isPublished, scheduledPublishAt: data.scheduledPublishAt ?? null,
          links: (data.links?.create ?? []).map((link: Record<string, unknown>) => ({ label: link.label, description: link.description, url: link.url, assetId: link.assetId })),
        } as Section);
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Section> }) => {
        const hit = db.sections.filter((section) => matches(section, where));
        for (const section of hit) Object.assign(section, data);
        return { count: hit.length };
      },
    },
    auditLog: {
      create: async ({ data }: { data: { action: string; actorUserId: string | null; metadata: Record<string, unknown> | null; summary: string } }) => {
        if (db.failEvent && (data as { eventId?: string } & typeof data).eventId === db.failEvent) throw new Error("synthetic failure");
        db.audits.push(data);
      },
    },
    eventPageVersion: {
      findFirst: async ({ where }: { where: { eventId: string } }) => (
        [...db.versions].filter((version) => version.eventId === where.eventId).sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null
      ),
      create: async ({ data }: { data: Omit<Version, "id" | "createdAt"> }) => { db.versions.push({ ...data, id: `ver-${db.nextId++}`, createdAt: new Date() }); },
    },
    eventPagePreviewLink: {
      updateMany: async ({ where, data }: { where: { eventId: string; revokedAt: null; expiresAt?: { gt: Date } }; data: Partial<PreviewLink> }) => {
        const hit = db.links.filter((link) => link.eventId === where.eventId && link.revokedAt === null && (!where.expiresAt || link.expiresAt > where.expiresAt.gt));
        for (const link of hit) Object.assign(link, data);
        return { count: hit.length };
      },
      create: async ({ data }: { data: Omit<PreviewLink, "id" | "revokedAt" | "revokedByUserId"> }) => { db.links.push({ ...data, id: `lnk-${db.nextId++}`, revokedAt: null, revokedByUserId: null }); },
      findFirst: async ({ where }: { where: { eventId?: string; tokenHash?: string; revokedAt: null; expiresAt: { gt: Date } } }) => (
        db.links.find((link) => (where.eventId === undefined || link.eventId === where.eventId) && (where.tokenHash === undefined || link.tokenHash === where.tokenHash)
          && link.revokedAt === null && link.expiresAt > where.expiresAt.gt) ?? null
      ),
    },
  };
  const client = {
    ...tx,
    $transaction: async (run: (client: typeof tx) => unknown) => run(tx),
    eventPageVersion: { ...tx.eventPageVersion, findFirst: async (args: { where: { id?: string; eventId: string } }) => {
      if (args.where.id) return db.versions.find((version) => version.id === args.where.id && version.eventId === args.where.eventId) ?? null;
      return tx.eventPageVersion.findFirst(args as { where: { eventId: string } });
    } },
  };
  return { getPrisma: () => client };
});

import { eventContentInputSchema, eventContentSectionInputSchema } from "@/modules/events/content-schemas";
import { EventContentError, replaceEventContent } from "@/modules/events/content-repository";
import { publishDueEventPageSections } from "@/modules/events/page-schedule-sweep";
import { PageVersionRestoreError, restoreEventPageVersion } from "@/modules/events/page-restore";
import { createPreviewLink, findPreviewLinkByToken, revokePreviewLink } from "@/modules/events/preview-link-repository";
import { stableJson } from "@/modules/events/page-versions";
import { centralLocalToIso, isoToCentralLocal } from "@/modules/events/content-schedule";

const NOW = new Date("2027-03-10T15:00:00.000Z");
const text = (title: string, patch: Record<string, unknown> = {}) => ({ kind: "RICH_TEXT", title, body: `${title} body.`, isPublished: true, ...patch });
const save = (sections: unknown[], options: { isSystemAdmin?: boolean } = {}) => (
  replaceEventContent("event-1", eventContentInputSchema.parse({ sections }), "user-1", options)
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db.sections = []; db.versions = []; db.links = []; db.audits = []; db.failEvent = null; db.nextId = 1;
});
afterEach(() => vi.useRealTimers());

describe("scheduledPublishAt on a section", () => {
  const parse = (value: unknown, isPublished = false) => eventContentSectionInputSchema.safeParse({ ...text("Hours", { isPublished }), scheduledPublishAt: value });

  it("accepts a future time, an empty value and none", () => {
    expect(parse("2027-03-11T15:00:00.000Z").success).toBe(true);
    expect(parse("").success).toBe(true);
    expect(parse(null).success).toBe(true);
    expect(eventContentSectionInputSchema.safeParse(text("Hours")).success).toBe(true);
  });

  it("refuses a time that is not in the future, with a plain message", () => {
    const result = parse("2027-03-10T14:00:00.000Z");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Choose a publish time that is still in the future, or clear it.");
    expect(parse("2027-03-10T15:00:00.000Z").success).toBe(false);
  });

  it("refuses text that is not a date and time", () => {
    expect(parse("next Tuesday").success).toBe(false);
  });

  it("does not complain about a past time on a published section, and stores none", async () => {
    expect(parse("2027-03-01T00:00:00.000Z", true).success).toBe(true);
    await save([text("Hours", { scheduledPublishAt: "2027-03-01T00:00:00.000Z" })]);
    expect(db.sections[0]?.scheduledPublishAt).toBeNull();
  });

  it("stores the time of an unpublished section", async () => {
    await save([text("Hours", { isPublished: false, scheduledPublishAt: "2027-03-12T15:00:00.000Z" })]);
    expect(db.sections[0]?.scheduledPublishAt?.toISOString()).toBe("2027-03-12T15:00:00.000Z");
  });

  it("converts between Central wall-clock time and an instant, across daylight saving", () => {
    expect(centralLocalToIso("2027-03-10T09:00")).toBe("2027-03-10T15:00:00.000Z");
    expect(centralLocalToIso("2027-03-20T09:00")).toBe("2027-03-20T14:00:00.000Z");
    expect(isoToCentralLocal("2027-03-20T14:00:00.000Z")).toBe("2027-03-20T09:00");
    expect(isoToCentralLocal(null)).toBe("");
  });
});

describe("custom HTML and the schedule", () => {
  const html = (patch: Record<string, unknown> = {}) => ({ kind: "CUSTOM_HTML", title: "Banner", body: "<p>Hi</p>", isPublished: false, ...patch });

  it("treats setting a schedule on a custom HTML block as a change only a system administrator may make", async () => {
    await save([html()], { isSystemAdmin: true });
    await expect(save([html({ scheduledPublishAt: "2027-03-12T15:00:00.000Z" })])).rejects.toMatchObject({ code: "CUSTOM_HTML_FORBIDDEN" });
    await expect(save([html({ scheduledPublishAt: "2027-03-12T15:00:00.000Z" })], { isSystemAdmin: true })).resolves.toBeTruthy();
    // Carried back unchanged, it is allowed.
    await expect(save([html({ scheduledPublishAt: "2027-03-12T15:00:00.000Z" })])).resolves.toBeTruthy();
  });
});

describe("published versions", () => {
  it("records a version only when what is published changes", async () => {
    await save([text("Welcome")]);
    expect(db.versions.map((version) => version.versionNumber)).toEqual([1]);
    // Saving again with nothing different, or with only a draft added, records nothing.
    await save([text("Welcome")]);
    await save([text("Welcome"), text("Draft", { isPublished: false })]);
    expect(db.versions).toHaveLength(1);
    await save([text("Welcome"), text("Draft", { isPublished: true })]);
    expect(db.versions.map((version) => version.versionNumber)).toEqual([1, 2]);
    expect(db.versions[1]?.source).toBe("SAVE");
    expect((db.versions[1]?.sections as Array<{ title: string; isPublished: boolean }>).map((section) => [section.title, section.isPublished])).toEqual([["Welcome", true], ["Draft", true]]);
  });

  it("records nothing for a page that has never published anything", async () => {
    await save([text("Draft only", { isPublished: false })]);
    expect(db.versions).toHaveLength(0);
  });

  it("compares snapshots regardless of key order", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(stableJson({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 }));
  });

  it("stores a snapshot that parses back through the save schema", async () => {
    await save([text("Welcome")]);
    expect(eventContentInputSchema.safeParse({ sections: db.versions[0]?.sections }).success).toBe(true);
  });
});

describe("the scheduled publish sweep", () => {
  it("publishes due sections once; a second run publishes nothing and writes no second audit row or version", async () => {
    await save([
      text("Live"),
      text("Due", { isPublished: false, scheduledPublishAt: "2027-03-12T15:00:00.000Z" }),
      text("Later", { isPublished: false, scheduledPublishAt: "2027-04-12T15:00:00.000Z" }),
      text("No schedule", { isPublished: false }),
    ]);
    const versionsBefore = db.versions.length;
    const at = new Date("2027-03-13T00:00:00.000Z");

    const first = await publishDueEventPageSections({ now: at });
    expect(first).toEqual({ events: 1, published: 1, failed: 0 });
    expect(db.sections.find((section) => section.title === "Due")).toMatchObject({ isPublished: true, scheduledPublishAt: null });
    expect(db.sections.find((section) => section.title === "Later")).toMatchObject({ isPublished: false });
    expect(db.versions).toHaveLength(versionsBefore + 1);
    expect(db.versions.at(-1)?.source).toBe("SCHEDULED_PUBLISH");
    const audits = db.audits.filter((audit) => audit.action === "EVENT_CONTENT_SCHEDULED_PUBLISHED");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: null, metadata: { publishedCount: 1, titles: ["Due"] } });

    const second = await publishDueEventPageSections({ now: at });
    expect(second).toEqual({ events: 0, published: 0, failed: 0 });
    expect(db.audits.filter((audit) => audit.action === "EVENT_CONTENT_SCHEDULED_PUBLISHED")).toHaveLength(1);
    expect(db.versions).toHaveLength(versionsBefore + 1);
  });

  it("does nothing before the time", async () => {
    await save([text("Due", { isPublished: false, scheduledPublishAt: "2027-03-12T15:00:00.000Z" })]);
    expect(await publishDueEventPageSections({ now: new Date("2027-03-12T14:59:00.000Z") })).toEqual({ events: 0, published: 0, failed: 0 });
  });

  it("carries on with the other events when one fails", async () => {
    db.sections.push(
      { id: "a", eventId: "event-a", kind: "RICH_TEXT", title: "A", body: "x", tone: null, placement: "PUBLIC_PAGE", items: [], data: {}, position: 0, isPublished: false, scheduledPublishAt: new Date("2027-03-01T00:00:00Z"), links: [] },
      { id: "b", eventId: "event-b", kind: "RICH_TEXT", title: "B", body: "x", tone: null, placement: "PUBLIC_PAGE", items: [], data: {}, position: 0, isPublished: false, scheduledPublishAt: new Date("2027-03-01T00:00:00Z"), links: [] },
    );
    // The audit insert for event-a throws, which fails that event's transaction in the real database; here it just surfaces.
    db.failEvent = "event-a";
    const result = await publishDueEventPageSections({ now: NOW });
    expect(result.events).toBe(2);
    expect(result.failed).toBe(1);
    expect(db.sections.find((section) => section.id === "b")?.isPublished).toBe(true);
  });
});

describe("restoring a version", () => {
  it("brings the published sections back and keeps drafts, with their schedule", async () => {
    await save([text("Welcome"), text("Schedule")]);
    await save([text("Welcome"), text("Schedule changed"), text("Draft", { isPublished: false, scheduledPublishAt: "2027-03-15T15:00:00.000Z" })]);
    expect(db.versions).toHaveLength(2);

    const result = await restoreEventPageVersion({ eventId: "event-1", versionId: db.versions[0]!.id, actorUserId: "user-1", isSystemAdmin: false, now: NOW });
    expect(result.versionNumber).toBe(1);
    expect(result.sections.map((section) => [section.title, section.isPublished])).toEqual([["Welcome", true], ["Schedule", true], ["Draft", false]]);
    expect(result.sections[2]?.scheduledPublishAt).toBe("2027-03-15T15:00:00.000Z");
    expect(db.versions.at(-1)).toMatchObject({ versionNumber: 3, source: "ROLLBACK", restoredFromId: db.versions[0]!.id });
    expect(db.audits.at(-1)).toMatchObject({ action: "EVENT_PAGE_ROLLED_BACK", metadata: { versionNumber: 1 } });
  });

  it("drops a draft's schedule that has already passed instead of failing", async () => {
    await save([text("Welcome")]);
    await save([text("Welcome"), text("Extra")]);
    db.sections.push({ id: "old", eventId: "event-1", kind: "RICH_TEXT", title: "Overdue", body: "x", tone: null, placement: "PUBLIC_PAGE", items: [], data: {}, position: 5, isPublished: false, scheduledPublishAt: new Date("2027-03-01T00:00:00Z"), links: [] });
    const result = await restoreEventPageVersion({ eventId: "event-1", versionId: db.versions[0]!.id, actorUserId: "user-1", isSystemAdmin: false, now: NOW });
    const overdue = result.sections.find((section) => section.title === "Overdue");
    expect(overdue).toMatchObject({ isPublished: false, scheduledPublishAt: null });
  });

  it("refuses a version of another event as not found", async () => {
    await save([text("Welcome")]);
    await expect(restoreEventPageVersion({ eventId: "event-2", versionId: db.versions[0]!.id, actorUserId: "user-1", isSystemAdmin: true }))
      .rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
  });

  it("applies the custom HTML rule: an event administrator cannot bring back different custom HTML, a system administrator can", async () => {
    await save([{ kind: "CUSTOM_HTML", title: "Banner", body: "<p>Old</p>", isPublished: true }], { isSystemAdmin: true });
    await save([{ kind: "CUSTOM_HTML", title: "Banner", body: "<p>New</p>", isPublished: true }], { isSystemAdmin: true });
    const oldVersion = db.versions[0]!.id;

    await expect(restoreEventPageVersion({ eventId: "event-1", versionId: oldVersion, actorUserId: "user-1", isSystemAdmin: false }))
      .rejects.toBeInstanceOf(EventContentError);
    expect(db.sections[0]?.body).toBe("<p>New</p>");

    await restoreEventPageVersion({ eventId: "event-1", versionId: oldVersion, actorUserId: "user-1", isSystemAdmin: true });
    expect(db.sections[0]?.body).toBe("<p>Old</p>");
  });

  it("says the version can no longer be restored when its sections no longer parse", async () => {
    db.versions.push({ id: "bad", eventId: "event-1", versionNumber: 1, sections: [{ kind: "NOT_A_KIND", title: "x" }], source: "SAVE", restoredFromId: null, createdByUserId: null, createdAt: NOW });
    const error = await restoreEventPageVersion({ eventId: "event-1", versionId: "bad", actorUserId: "user-1", isSystemAdmin: true }).catch((caught) => caught);
    expect(error).toBeInstanceOf(PageVersionRestoreError);
    expect(error.message).toBe("This version can no longer be restored.");
  });
});

describe("the preview link", () => {
  it("makes a link, stores only its hash, and lets the token find the event", async () => {
    const created = await createPreviewLink("event-1", "user-1", NOW);
    expect(db.links).toHaveLength(1);
    expect(db.links[0]?.tokenHash).not.toContain(created.token);
    expect(created.expiresAt).toBe("2027-03-24T15:00:00.000Z");
    expect(await findPreviewLinkByToken(created.token, NOW)).toMatchObject({ eventId: "event-1" });
    expect(JSON.stringify(db.audits)).not.toContain(created.token);
    expect(db.audits.at(-1)?.action).toBe("EVENT_PAGE_PREVIEW_LINK_CREATED");
  });

  it("revokes the previous link when a new one is made", async () => {
    const first = await createPreviewLink("event-1", "user-1", NOW);
    const second = await createPreviewLink("event-1", "user-1", new Date(NOW.getTime() + 1000));
    expect(await findPreviewLinkByToken(first.token, NOW)).toBeNull();
    expect(await findPreviewLinkByToken(second.token, NOW)).toMatchObject({ eventId: "event-1" });
    expect(db.links.filter((link) => link.revokedAt === null)).toHaveLength(1);
  });

  it("does not find an expired, revoked or unknown token", async () => {
    const created = await createPreviewLink("event-1", "user-1", NOW);
    expect(await findPreviewLinkByToken(created.token, new Date("2027-03-24T15:00:00.001Z"))).toBeNull();
    expect(await findPreviewLinkByToken("unknown-token", NOW)).toBeNull();
    expect(await findPreviewLinkByToken("", NOW)).toBeNull();
    expect(await revokePreviewLink("event-1", "user-1", NOW)).toBe(true);
    expect(await findPreviewLinkByToken(created.token, NOW)).toBeNull();
    expect(await revokePreviewLink("event-1", "user-1", NOW)).toBe(false);
    expect(db.audits.filter((audit) => audit.action === "EVENT_PAGE_PREVIEW_LINK_REVOKED")).toHaveLength(1);
  });
});
