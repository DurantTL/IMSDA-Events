import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { evaluateEventAudience, getAudienceFilterOptions } from "@/modules/communications/audience-repository";
import { AudienceFilterNotAvailableError } from "@/modules/communications/audience-query";
import { MessagingError } from "@/modules/communications/messaging-error";
import { emptySearchCatalog } from "@/modules/registrations/operations-search-domain";

const comms: EventPermission[] = ["VIEW_EVENT", "MANAGE_COMMUNICATIONS"];

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

function prismaFixture() {
  const registrationFindMany = vi.fn(async ({ where }: { where: { eventId: string; id: { in: string[] } } }) => where.id.in.map(registrationRow));
  const prisma = {
    event: { findUnique: vi.fn().mockResolvedValue({ audience: "OPEN", billingMode: "ATTENDEE_PAY" }) },
    groupEventRegistration: { findFirst: vi.fn().mockResolvedValue(null) },
    clubEventRegistration: { findFirst: vi.fn().mockResolvedValue(null) },
    registrationBillingResponsibility: { findFirst: vi.fn().mockResolvedValue(null) },
    registration: { findMany: registrationFindMany },
    registrationAttendee: { findMany: vi.fn().mockResolvedValue([]) },
    messageOutbox: { findMany: vi.fn().mockResolvedValue([]) },
  };
  mocks.getPrisma.mockReturnValue(prisma);
  return { prisma, registrationFindMany };
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
    const sensitive = await getAudienceFilterOptions("event-a", [...comms, "VIEW_SENSITIVE_DATA", "MANAGE_REGISTRATION"]);
    expect(JSON.stringify(sensitive)).toContain("Secret VIP");
    expect(sensitive.readiness).toHaveLength(1);
  });
});
