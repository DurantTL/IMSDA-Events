import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * The registration look's route and repository (#283, slice 1): who may use it, that a publish re-checks contrast on the server,
 * and that publishing archives the previous version in the same transaction. Session, membership and database are stubbed;
 * the permission check, the schema and the repository are real. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  readAsset: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/events/asset-storage", () => ({ readAsset: mocks.readAsset }));

import { GET, PATCH, POST, PUT } from "@/app/api/events/[eventId]/registration-theme/route";
import { PLATFORM_DEFAULT_THEME } from "@/modules/registration-themes/tokens";
import sharp from "sharp";

const staff = { id: "staff-1", email: "staff@example.test", displayName: "Staff Member" };
const membership = (role: string) => ({ eventId: "event-1", userId: "staff-1", role, status: "ACTIVE", permissions: [] });
const context = { params: Promise.resolve({ eventId: "event-1" }) };
const good = { ...PLATFORM_DEFAULT_THEME, primary: "#1b4d3e" };
const lowContrast = { ...PLATFORM_DEFAULT_THEME, primary: "#f0b323", muted: "#bbbbbb" };

function request(method: string, body?: unknown) {
  return new Request("https://events.imsda.test/api/events/event-1/registration-theme", {
    method,
    headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type Asset = { id: string; eventId: string; displayName: string; contentType: string; byteSize: number; storageKey: string; createdAt?: Date };
type Row = { logoAssetId?: string | null; heroAssetId?: string | null; updatedAt?: Date; id: string; eventId: string; versionNumber: number; status: string; tokens: unknown; createdAt: Date; publishedAt: Date | null; archivedAt: Date | null; publishedByUserId?: string | null };

/** An in-memory stand-in for the one table the repository touches. */
function database(initial: Row[] = [], assets: Asset[] = [], event = { clubEmailsUseRegistrationLook: false }) {
  const rows: Row[] = initial.map((entry) => ({ ...entry, logoAssetId: entry.logoAssetId ?? null, heroAssetId: entry.heroAssetId ?? null }));
  const matches = (row: Row, where: Record<string, unknown> = {}) => Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value);
  const tx = {
    event: {
      findUnique: vi.fn(async () => ({ clubEmailsUseRegistrationLook: event.clubEmailsUseRegistrationLook })),
      update: vi.fn(async ({ data }: { data: { clubEmailsUseRegistrationLook: boolean } }) => { event.clubEmailsUseRegistrationLook = data.clubEmailsUseRegistrationLook; }),
    },
    eventAsset: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; eventId?: string; contentType?: { in: string[] } } }) => assets.filter((asset) => (
        (!where.id || where.id.in.includes(asset.id)) && (!where.eventId || asset.eventId === where.eventId) && (!where.contentType || where.contentType.in.includes(asset.contentType))
      ))),
    },
    registrationThemeVersion: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((row) => matches(row, where)) ?? null),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => matches(row, where))),
      aggregate: vi.fn(async () => ({ _max: { versionNumber: rows.reduce((max, row) => Math.max(max, row.versionNumber), 0) || null } })),
      create: vi.fn(async ({ data }: { data: Partial<Row> & { eventId: string; versionNumber: number; tokens: unknown } }) => {
        rows.push({ id: `v${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), publishedAt: null, archivedAt: null, status: "DRAFT", ...data });
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => { Object.assign(rows.find((row) => row.id === where.id)!, data); }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = rows.filter((row) => matches(row, where));
        hit.forEach((row) => Object.assign(row, data));
        return { count: hit.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        let count = 0;
        for (let index = rows.length - 1; index >= 0; index -= 1) if (matches(rows[index]!, where)) { rows.splice(index, 1); count += 1; }
        return { count };
      }),
    },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
  mocks.getPrisma.mockReturnValue(prisma);
  return { rows, tx, prisma };
}

const row = (overrides: Partial<Row>): Row => ({ id: "v1", eventId: "event-1", versionNumber: 1, status: "DRAFT", tokens: good, createdAt: new Date("2027-01-05T12:00:00Z"), updatedAt: new Date("2027-01-05T12:00:00Z"), publishedAt: null, archivedAt: null, ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-02-01T12:00:00Z"));
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.getCurrentSession.mockResolvedValue({ user: staff });
  mocks.findActiveMembership.mockResolvedValue(membership("EVENT_ADMIN"));
});

describe("registration theme route access", () => {
  it.each(["REGISTRATION_MANAGER", "FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF"])("refuses %s on every method", async (role) => {
    mocks.findActiveMembership.mockResolvedValue(membership(role));
    const { prisma } = database();
    for (const response of [await GET(request("GET"), context), await PUT(request("PUT", { tokens: good }), context), await POST(request("POST", { action: "publish" }), context), await PATCH(request("PATCH", { clubEmailsUseRegistrationLook: true }), context)]) {
      expect(response.status).toBe(403);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a signed-out request and a cross-origin write", async () => {
    database();
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await GET(request("GET"), context)).status).toBe(401);
    mocks.getCurrentSession.mockResolvedValue({ user: staff });
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({}, { status: 403 }));
    expect((await PUT(request("PUT", { tokens: good }), context)).status).toBe(403);
    expect((await POST(request("POST", { action: "publish" }), context)).status).toBe(403);
    expect((await PATCH(request("PATCH", { clubEmailsUseRegistrationLook: true }), context)).status).toBe(403);
  });

  it("lets an event administrator read the editor state, never cached", async () => {
    database([row({ status: "PUBLISHED", publishedAt: new Date("2027-01-06T12:00:00Z") })]);
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ theme: { published: { versionNumber: 1, status: "PUBLISHED" }, draft: null } });
  });

  it("refuses a body with extra or invalid values", async () => {
    const { prisma } = database();
    expect((await PUT(request("PUT", { tokens: { ...good, primary: "url(x)" } }), context)).status).toBe(400);
    expect((await PUT(request("PUT", { tokens: good, extra: 1 }), context)).status).toBe(400);
    expect((await POST(request("POST", { action: "delete-everything" }), context)).status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("registration theme repository", () => {
  it("saves a draft as the next version, then updates that one draft, and audits both", async () => {
    const { rows } = database([row({ id: "old", versionNumber: 4, status: "ARCHIVED", archivedAt: new Date("2027-01-10T12:00:00Z") })]);
    expect((await PUT(request("PUT", { tokens: good }), context)).status).toBe(200);
    expect(rows.filter((entry) => entry.status === "DRAFT")).toHaveLength(1);
    expect(rows.find((entry) => entry.status === "DRAFT")?.versionNumber).toBe(5);
    await PUT(request("PUT", { tokens: { ...good, accent: "#7a2e65" } }), context);
    expect(rows.filter((entry) => entry.status === "DRAFT")).toHaveLength(1);
    expect(rows.find((entry) => entry.status === "DRAFT")?.tokens).toMatchObject({ accent: "#7a2e65" });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(2);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-1", actorUserId: "staff-1", action: "REGISTRATION_THEME_DRAFT_SAVED" }), expect.anything());
  });

  it("publishes the draft and archives the previous published version in one transaction", async () => {
    const { rows, prisma } = database([
      row({ id: "pub", versionNumber: 1, status: "PUBLISHED", publishedAt: new Date("2027-01-06T12:00:00Z") }),
      row({ id: "draft", versionNumber: 2, status: "DRAFT", tokens: { ...good, accent: "#7a2e65" } }),
    ]);
    const response = await POST(request("POST", { action: "publish" }), context);
    expect(response.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(rows.find((entry) => entry.id === "pub")).toMatchObject({ status: "ARCHIVED", archivedAt: new Date("2027-02-01T12:00:00Z") });
    expect(rows.find((entry) => entry.id === "draft")).toMatchObject({ status: "PUBLISHED", publishedAt: new Date("2027-02-01T12:00:00Z"), publishedByUserId: "staff-1" });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "REGISTRATION_THEME_PUBLISHED", metadata: { versionNumber: 2, replacedPublished: true, hasLogo: false, hasBanner: false } }), expect.anything());
  });

  it("refuses to publish a low-contrast draft, naming the failing checks, and changes nothing", async () => {
    const { rows } = database([
      row({ id: "pub", versionNumber: 1, status: "PUBLISHED" }),
      row({ id: "draft", versionNumber: 2, status: "DRAFT", tokens: lowContrast }),
    ]);
    const response = await POST(request("POST", { action: "publish" }), context);
    expect(response.status).toBe(422);
    const body = await response.json() as { error: string; message: string; failing: { id: string }[] };
    expect(body.error).toBe("CONTRAST_FAILED");
    expect(body.message).toContain("White button text on the main color");
    expect(body.failing.map((check) => check.id)).toEqual(expect.arrayContaining(["button-text-on-primary", "muted-on-surface"]));
    expect(rows.map((entry) => entry.status)).toEqual(["PUBLISHED", "DRAFT"]);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses to publish a draft whose stored tokens fail the schema", async () => {
    database([row({ id: "draft", tokens: { ...good, primary: "red" } })]);
    const response = await POST(request("POST", { action: "publish" }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_TOKENS" });
  });

  it("answers a publish with no draft in plain words", async () => {
    database();
    expect((await POST(request("POST", { action: "publish" }), context)).status).toBe(404);
  });

  it.each([
    ["a unique-index collision", () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" })],
    ["a row that changed in between", () => new Prisma.PrismaClientKnownRequestError("Record to update not found", { code: "P2025", clientVersion: "test" })],
    ["the database refusing to change a published look", () => new Prisma.PrismaClientUnknownRequestError('QueryError(PostgresError { code: "23001", message: "A published registration look cannot be changed." })', { clientVersion: "test" })],
  ])("answers %s with a conflict", async (_name, makeError) => {
    const { tx } = database([row({ id: "draft" })]);
    tx.registrationThemeVersion.updateMany.mockRejectedValue(makeError());
    const raced = await POST(request("POST", { action: "publish" }), context);
    expect(raced.status).toBe(409);
    await expect(raced.json()).resolves.toMatchObject({ error: "CONFLICT", message: expect.stringContaining("Refresh") });
  });

  it("publishes the exact tokens it checked: a Save that lands in between makes the publish conflict and changes nothing", async () => {
    const { rows, tx } = database([
      row({ id: "pub", versionNumber: 1, status: "PUBLISHED" }),
      row({ id: "draft", versionNumber: 2, status: "DRAFT" }),
    ]);
    const find = tx.registrationThemeVersion.findFirst.getMockImplementation()!;
    // The draft is edited (new updatedAt, unchecked tokens) after the publish read it.
    tx.registrationThemeVersion.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      const found = await find(args);
      if (args.where.status === "DRAFT" && found) {
        const snapshot = { ...found };
        Object.assign(rows.find((entry) => entry.id === "draft")!, { tokens: lowContrast, updatedAt: new Date("2027-01-06T12:00:00Z") });
        return snapshot;
      }
      return found;
    });
    const response = await POST(request("POST", { action: "publish" }), context);
    expect(response.status).toBe(409);
    expect(rows.find((entry) => entry.id === "draft")?.status).toBe("DRAFT");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("discards only the draft", async () => {
    const { rows } = database([row({ id: "pub", versionNumber: 1, status: "PUBLISHED" }), row({ id: "draft", versionNumber: 2, status: "DRAFT" })]);
    expect((await POST(request("POST", { action: "discard" }), context)).status).toBe(200);
    expect(rows.map((entry) => entry.id)).toEqual(["pub"]);
    expect((await POST(request("POST", { action: "discard" }), context)).status).toBe(404);
    expect(rows.map((entry) => entry.id)).toEqual(["pub"]);
  });

  it("answers a discard that lost a race with a publish with a conflict and no audit row", async () => {
    const { tx } = database([row({ id: "draft", versionNumber: 1, status: "DRAFT" })]);
    tx.registrationThemeVersion.deleteMany.mockResolvedValueOnce({ count: 0 });
    mocks.writeAuditLog.mockClear();
    const raced = await POST(request("POST", { action: "discard" }), context);
    expect(raced.status).toBe(409);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("reverts to the platform look by archiving the published version", async () => {
    const { rows } = database([row({ id: "pub", versionNumber: 3, status: "PUBLISHED" })]);
    expect((await POST(request("POST", { action: "revert" }), context)).status).toBe(200);
    expect(rows[0]).toMatchObject({ status: "ARCHIVED" });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "REGISTRATION_THEME_REVERTED" }), expect.anything());
    expect((await POST(request("POST", { action: "revert" }), context)).status).toBe(404);
  });
});

/** A real, tiny picture of the given size: sharp reads its metadata exactly as it reads an upload. */
async function picture(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: "#888888" } }).png().toBuffer();
}

const asset = (overrides: Partial<Asset>): Asset => ({ id: "logo-1", eventId: "event-1", displayName: "logo.png", contentType: "image/png", byteSize: 4096, storageKey: "event-1/logo.png", ...overrides });
const logoAsset = asset({});
const bannerAsset = asset({ id: "banner-1", displayName: "banner.png", storageKey: "event-1/banner.png" });

function pictures(sizes: Record<string, [number, number]>) {
  mocks.readAsset.mockImplementation(async (key: string) => {
    const size = sizes[key];
    if (!size) throw new Error("missing file");
    return picture(size[0], size[1]);
  });
}

describe("registration look logo and banner (#283)", () => {
  beforeEach(() => pictures({ "event-1/logo.png": [240, 96], "event-1/banner.png": [1600, 400] }));

  it("saves the chosen images with their descriptions and audits whether a logo and banner are set", async () => {
    const { rows } = database([], [logoAsset, bannerAsset]);
    const response = await PUT(request("PUT", {
      tokens: { ...good, logoAlt: "  Camp Heritage logo ", heroAlt: "Pine trees by the lake", heroFocus: "top" },
      logoAssetId: "logo-1", heroAssetId: "banner-1",
    }), context);
    expect(response.status).toBe(200);
    expect(rows[0]).toMatchObject({ logoAssetId: "logo-1", heroAssetId: "banner-1", tokens: { logoAlt: "Camp Heritage logo", heroAlt: "Pine trees by the lake", heroFocus: "top" } });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ metadata: { versionNumber: 1, hasLogo: true, hasBanner: true } }), expect.anything());
    const body = await response.json() as { theme: { draft: { logoAssetId: string; heroAssetId: string }; images: { id: string; url: string }[] } };
    expect(body.theme.draft).toMatchObject({ logoAssetId: "logo-1", heroAssetId: "banner-1" });
    expect(body.theme.images.map((image) => image.id).sort()).toEqual(["banner-1", "logo-1"]);
    expect(body.theme.images[0]!.url).toContain("/api/events/event-1/assets/");
  });

  it("keeps the draft's images when the request leaves the ids out, and clears them (and their descriptions) with null", async () => {
    const { rows } = database([row({ id: "draft", logoAssetId: "logo-1", tokens: { ...good, logoAlt: "Logo" } })], [logoAsset]);
    await PUT(request("PUT", { tokens: { ...good, logoAlt: "Logo", accent: "#7a2e65" } }), context);
    expect(rows[0]).toMatchObject({ logoAssetId: "logo-1" });
    await PUT(request("PUT", { tokens: { ...good, logoAlt: "Leftover", heroAlt: "Leftover", heroFocus: "bottom" }, logoAssetId: null }), context);
    expect(rows[0]!.logoAssetId).toBeNull();
    expect(rows[0]!.tokens).not.toHaveProperty("logoAlt");
    expect(rows[0]!.tokens).not.toHaveProperty("heroAlt");
    expect(rows[0]!.tokens).not.toHaveProperty("heroFocus");
  });

  it.each([
    ["another event's upload", asset({ eventId: "event-2" }), "logo-1", [240, 96], "isn't one of this event's uploads"],
    ["a PDF", asset({ contentType: "application/pdf" }), "logo-1", [240, 96], "PNG, JPEG or WebP"],
    ["a logo over 2 MB", asset({ byteSize: 2 * 1024 * 1024 + 1 }), "logo-1", [240, 96], "2 MB or smaller"],
    ["a logo that is too small", asset({}), "logo-1", [100, 40], "at least 120 by 48"],
    ["a file that is not a picture", asset({}), "logo-1", null, "couldn't be read as a picture"],
  ] as const)("refuses %s as the logo and saves nothing", async (_name, stored, id, size, message) => {
    const { rows } = database([], [stored]);
    if (size) pictures({ "event-1/logo.png": [size[0], size[1]] });
    else mocks.readAsset.mockResolvedValue(Buffer.from("not a picture"));
    const response = await PUT(request("PUT", { tokens: { ...good, logoAlt: "Logo" }, logoAssetId: id }), context);
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string; message: string };
    expect(body.error).toBe("INVALID_ASSET");
    expect(body.message).toContain(message);
    expect(rows).toHaveLength(0);
  });

  it("refuses a missing upload the same way as another event's", async () => {
    database([], []);
    const response = await PUT(request("PUT", { tokens: { ...good, logoAlt: "Logo" }, logoAssetId: "nope" }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_ASSET", message: expect.stringContaining("isn't one of this event's uploads") });
  });

  it.each([
    ["too narrow", [1000, 400], "at least 1200 by 300"],
    ["not wider than tall", [1200, 1300], "wider than it is tall"],
  ] as const)("refuses a banner that is %s", async (_name, size, message) => {
    database([], [bannerAsset]);
    pictures({ "event-1/banner.png": [size[0], size[1]] });
    const response = await PUT(request("PUT", { tokens: { ...good, heroAlt: "Lake" }, heroAssetId: "banner-1" }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_ASSET", message: expect.stringContaining(message) });
  });

  it("requires a description for each chosen image", async () => {
    const { rows } = database([], [logoAsset, bannerAsset]);
    const noLogoAlt = await PUT(request("PUT", { tokens: good, logoAssetId: "logo-1" }), context);
    expect(noLogoAlt.status).toBe(400);
    await expect(noLogoAlt.json()).resolves.toMatchObject({ error: "INVALID_ASSET", message: expect.stringContaining("Describe the logo") });
    const noHeroAlt = await PUT(request("PUT", { tokens: { ...good, logoAlt: "Logo" }, logoAssetId: "logo-1", heroAssetId: "banner-1" }), context);
    expect(noHeroAlt.status).toBe(400);
    await expect(noHeroAlt.json()).resolves.toMatchObject({ message: expect.stringContaining("Describe the banner") });
    expect(rows).toHaveLength(0);
  });

  it("refuses unknown fields and a description over 150 characters", async () => {
    database([], [logoAsset]);
    expect((await PUT(request("PUT", { tokens: good, logoUrl: "x" }), context)).status).toBe(400);
    expect((await PUT(request("PUT", { tokens: { ...good, logoAlt: "a".repeat(151) }, logoAssetId: "logo-1" }), context)).status).toBe(400);
  });

  it("checks the images again on publish, and publishes a draft whose logo file was deleted without its description", async () => {
    const { rows } = database([
      row({ id: "bad", versionNumber: 1, logoAssetId: "logo-1", tokens: { ...good, logoAlt: "Logo" } }),
    ], [asset({ byteSize: 3 * 1024 * 1024 })]);
    const refused = await POST(request("POST", { action: "publish" }), context);
    expect(refused.status).toBe(400);
    await expect(refused.json()).resolves.toMatchObject({ error: "INVALID_ASSET" });
    expect(rows[0]!.status).toBe("DRAFT");

    // The file was deleted since the save: the key is null and the description goes with it.
    rows[0]!.logoAssetId = null;
    expect((await POST(request("POST", { action: "publish" }), context)).status).toBe(200);
    expect(rows[0]).toMatchObject({ status: "PUBLISHED", logoAssetId: null });
    expect(rows[0]!.tokens).not.toHaveProperty("logoAlt");
  });

  it("lists only the event's PNG, JPEG and WebP uploads for the picker", async () => {
    database([], [logoAsset, asset({ id: "pdf-1", contentType: "application/pdf" }), asset({ id: "other", eventId: "event-2" })]);
    const body = await (await GET(request("GET"), context)).json() as { theme: { images: { id: string; name: string; contentType: string; byteSize: number }[] } };
    expect(body.theme.images).toEqual([expect.objectContaining({ id: "logo-1", name: "logo.png", contentType: "image/png", byteSize: 4096 })]);
  });
});

describe("the club email switch (#283 follow-up)", () => {
  it("is off by default and shown in the editor state", async () => {
    database();
    await expect((await GET(request("GET"), context)).json()).resolves.toMatchObject({ theme: { clubEmailsUseRegistrationLook: false } });
  });

  it("turns on and off for an event administrator, and audits the old and new value with the actor", async () => {
    const event = { clubEmailsUseRegistrationLook: false };
    database([], [], event);
    const on = await PATCH(request("PATCH", { clubEmailsUseRegistrationLook: true }), context);
    expect(on.status).toBe(200);
    await expect(on.json()).resolves.toMatchObject({ theme: { clubEmailsUseRegistrationLook: true } });
    expect(event.clubEmailsUseRegistrationLook).toBe(true);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1", actorUserId: "staff-1", action: "CLUB_EMAIL_REGISTRATION_LOOK_CHANGED", entityType: "Event", entityId: "event-1",
      metadata: { oldValue: false, newValue: true },
    }), expect.anything());
    await PATCH(request("PATCH", { clubEmailsUseRegistrationLook: false }), context);
    expect(event.clubEmailsUseRegistrationLook).toBe(false);
    expect(mocks.writeAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: { oldValue: true, newValue: false } }), expect.anything());
  });

  it("changes nothing and writes no audit row when the value is already set", async () => {
    const event = { clubEmailsUseRegistrationLook: true };
    const { tx } = database([], [], event);
    const response = await PATCH(request("PATCH", { clubEmailsUseRegistrationLook: true }), context);
    expect(response.status).toBe(200);
    expect(tx.event.update).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses a body that is not exactly the one boolean, and a cross-origin request", async () => {
    const { tx } = database();
    for (const body of [{}, { clubEmailsUseRegistrationLook: "yes" }, { clubEmailsUseRegistrationLook: true, extra: 1 }, { tokens: good }]) {
      const response = await PATCH(request("PATCH", body), context);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
    mocks.rejectCrossOriginRequest.mockReturnValue(Response.json({}, { status: 403 }));
    expect((await PATCH(request("PATCH", { clubEmailsUseRegistrationLook: true }), context)).status).toBe(403);
    expect(tx.event.update).not.toHaveBeenCalled();
  });
});
