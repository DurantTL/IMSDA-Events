import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storageDir = mkdtempSync(path.join(tmpdir(), "image-library-test-"));
process.env.ASSET_STORAGE_DIR = storageDir;

const dependencies = vi.hoisted(() => ({ getPrisma: vi.fn(), logError: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  return { ...actual, logError: dependencies.logError };
});

import { writeAsset } from "@/modules/events/asset-storage";
import {
  addEventAssetToLibrary,
  addUploadToLibrary,
  ImageLibraryError,
  keepHeaderImageInLibrary,
  keepPublishedHeaderImagesForEvent,
  listLibraryImages,
  normalizeTags,
  setLibraryImageRetired,
  syncHeaderImagesToLibrary,
  updateLibraryImageTags,
  applyLibraryImageToEvent,
} from "@/modules/events/image-library";

type Row = Record<string, unknown> & { id: string };

/** A tiny in-memory stand-in for the four tables the library touches. */
function fakeDatabase() {
  const library: Row[] = [];
  const assets: Row[] = [];
  /** Asset ids a content block shows. */
  const shown = new Set<string>();
  const audits: Row[] = [];
  const events: Row[] = [
    { id: "event_a", name: "Camporee 2026", startsAt: new Date("2026-05-01T00:00:00.000Z"), isPublished: true, archivedAt: null },
    { id: "event_b", name: "Retreat 2027", startsAt: new Date("2027-03-01T00:00:00.000Z"), isPublished: true, archivedAt: null },
    { id: "event_draft", name: "Draft Event", startsAt: new Date("2027-04-01T00:00:00.000Z"), isPublished: false, archivedAt: null },
  ];
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}_${++counter}`;
  const pick = (row: Row | undefined) => (row ? { ...row } : null);
  const client = {
    event: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => pick(events.find((e) => e.id === where.id))) },
    eventImageLibraryImage: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; checksum?: string } }) => {
        const row = library.find((r) => (where.id ? r.id === where.id : r.checksum === where.checksum));
        if (!row) return null;
        return {
          ...row,
          copies: assets.filter((a) => a.libraryImageId === row.id && shown.has(a.id)).map((a) => ({
            event: { id: a.eventId, name: events.find((e) => e.id === a.eventId)?.name },
          })),
        };
      }),
      findMany: vi.fn(async ({ where }: { where?: { AND?: Array<Record<string, unknown>> } } = {}) => {
        const includeRetired = !(where?.AND ?? []).some((clause) => "retiredAt" in clause);
        return library
          .filter((r) => includeRetired || r.retiredAt === null)
          .map((r) => ({
            ...r,
            copies: assets.filter((a) => a.libraryImageId === r.id && shown.has(a.id)).map((a) => ({ event: { id: a.eventId, name: events.find((e) => e.id === a.eventId)?.name } })),
          }));
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { tags: [], retiredAt: null, createdAt: new Date("2026-11-12T00:00:00.000Z"), ...data, id: nextId("lib") } as Row;
        library.push(row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = library.find((r) => r.id === where.id);
        if (!row) throw new Prisma.PrismaClientKnownRequestError("missing", { code: "P2025", clientVersion: "test" });
        Object.assign(row, data);
        return { ...row };
      }),
    },
    eventAsset: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => pick(assets.find((a) => a.id === where.id))),
      findFirst: vi.fn(async ({ where }: { where: { eventId: string; OR: Array<{ libraryImageId?: string; checksum?: string }> } }) => (
        pick(assets.find((a) => a.eventId === where.eventId && where.OR.some((c) => (c.libraryImageId ? a.libraryImageId === c.libraryImageId : a.checksum === c.checksum))))
      )),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { createdAt: new Date(), libraryImageId: null, ...data, id: nextId("asset") } as Row;
        assets.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(assets.find((a) => a.id === where.id)!, data);
        return {};
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: Row }) => { audits.push(data as Row); return {}; }) },
    eventContentSection: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(client)),
  };
  dependencies.getPrisma.mockReturnValue(client);
  return { client, library, assets, audits, shown };
}

// Real file signatures, so the checks are the production checks.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_2 = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);

function file(bytes: Uint8Array, type: string, name = "header.png") {
  return new File([bytes as BlobPart], name, { type });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeTags", () => {
  it("trims, lower-cases, collapses spaces and de-duplicates", () => {
    expect(normalizeTags(["  Camporee ", "camporee", "Forest  Scene", "", "  "])).toEqual(["camporee", "forest scene"]);
    expect(normalizeTags("Retreat, retreat ,Lantern")).toEqual(["retreat", "lantern"]);
  });

  it("refuses too many tags, a tag that is too long, and non-text entries", () => {
    expect(() => normalizeTags(Array.from({ length: 13 }, (_, i) => `tag${i}`))).toThrow(ImageLibraryError);
    expect(() => normalizeTags(["x".repeat(31)])).toThrow(ImageLibraryError);
    expect(() => normalizeTags([5])).toThrow(ImageLibraryError);
  });
});

describe("adding an upload to the library", () => {
  it("refuses a PDF, an oversize file and bytes that do not match the claimed type", async () => {
    const db = fakeDatabase();
    await expect(addUploadToLibrary(file(PDF, "application/pdf", "a.pdf"), "usr_1", "event_a"))
      .rejects.toMatchObject({ code: "IMAGE_TYPE_NOT_ALLOWED" });
    const big = file(PNG, "image/png");
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    await expect(addUploadToLibrary(big, "usr_1", "event_a")).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
    await expect(addUploadToLibrary(file(PDF, "image/png"), "usr_1", "event_a"))
      .rejects.toMatchObject({ code: "IMAGE_CONTENT_MISMATCH" });
    expect(db.library).toHaveLength(0);
  });

  it("records no source title or date for an unpublished or archived event", async () => {
    const db = fakeDatabase();
    await addUploadToLibrary(file(PNG, "image/png"), "usr_1", "event_draft");
    expect(db.library[0]).toMatchObject({ sourceEventId: null, sourceEventTitle: "", sourceEventStartsAt: null });
    (db.client.event.findUnique as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      id: "event_a", name: "Camporee 2026", startsAt: new Date(), isPublished: true, archivedAt: new Date(),
    });
    await addUploadToLibrary(file(PNG_2, "image/png"), "usr_1", "event_a");
    expect(db.library[1]).toMatchObject({ sourceEventId: null, sourceEventTitle: "" });
  });

  it("stores its own copy with the event's title and start, and does not add the same bytes twice", async () => {
    const db = fakeDatabase();
    const first = await addUploadToLibrary(file(PNG, "image/png"), "usr_1", "event_a");
    const again = await addUploadToLibrary(file(PNG, "image/png", "renamed.png"), "usr_1", "event_b");
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    expect(db.library).toHaveLength(1);
    expect(db.library[0]).toMatchObject({
      sourceEventTitle: "Camporee 2026",
      sourceEventStartsAt: new Date("2026-05-01T00:00:00.000Z"),
      createdByUserId: "usr_1",
    });
    expect(String(db.library[0].storageKey)).toMatch(/^image-library/);
  });
});

describe("using a library image in an event", () => {
  it("copies the file into the event once and reuses it afterwards", async () => {
    const db = fakeDatabase();
    const { id } = await addUploadToLibrary(file(PNG, "image/png"), "usr_1", "event_a");
    const first = await applyLibraryImageToEvent("event_b", id, "usr_2");
    const second = await applyLibraryImageToEvent("event_b", id, "usr_2");
    expect(first.reused).toBe(false);
    expect(second).toEqual({ assetId: first.assetId, reused: true });
    expect(db.assets).toHaveLength(1);
    expect(db.assets[0]).toMatchObject({ eventId: "event_b", libraryImageId: id, uploadedByUserId: "usr_2" });
    // The event's copy is its own file, apart from the library's.
    expect(db.assets[0].storageKey).not.toBe(db.library[0].storageKey);
    // A copy nothing shows is not "used".
    expect((await listLibraryImages("event_b"))[0].usage).toEqual({ eventCount: 0, eventTitles: [] });
    db.shown.add(first.assetId);
    const all = { configurableEventIds: async (ids: string[]) => new Set(ids) };
    expect((await listLibraryImages("event_b", {}, all))[0].usage).toEqual({ eventCount: 1, eventTitles: ["Retreat 2027"] });
    // A viewer who cannot configure that event sees the count but not its title.
    const none = { configurableEventIds: async () => new Set<string>() };
    expect((await listLibraryImages("event_a", {}, none))[0].usage).toEqual({ eventCount: 1, eventTitles: [] });
  });

  it("refuses a retired image, and an image that is not there", async () => {
    const db = fakeDatabase();
    const { id } = await addUploadToLibrary(file(PNG, "image/png"), "usr_1", "event_a");
    await setLibraryImageRetired("event_a", id, true, "usr_1");
    await expect(applyLibraryImageToEvent("event_b", id, "usr_2")).rejects.toMatchObject({ code: "IMAGE_RETIRED" });
    await expect(applyLibraryImageToEvent("event_b", "missing", "usr_2")).rejects.toMatchObject({ code: "IMAGE_NOT_FOUND" });
    expect(db.assets).toHaveLength(0);
  });
});

describe("retiring", () => {
  it("hides the image from the list but leaves events' copies and the library file alone", async () => {
    const db = fakeDatabase();
    const { id } = await addUploadToLibrary(file(PNG, "image/png"), "usr_1", "event_a");
    const { assetId } = await applyLibraryImageToEvent("event_b", id, "usr_2");
    const assetBefore = { ...db.assets.find((a) => a.id === assetId)! };

    await setLibraryImageRetired("event_b", id, true, "usr_1");
    expect(await listLibraryImages("event_b")).toHaveLength(0);
    expect(await listLibraryImages("event_b", { includeRetired: true })).toHaveLength(1);
    expect(db.assets.find((a) => a.id === assetId)).toEqual(assetBefore);
    expect(existsSync(path.join(storageDir, String(db.library[0].storageKey)))).toBe(true);
    expect(db.audits.at(-1)).toMatchObject({ action: "EVENT_IMAGE_LIBRARY_RETIRED", eventId: "event_b", metadata: { imageId: id, sourceEventId: "event_a" } });

    await setLibraryImageRetired("event_b", id, false, "usr_1");
    expect(await listLibraryImages("event_b")).toHaveLength(1);
    expect(db.library[0]).toMatchObject({ retiredAt: null, retiredByUserId: null });
  });
});

describe("tags", () => {
  it("stores the normalized list", async () => {
    const db = fakeDatabase();
    const { id } = await addUploadToLibrary(file(PNG, "image/png"), "usr_1", "event_a");
    expect(await updateLibraryImageTags("event_b", id, [" Camporee", "FOREST", "forest"], "usr_2")).toEqual(["camporee", "forest"]);
    expect(db.library[0].tags).toEqual(["camporee", "forest"]);
    expect(db.audits.at(-1)).toMatchObject({
      action: "EVENT_IMAGE_LIBRARY_TAGS_CHANGED",
      eventId: "event_b",
      actorUserId: "usr_2",
      metadata: { imageId: id, sourceEventId: "event_a" },
    });
    await expect(updateLibraryImageTags("event_b", "missing", ["a"], "usr_2")).rejects.toMatchObject({ code: "IMAGE_NOT_FOUND" });
  });
});

describe("keeping header images", () => {
  async function eventAsset(db: ReturnType<typeof fakeDatabase>, eventId: string, bytes: Uint8Array) {
    const stored = await writeAsset(eventId, "image/png", bytes);
    const row = await db.client.eventAsset.create({
      data: {
        eventId,
        displayName: "hero.png",
        contentType: "image/png",
        byteSize: stored.byteSize,
        checksum: stored.checksum,
        storageKey: stored.storageKey,
        uploadedByUserId: "usr_1",
      } as never,
    });
    return row.id;
  }

  it("adds a header image once, carrying the alt text and event, and links the event's file", async () => {
    const db = fakeDatabase();
    const assetId = await eventAsset(db, "event_a", PNG);
    await keepHeaderImageInLibrary("event_a", assetId, "A forest at dawn");
    await keepHeaderImageInLibrary("event_a", assetId, "A forest at dawn");
    expect(db.library).toHaveLength(1);
    expect(db.library[0]).toMatchObject({
      altText: "A forest at dawn",
      sourceEventTitle: "Camporee 2026",
      checksum: db.assets[0].checksum,
    });
    expect(db.assets[0].libraryImageId).toBe(db.library[0].id);
  });

  it("never adds a banner of a draft or archived event", async () => {
    const db = fakeDatabase();
    const draftAsset = await eventAsset(db, "event_draft", PNG);
    await keepHeaderImageInLibrary("event_draft", draftAsset, "Draft");
    (db.client.event.findUnique as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({ isPublished: true, archivedAt: new Date() });
    const archivedAsset = await eventAsset(db, "event_a", PNG_2);
    await keepHeaderImageInLibrary("event_a", archivedAsset, "Archived");
    expect(db.library).toHaveLength(0);
  });

  it("fills in alt text on an existing library image that has none", async () => {
    const db = fakeDatabase();
    const first = await eventAsset(db, "event_a", PNG);
    await keepHeaderImageInLibrary("event_a", first, "");
    expect(db.library[0].altText).toBe("");
    await keepHeaderImageInLibrary("event_a", first, "Pines at dawn");
    expect(db.library[0].altText).toBe("Pines at dawn");
    await keepHeaderImageInLibrary("event_a", first, "Something else");
    expect(db.library[0].altText).toBe("Pines at dawn");
  });

  it("publishing an event keeps its published banner only", async () => {
    const db = fakeDatabase();
    const asset = await eventAsset(db, "event_a", PNG);
    db.client.eventContentSection.findMany.mockResolvedValue([{ data: { assetId: asset, alt: "Pines" } }] as never);
    await keepPublishedHeaderImagesForEvent("event_a");
    expect(db.client.eventContentSection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { eventId: "event_a", kind: "HERO", isPublished: true },
    }));
    expect(db.library).toHaveLength(1);
  });

  it("never fails the save: a library error is logged and swallowed", async () => {
    const db = fakeDatabase();
    db.client.eventAsset.findUnique.mockRejectedValueOnce(new Error("database down"));
    await expect(keepHeaderImageInLibrary("event_a", "asset_x", "alt")).resolves.toBeUndefined();
    expect(dependencies.logError).toHaveBeenCalled();
  });

  it("backfill adds each existing header image and is safe to repeat", async () => {
    const db = fakeDatabase();
    const one = await eventAsset(db, "event_a", PNG);
    const two = await eventAsset(db, "event_b", PNG_2);
    db.client.eventContentSection.findMany.mockResolvedValue([
      { eventId: "event_a", data: { assetId: one, alt: "One" } },
      { eventId: "event_b", data: { assetId: two, alt: "Two" } },
      { eventId: "event_b", data: { assetId: "" } },
    ] as never);
    expect(await syncHeaderImagesToLibrary()).toEqual({ added: 2, alreadyThere: 0, skipped: 1 });
    // Only published banners of published, unarchived events are read.
    expect(db.client.eventContentSection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { kind: "HERO", isPublished: true, event: { isPublished: true, archivedAt: null } },
    }));
    expect(await syncHeaderImagesToLibrary()).toEqual({ added: 0, alreadyThere: 2, skipped: 1 });
    expect(db.library).toHaveLength(2);
  });

  it("does not add a PDF or a missing file", async () => {
    const db = fakeDatabase();
    expect(await addEventAssetToLibrary("nope")).toBeNull();
    expect(db.library).toHaveLength(0);
  });
});
