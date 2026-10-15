import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventPermission } from "@/modules/access/permissions";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

import {
  MAX_ENUMERATED_REGISTRATIONS,
  enumerateOperationsRegistrationIds,
  searchOperationsRegistrations,
} from "@/modules/registrations/operations-search-repository";
import { MAX_PAGE, MAX_PAGE_SIZE } from "@/modules/registrations/operations-search-domain";

function fixture(ids: string[] = ["r1", "r2", "r3"]) {
  const transaction = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
    registration: {
      count: vi.fn().mockResolvedValue(ids.length),
      findMany: vi.fn().mockResolvedValue(ids.map((id) => ({ id }))),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  };
  const prisma = {
    event: { findUnique: vi.fn().mockResolvedValue({ waitlistEnabled: false, billingMode: "ATTENDEE_PAY" }) },
    eventAttendeeType: { findMany: vi.fn().mockResolvedValue([{ code: "ADULT", label: "Adult" }]) },
    eventLocation: { findMany: vi.fn().mockResolvedValue([]) },
    clubEventRegistration: { findMany: vi.fn().mockResolvedValue([]) },
    eventTag: { findMany: vi.fn().mockResolvedValue([{ id: "tag-1", name: "VIP", isActive: true }]) },
    publicRegistrationSubmission: { groupBy: vi.fn().mockResolvedValue([]) },
    registrationFormVersion: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (run: (tx: typeof transaction) => unknown, options?: { isolationLevel?: string }) => { void options; return run(transaction); }),
  };
  mocks.getPrisma.mockReturnValue(prisma);
  return { prisma, transaction };
}

const viewer = (...permissions: EventPermission[]) => ({ eventId: "event-a", permissions });
const registrar = viewer("VIEW_EVENT", "MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA", "MANAGE_FINANCE");
const params = (qs: string) => new URLSearchParams(qs);

beforeEach(() => vi.clearAllMocks());

describe("bounded ids-only enumeration (#176 on #180)", () => {
  it("is exactly every page the search offers", () => {
    expect(MAX_ENUMERATED_REGISTRATIONS).toBe(MAX_PAGE * MAX_PAGE_SIZE);
    expect(MAX_ENUMERATED_REGISTRATIONS).toBe(20_000);
  });

  it("uses the very predicate a paged search uses, in the same canonical order", async () => {
    const { transaction } = fixture();
    const query = "status=CONFIRMED&tag=tag-1&q=Jane";
    await searchOperationsRegistrations(registrar, params(query));
    const paged = transaction.registration.findMany.mock.calls[0][0];
    transaction.registration.findMany.mockClear();
    const result = await enumerateOperationsRegistrationIds(registrar, params(query));
    const all = transaction.registration.findMany.mock.calls[0][0];
    expect(result.ok).toBe(true);
    expect(all.where).toEqual(paged.where);
    expect(all.orderBy).toEqual(paged.orderBy);
    expect(all.select).toEqual({ id: true });
    expect(all.where.eventId).toBe("event-a");
    expect(result.registrationIds).toEqual(["r1", "r2", "r3"]);
    expect(result.total).toBe(3);
  });

  it("reads one bounded snapshot: one repeatable-read transaction, a statement timeout, and cap + 1 rows at most", async () => {
    const { prisma, transaction } = fixture();
    await enumerateOperationsRegistrationIds(registrar, params(""));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0]![1]).toMatchObject({ isolationLevel: "RepeatableRead" });
    expect(transaction.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("statement_timeout"));
    expect(transaction.registration.findMany.mock.calls[0][0].take).toBe(MAX_ENUMERATED_REGISTRATIONS + 1);
  });

  it("refuses a filter the viewer may not use before any row is read, exactly as the search does", async () => {
    const { transaction } = fixture();
    const staff = viewer("VIEW_EVENT", "MANAGE_COMMUNICATIONS");
    for (const query of ["tag=tag-1", "payment=UNPAID", "checkIn=ANY", "q=pat", "organization=org-1", "answer=ATTENDEE:meal=vegan"]) {
      const result = await enumerateOperationsRegistrationIds(staff, params(query));
      expect(result.ok, query).toBe(false);
      expect(result.registrationIds).toEqual([]);
      expect(result.issues.map((issue) => issue.code)).toEqual(["unavailable"]);
    }
    expect(transaction.registration.findMany).not.toHaveBeenCalled();
    expect(transaction.registration.count).not.toHaveBeenCalled();
  });

  it("gives a viewer without VIEW_EVENT nothing, and reads nothing", async () => {
    const { prisma } = fixture();
    const result = await enumerateOperationsRegistrationIds(viewer("MANAGE_COMMUNICATIONS"), params(""));
    expect(result.ok).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a match larger than the bound as too broad, with no ids, never a truncated set", async () => {
    const { transaction } = fixture();
    transaction.registration.findMany.mockResolvedValue(Array.from({ length: MAX_ENUMERATED_REGISTRATIONS + 1 }, (_, index) => ({ id: `r${index}` })));
    const result = await enumerateOperationsRegistrationIds(registrar, params(""));
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(["too-broad"]);
    expect(result.registrationIds).toEqual([]);
  });

  it("returns a match of exactly the bound", async () => {
    const { transaction } = fixture();
    transaction.registration.findMany.mockResolvedValue(Array.from({ length: MAX_ENUMERATED_REGISTRATIONS }, (_, index) => ({ id: `r${index}` })));
    const result = await enumerateOperationsRegistrationIds(registrar, params(""));
    expect(result.ok).toBe(true);
    expect(result.registrationIds).toHaveLength(MAX_ENUMERATED_REGISTRATIONS);
  });

  it("reports a statement timeout as too broad, not a failure", async () => {
    const { transaction } = fixture();
    transaction.registration.findMany.mockRejectedValue(new Error("canceling statement due to statement timeout"));
    const result = await enumerateOperationsRegistrationIds(registrar, params(""));
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(["too-broad"]);
  });

  it("keeps health and sensitive answers unsearchable: no key reaches the predicate", async () => {
    const { transaction } = fixture();
    const result = await enumerateOperationsRegistrationIds(registrar, params("note=x&health=x&allergy=peanut&answer=ATTENDEE:food_allergies=peanut"));
    // The unknown keys are not filters; the answer names a question this event never offers.
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(["unavailable"]);
    expect(transaction.registration.findMany).not.toHaveBeenCalled();
  });
});
