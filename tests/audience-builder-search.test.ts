import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { EventPermission } from "@/modules/access/permissions";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  enumerate: vi.fn(),
  loadCatalog: vi.fn(),
  loadOptOuts: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/communications/email-preferences-repository", () => ({ loadAnnouncementOptOuts: mocks.loadOptOuts }));
// The enumeration itself is tested in operations-search-enumeration.test.ts; here, the audience builder's use of it.
vi.mock("@/modules/registrations/operations-search-repository", () => ({
  enumerateOperationsRegistrationIds: mocks.enumerate,
  loadOperationsSearchCatalog: mocks.loadCatalog,
}));

import { createAudienceSnapshot, evaluateEventAudience, getAudienceFilterOptions } from "@/modules/communications/audience-repository";
import { AudienceFilterNotAvailableError } from "@/modules/communications/audience-query";
import { MessagingError } from "@/modules/communications/messaging-error";
import { emptySearchCatalog } from "@/modules/registrations/operations-search-domain";

const comms: EventPermission[] = ["VIEW_EVENT", "MANAGE_COMMUNICATIONS"];
const sensitiveComms: EventPermission[] = [...comms, "VIEW_SENSITIVE_DATA"];

function registrationRow(id: string) {
  return {
    id,
    confirmationCode: id.toUpperCase(),
    status: "CONFIRMED",
    totalAmount: "10.00",
    contactSnapshot: { firstName: "Pat", lastName: id, email: `${id}@example.test` },
    accountHolderPerson: { firstName: "Pat", lastName: id, normalizedEmail: null },
    publicFormSubmission: null,
    payments: [],
    tagAssignments: [],
    attendees: [],
  };
}

type BatchArgs = { where: { eventId: string; id: { in: string[] }; status: { in: string[] } }; select: Record<string, unknown> };

function prismaFixture(options: { bounced?: Array<{ email: string; status: string }>; types?: Array<{ code: string; minimumAge: number | null; maximumAge: number | null }>; rows?: (id: string) => Record<string, unknown> } = {}) {
  const registrationFindMany = vi.fn(async ({ where }: BatchArgs) => where.id.in.map(options.rows ?? registrationRow));
  const queryRaw = vi.fn().mockResolvedValue(options.bounced ?? []);
  const prisma = {
    $transaction: vi.fn<(work: (tx: unknown) => unknown, options?: unknown) => Promise<unknown>>(async (work) => work({ $executeRaw: vi.fn().mockResolvedValue(1), $queryRaw: queryRaw })),
    eventAttendeeType: { findMany: vi.fn().mockResolvedValue(options.types ?? []) },
    eventAudienceSnapshot: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn() },
    event: { findUnique: vi.fn().mockResolvedValue({ audience: "OPEN", billingMode: "ATTENDEE_PAY" }) },
    groupEventRegistration: { findFirst: vi.fn().mockResolvedValue(null) },
    clubEventRegistration: { findFirst: vi.fn().mockResolvedValue(null) },
    registrationBillingResponsibility: { findFirst: vi.fn().mockResolvedValue(null) },
    registration: { findMany: registrationFindMany },
    registrationAttendee: { findMany: vi.fn().mockResolvedValue([]) },
    emailAddressSuppression: { findMany: vi.fn().mockResolvedValue([]) },
  };
  mocks.getPrisma.mockReturnValue(prisma);
  return { prisma, registrationFindMany, queryRaw };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCatalog.mockResolvedValue(emptySearchCatalog());
  mocks.loadOptOuts.mockResolvedValue({ eventScoped: new Map(), all: new Set() });
});

describe("the audience builder selects registrations through the operations search", () => {
  it("runs the canonical search for the caller's own permissions and event, never a permission of its own", async () => {
    prismaFixture();
    mocks.enumerate.mockResolvedValue({ ok: true, issues: [], total: 2, registrationIds: ["r1", "r2"] });
    await evaluateEventAudience("event-a", comms, { search: "payment=PARTIAL,UNPAID", messageKind: "OPERATIONAL" });
    const [viewer, search, catalog] = mocks.enumerate.mock.calls[0]!;
    expect(viewer).toEqual({ eventId: "event-a", permissions: comms });
    expect(search.payment).toEqual(["UNPAID", "PARTIAL"]);
    expect(search.status).toEqual(["SUBMITTED", "CONFIRMED"]);
    expect(catalog).toBe(await mocks.loadCatalog.mock.results[0]!.value);
    expect(mocks.loadCatalog).toHaveBeenCalledWith({ eventId: "event-a", permissions: comms });
  });

  it("answers any refused search with the one fixed error and loads no registration", async () => {
    const { registrationFindMany } = prismaFixture();
    for (const code of ["unavailable", "stale-reference", "invalid-value", "field-unavailable", "value-not-offered", "conflict"]) {
      mocks.enumerate.mockResolvedValue({ ok: false, issues: [{ filter: "tag", code, message: `search says ${code}` }], total: 0, registrationIds: [] });
      const failure = await evaluateEventAudience("event-a", comms, { search: "tag=tag-secret" }).catch((error) => error);
      expect(failure).toBeInstanceOf(AudienceFilterNotAvailableError);
      expect((failure as Error).message).not.toMatch(/tag|secret|search says/i);
    }
    expect(registrationFindMany).not.toHaveBeenCalled();
  });

  it("refuses a role or readiness the caller may not use before running any search", async () => {
    prismaFixture();
    await expect(evaluateEventAudience("event-a", comms, { roles: ["GROUP_LEADER"] })).rejects.toBeInstanceOf(AudienceFilterNotAvailableError);
    await expect(evaluateEventAudience("event-a", comms, { readinessStates: ["ATTENDEE_RESPONSES_INCOMPLETE"] })).rejects.toBeInstanceOf(AudienceFilterNotAvailableError);
    expect(mocks.enumerate).not.toHaveBeenCalled();
    expect(mocks.loadCatalog).not.toHaveBeenCalled();
  });

  it("refuses the attendee, group billing and organization roles to a communications-only caller before any search or read", async () => {
    const { registrationFindMany } = prismaFixture();
    for (const role of ["ATTENDEE", "ORGANIZATION_CONTACT", "GROUP_LEADER"]) {
      const failure = await evaluateEventAudience("event-a", comms, { roles: [role] }).catch((error) => error);
      expect(failure).toBeInstanceOf(AudienceFilterNotAvailableError);
    }
    expect(mocks.enumerate).not.toHaveBeenCalled();
    expect(mocks.loadCatalog).not.toHaveBeenCalled();
    expect(registrationFindMany).not.toHaveBeenCalled();
  });

  it("refuses text, check-in and attendee-scoped answer filters with the attendee role before any search", async () => {
    prismaFixture();
    for (const search of ["q=pat", "checkIn=NONE", "answer=ATTENDEE:meal=vegan"]) {
      await expect(evaluateEventAudience("event-a", sensitiveComms, { roles: ["ATTENDEE"], search })).rejects.toBeInstanceOf(AudienceFilterNotAvailableError);
    }
    expect(mocks.enumerate).not.toHaveBeenCalled();
  });

  it("reads tag assignments the way the search does: an inactive tag is still a tag, and a stale status drops out", async () => {
    const { registrationFindMany } = prismaFixture();
    mocks.enumerate.mockResolvedValue({ ok: true, issues: [], total: 1, registrationIds: ["r1"] });
    await evaluateEventAudience("event-a", comms, { messageKind: "OPERATIONAL", search: "status=CONFIRMED" });
    const [args] = registrationFindMany.mock.calls[0]!;
    expect(args.where.status).toEqual({ in: ["CONFIRMED"] });
    expect(args.where.eventId).toBe("event-a");
    expect(JSON.stringify(args.select)).not.toContain("isActive");
    await evaluateEventAudience("event-a", comms, { messageKind: "OPERATIONAL" });
    expect(registrationFindMany.mock.calls[1]![0].where.status).toEqual({ in: ["SUBMITTED", "CONFIRMED"] });
  });

  it("drops a registration that was cancelled after the ids were enumerated", async () => {
    // The database applies the status guard; a row the guard removes is simply not returned.
    const registrationFindMany = vi.fn(async ({ where }: BatchArgs) => where.id.in.filter((id) => id !== "gone").map(registrationRow));
    const { prisma } = prismaFixture();
    prisma.registration.findMany = registrationFindMany;
    mocks.enumerate.mockResolvedValue({ ok: true, issues: [], total: 2, registrationIds: ["r1", "gone"] });
    const { result } = await evaluateEventAudience("event-a", comms, { messageKind: "OPERATIONAL" });
    expect(result.counts.consideredRegistrationCount).toBe(1);
    expect(result.recipients.map((recipient) => recipient.email)).toEqual(["r1@example.test"]);
  });

  it("matches provider suppression case-insensitively in one bounded query per chunk", async () => {
    const { queryRaw, prisma } = prismaFixture({
      bounced: [{ email: "r1@example.test", status: "BOUNCED" }],
      rows: (id) => ({ ...registrationRow(id), contactSnapshot: { firstName: "Pat", lastName: id, email: `${id.toUpperCase()}@Example.TEST` } }),
    });
    mocks.enumerate.mockResolvedValue({ ok: true, issues: [], total: 2, registrationIds: ["r1", "r2"] });
    const { result } = await evaluateEventAudience("event-a", comms, { messageKind: "OPERATIONAL" });
    expect(result.recipients.map((recipient) => recipient.email)).toEqual(["r2@example.test"]);
    expect(result.exclusions.map((exclusion) => [exclusion.code, exclusion.email])).toEqual([["PROVIDER_BOUNCED", "r1@example.test"]]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, list] = queryRaw.mock.calls[0]!;
    expect(strings.join("?")).toContain('lower("recipientEmail") IN');
    expect((list as { values: string[] }).values).toEqual(["r1@example.test", "r2@example.test"]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("fails closed on age: only a type of 18 and over is reachable; unset, open-ended and typeless attendees are not", async () => {
    const attendee = (id: string, code: string | null) => ({
      id, attendeeTypeDefinition: code ? { code } : null, tagAssignments: [],
      person: { firstName: "A", lastName: id, normalizedEmail: `${id}@example.test` },
    });
    const run = async (types: Array<{ code: string; minimumAge: number | null; maximumAge: number | null }>) => {
      const { prisma } = prismaFixture({
        types,
        rows: (id) => ({ ...registrationRow(id), attendees: [attendee("grown", "ADULT"), attendee("kid", "YOUTH"), attendee("child", "CHILD"), attendee("teen", "TEEN"), attendee("typeless", null)] }),
      });
      mocks.enumerate.mockResolvedValue({ ok: true, issues: [], total: 1, registrationIds: ["r1"] });
      const out = await evaluateEventAudience("event-a", sensitiveComms, { roles: ["ATTENDEE"], messageKind: "OPERATIONAL" });
      expect(prisma.eventAttendeeType.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: "event-a" } }));
      return out.result;
    };
    // Youth types with no ages configured at all: nobody but the 18+ type is reachable.
    const unset = await run([{ code: "ADULT", minimumAge: 18, maximumAge: null }, { code: "YOUTH", minimumAge: null, maximumAge: null }, { code: "CHILD", minimumAge: null, maximumAge: null }, { code: "TEEN", minimumAge: 10, maximumAge: null }]);
    expect(unset.recipients.map((recipient) => recipient.email)).toEqual(["grown@example.test"]);
    expect(unset.exclusions.reduce((total, exclusion) => total + exclusion.contactCount, 0)).toBe(4);
    expect(JSON.stringify(unset)).not.toMatch(/kid@|child@|teen@|typeless@/);
    // No age on the adult type either: nobody is reachable.
    const none = await run([{ code: "ADULT", minimumAge: null, maximumAge: null }, { code: "YOUTH", minimumAge: 0, maximumAge: 17 }]);
    expect(none.recipients).toEqual([]);
    expect(none.exclusions.map((exclusion) => exclusion.code)).toEqual(["MINOR_ATTENDEE", "MINOR_ATTENDEE"]);
  });

  it("answers a suppression lookup that timed out or lost its transaction as AUDIENCE_TOO_BROAD, and gives the transaction room above the statement timeout", async () => {
    const known = (code: string, message: string) => new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "test" });
    for (const failure of [
      known("P2028", "Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 20000 ms."),
      known("P2028", "Transaction already closed"),
      new Error("canceling statement due to statement timeout (57014)"),
    ]) {
      const { prisma } = prismaFixture();
      mocks.enumerate.mockResolvedValue({ ok: true, issues: [], total: 1, registrationIds: ["r1"] });
      prisma.$transaction.mockRejectedValue(failure);
      const error = await evaluateEventAudience("event-a", comms, { messageKind: "OPERATIONAL" }).catch((caught) => caught);
      expect(error).toBeInstanceOf(MessagingError);
      expect((error as MessagingError).code).toBe("AUDIENCE_TOO_BROAD");
    }
    const { prisma } = prismaFixture();
    mocks.enumerate.mockResolvedValue({ ok: true, issues: [], total: 1, registrationIds: ["r1"] });
    await evaluateEventAudience("event-a", comms, { messageKind: "OPERATIONAL" });
    expect(prisma.$transaction.mock.calls[0]![1]).toEqual({ timeout: 20_000, maxWait: 5_000 });
    // A busy database is not a too-large audience: a pool timeout and a transaction that could not start stay real errors.
    for (const busy of [
      known("P2024", "Timed out fetching a new connection from the connection pool."),
      known("P2028", "Transaction API error: Unable to start a new transaction in the given time."),
    ]) {
      prisma.$transaction.mockRejectedValue(busy);
      await expect(evaluateEventAudience("event-a", comms, { messageKind: "OPERATIONAL" })).rejects.toBe(busy);
    }
    // Anything else stays a real error.
    prisma.$transaction.mockRejectedValue(new Error("connection refused"));
    await expect(evaluateEventAudience("event-a", comms, { messageKind: "OPERATIONAL" })).rejects.toThrow("connection refused");
  });

  it("never returns a truncated audience: one larger than the search can enumerate is AUDIENCE_TOO_BROAD", async () => {
    const { registrationFindMany } = prismaFixture();
    mocks.enumerate.mockResolvedValue({ ok: false, issues: [{ filter: "search", code: "too-broad", message: "x" }], total: 0, registrationIds: [] });
    const failure = await evaluateEventAudience("event-a", comms, {}).catch((error) => error);
    expect(failure).toBeInstanceOf(MessagingError);
    expect((failure as MessagingError).code).toBe("AUDIENCE_TOO_BROAD");
    expect(registrationFindMany).not.toHaveBeenCalled();
  });

  it("loads the matched ids in bounded batches, each scoped to the event, and covers every id once", async () => {
    const { registrationFindMany } = prismaFixture();
    const ids = Array.from({ length: 20_000 }, (_, index) => `r${String(index).padStart(5, "0")}`);
    mocks.enumerate.mockResolvedValue({ ok: true, issues: [], total: ids.length, registrationIds: ids });
    const { result } = await evaluateEventAudience("event-a", comms, { messageKind: "OPERATIONAL" }, { batchSize: 250 });
    expect(registrationFindMany).toHaveBeenCalledTimes(80);
    const loaded: string[] = [];
    for (const [args] of registrationFindMany.mock.calls) {
      expect(args.where.eventId).toBe("event-a");
      expect(args.where.id.in.length).toBeLessThanOrEqual(250);
      loaded.push(...args.where.id.in);
    }
    expect(loaded).toEqual(ids);
    expect(result.counts.consideredRegistrationCount).toBe(20_000);
    expect(result.counts.recipientCount).toBe(20_000);
    // The same ids in another batch size give the same audience.
    const other = await evaluateEventAudience("event-a", comms, { messageKind: "OPERATIONAL" }, { batchSize: 7_000 });
    expect(other.result.fingerprint).toBe(result.fingerprint);
  });

  it("offers the filters the operations search offers this caller, and nothing behind a permission", async () => {
    prismaFixture();
    mocks.loadCatalog.mockResolvedValue({ ...emptySearchCatalog(), tags: [{ id: "tag-1", name: "Secret VIP", isActive: true }] });
    const options = await getAudienceFilterOptions("event-a", comms);
    expect(options.search.map((filter) => filter.key)).toEqual(["status", "source"]);
    expect(JSON.stringify(options)).not.toContain("Secret VIP");
    expect(options.roles.map((role) => role.role)).toEqual(["REGISTRATION_CONTACT"]);
    const sensitive = await getAudienceFilterOptions("event-a", [...comms, "VIEW_SENSITIVE_DATA", "MANAGE_REGISTRATION"]);
    expect(sensitive.roles.map((role) => role.role)).toEqual(["REGISTRATION_CONTACT", "ATTENDEE"]);
    expect(JSON.stringify(sensitive)).toContain("Secret VIP");
    expect(sensitive.readiness).toHaveLength(1);
  });
});

describe("audience snapshot replay", () => {
  it("looks a snapshot id up inside the event, so another event's snapshot is never read", async () => {
    const { prisma } = prismaFixture();
    mocks.enumerate.mockResolvedValue({ ok: true, issues: [], total: 0, registrationIds: [] });
    const evaluated = await evaluateEventAudience("event-a", comms, {});
    const snapshotId = "7b0e5f0e-9a58-4e7a-8c64-0f6a1a2b3c4d";
    prisma.eventAudienceSnapshot.findFirst.mockResolvedValueOnce(null);
    await createAudienceSnapshot("event-a", "user-1", comms, { snapshotId, query: {}, previewFingerprint: "0".repeat(64) }).catch(() => undefined);
    expect(prisma.eventAudienceSnapshot.findFirst).toHaveBeenCalledWith({ where: { id: snapshotId, eventId: "event-a" } });
    expect(prisma.eventAudienceSnapshot.findUnique).not.toHaveBeenCalled();
    expect(evaluated.result.fingerprint).toHaveLength(64);
  });
});
