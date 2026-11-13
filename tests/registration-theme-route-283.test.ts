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
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { GET, POST, PUT } from "@/app/api/events/[eventId]/registration-theme/route";
import { PLATFORM_DEFAULT_THEME } from "@/modules/registration-themes/tokens";

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

type Row = { updatedAt?: Date; id: string; eventId: string; versionNumber: number; status: string; tokens: unknown; createdAt: Date; publishedAt: Date | null; archivedAt: Date | null; publishedByUserId?: string | null };

/** An in-memory stand-in for the one table the repository touches. */
function database(initial: Row[] = []) {
  const rows = [...initial];
  const matches = (row: Row, where: Record<string, unknown> = {}) => Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value);
  const tx = {
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
        for (let index = rows.length - 1; index >= 0; index -= 1) if (matches(rows[index]!, where)) rows.splice(index, 1);
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
    for (const response of [await GET(request("GET"), context), await PUT(request("PUT", { tokens: good }), context), await POST(request("POST", { action: "publish" }), context)]) {
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
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "REGISTRATION_THEME_PUBLISHED", metadata: { versionNumber: 2, replacedPublished: true } }), expect.anything());
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

  it("reverts to the platform look by archiving the published version", async () => {
    const { rows } = database([row({ id: "pub", versionNumber: 3, status: "PUBLISHED" })]);
    expect((await POST(request("POST", { action: "revert" }), context)).status).toBe(200);
    expect(rows[0]).toMatchObject({ status: "ARCHIVED" });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "REGISTRATION_THEME_REVERTED" }), expect.anything());
    expect((await POST(request("POST", { action: "revert" }), context)).status).toBe(404);
  });
});
