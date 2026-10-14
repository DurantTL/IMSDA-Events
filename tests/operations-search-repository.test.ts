import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventPermission } from "@/modules/access/permissions";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

import {
  describeOperationsSearch,
  searchOperationsRegistrations,
  suggestOperationsSearch,
} from "@/modules/registrations/operations-search-repository";

const definition = {
  title: "Form", description: "", confirmationMessage: "Thanks.",
  sections: [{
    id: "section-one", title: "Details", description: "",
    fields: [
      { id: "field-meal", key: "meal", label: "Dinner choice", helpText: "", type: "SELECT", scope: "ATTENDEE", required: false, options: ["plain", "vegan"] },
      { id: "field-allergy", key: "food_allergies", label: "Food allergies", helpText: "", type: "SELECT", scope: "ATTENDEE", required: false, options: ["peanut", "none"] },
      { id: "field-flagged", key: "shirt_size", label: "Shirt size", helpText: "", type: "SELECT", scope: "ATTENDEE", required: false, options: ["s", "m"], sensitive: true },
    ],
  }],
};

function fixture(overrides: { waitlistEnabled?: boolean } = {}) {
  const transaction = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    registration: {
      count: vi.fn().mockResolvedValue(3),
      findMany: vi.fn().mockResolvedValue([{ id: "r1" }, { id: "r2" }, { id: "r3" }]),
      groupBy: vi.fn().mockResolvedValue([{ status: "CONFIRMED", _count: { _all: 3 } }]),
    },
  };
  const prisma = {
    event: { findUnique: vi.fn().mockResolvedValue({ waitlistEnabled: overrides.waitlistEnabled ?? true, billingMode: "ATTENDEE_PAY" }) },
    eventAttendeeType: { findMany: vi.fn().mockResolvedValue([{ code: "ADULT", label: "Adult" }]) },
    eventLocation: { findMany: vi.fn().mockResolvedValue([]) },
    eventTag: { findMany: vi.fn().mockResolvedValue([{ id: "tag-1", name: "VIP", isActive: true }]) },
    publicRegistrationSubmission: { groupBy: vi.fn().mockResolvedValue([{ formVersionId: "v1" }]) },
    registrationFormVersion: { findMany: vi.fn().mockResolvedValue([{ definition }]) },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "r1" }]),
    $transaction: vi.fn(async (run: (tx: typeof transaction) => unknown) => run(transaction)),
    registration: {
      findMany: vi.fn().mockResolvedValue([{
        id: "r1", confirmationCode: "OPS-1", contactSnapshot: {}, accountHolderPerson: { firstName: "Marta", lastName: "Alvarez" },
        attendees: [{ profileSnapshot: { firstName: "Diego", lastName: "Alvarez" }, person: { firstName: "Diego", lastName: "Alvarez" } }],
      }]),
    },
  };
  mocks.getPrisma.mockReturnValue(prisma);
  return { prisma, transaction };
}

const viewer = (...permissions: EventPermission[]) => ({ eventId: "event-a", permissions });
const registrar = viewer("VIEW_EVENT", "MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA");
const params = (qs: string) => new URLSearchParams(qs);

beforeEach(() => vi.clearAllMocks());

describe("count and result equality", () => {
  it("builds one predicate and hands the same object to the rows, the count and the facets", async () => {
    const { transaction } = fixture();
    const result = await searchOperationsRegistrations(registrar, params("q=Jane&status=CONFIRMED&answer=ATTENDEE:meal=vegan"));
    expect(result.ok).toBe(true);
    const countWhere = transaction.registration.count.mock.calls[0][0].where;
    expect(transaction.registration.findMany.mock.calls[0][0].where).toBe(countWhere);
    expect(transaction.registration.groupBy.mock.calls[0][0].where).toBe(countWhere);
    expect(countWhere.eventId).toBe("event-a");
    expect(result.total).toBe(3);
    expect(result.facets.status).toEqual([{ value: "CONFIRMED", count: 3 }]);
    expect(result.registrationIds).toEqual(["r1", "r2", "r3"]);
  });

  it("pages with a bounded window and the canonical order", async () => {
    const { transaction } = fixture();
    await searchOperationsRegistrations(registrar, params("page=3&size=20&sort=name"));
    const call = transaction.registration.findMany.mock.calls[0][0];
    expect(call.skip).toBe(40);
    expect(call.take).toBe(20);
    expect(call.orderBy.at(-1)).toEqual({ id: "asc" });
    expect(transaction.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("statement_timeout"));
  });

  it("gives suggestions the same predicate as a search for the typed text", async () => {
    const { prisma, transaction } = fixture();
    await searchOperationsRegistrations(registrar, params("q=Alv&status=CONFIRMED"));
    const searchWhere = transaction.registration.count.mock.calls[0][0].where;
    const suggested = await suggestOperationsSearch(registrar, "Alv", params("status=CONFIRMED"));
    expect(prisma.registration.findMany.mock.calls[0][0].where).toEqual(searchWhere);
    expect(suggested.suggestions).toEqual([
      { label: "Marta Alvarez", registrationId: "r1" },
      { label: "Diego Alvarez", registrationId: "r1" },
    ]);
    // Never an email or a phone number.
    expect(JSON.stringify(suggested)).not.toContain("@");
  });
});

describe("unauthorized and stale requests", () => {
  it("runs no row, count or facet query for a filter the viewer may not use", async () => {
    const { prisma, transaction } = fixture();
    const result = await searchOperationsRegistrations(viewer("VIEW_EVENT"), params("q=Marta"));
    expect(result).toMatchObject({ ok: false, total: 0, registrationIds: [], facets: { status: [] } });
    expect(result.issues).toEqual([expect.objectContaining({ filter: "q", code: "unavailable" })]);
    expect(transaction.registration.count).not.toHaveBeenCalled();
    expect(transaction.registration.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not even load the domains the viewer may not use", async () => {
    const { prisma } = fixture();
    await searchOperationsRegistrations(viewer("VIEW_EVENT"), params("status=CONFIRMED"));
    expect(prisma.eventTag.findMany).not.toHaveBeenCalled();
    expect(prisma.registrationFormVersion.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("gives a viewer without VIEW_EVENT nothing, and reads nothing", async () => {
    const { prisma } = fixture();
    const result = await searchOperationsRegistrations(viewer(), params(""));
    expect(result.ok).toBe(false);
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
    const suggested = await suggestOperationsSearch(viewer(), "Marta");
    expect(suggested).toMatchObject({ ok: false, suggestions: [] });
  });

  it("returns no suggestions to a viewer who may not search by text", async () => {
    const { prisma } = fixture();
    const suggested = await suggestOperationsSearch(viewer("VIEW_EVENT", "MANAGE_FINANCE"), "Marta");
    expect(suggested).toMatchObject({ ok: false, suggestions: [] });
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });

  it("reports a stale form key and runs nothing", async () => {
    const { transaction } = fixture();
    const result = await searchOperationsRegistrations(registrar, params("answer=ATTENDEE:retired_field=x"));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ filter: "answer", code: "field-unavailable" })]);
    expect(transaction.registration.count).not.toHaveBeenCalled();
  });

  it("never offers a health-type or sensitive-flagged question, whoever asks", async () => {
    fixture();
    const { filters } = await describeOperationsSearch(viewer("VIEW_EVENT", "VIEW_SENSITIVE_DATA", "MANAGE_REGISTRATION", "MANAGE_FINANCE"));
    const answers = filters.find((filter) => filter.key === "answer");
    expect(answers).toMatchObject({ kind: "questions" });
    const ids = answers?.kind === "questions" ? answers.questions.map((question) => question.question) : [];
    expect(ids).toEqual(["ATTENDEE:meal"]);
  });

  it("only offers the waitlist filter on an event that has a waitlist", async () => {
    fixture({ waitlistEnabled: false });
    const { filters } = await describeOperationsSearch(registrar);
    expect(filters.map((filter) => filter.key)).not.toContain("waitlist");
    const result = await searchOperationsRegistrations(registrar, params("waitlist=WAITING"));
    expect(result.ok).toBe(false);
  });
});

describe("another event and large data", () => {
  it("scopes every read to the viewer's own event", async () => {
    const { prisma, transaction } = fixture();
    await searchOperationsRegistrations({ eventId: "event-b", permissions: registrar.permissions }, params("q=Marta&eventId=event-a&event=event-a"));
    expect(transaction.registration.count.mock.calls[0][0].where.eventId).toBe("event-b");
    expect(prisma.event.findUnique.mock.calls[0][0].where).toEqual({ id: "event-b" });
    expect(prisma.eventTag.findMany.mock.calls[0][0].where).toEqual({ eventId: "event-b" });
    expect(prisma.publicRegistrationSubmission.groupBy.mock.calls[0][0].where).toEqual({ eventId: "event-b" });
  });

  it("refuses an unbounded page size or depth before reading anything", async () => {
    const { prisma } = fixture();
    expect((await searchOperationsRegistrations(registrar, params("size=100000"))).ok).toBe(false);
    expect((await searchOperationsRegistrations(registrar, params("page=100000"))).ok).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("reports a statement timeout as a search to narrow, not a failure", async () => {
    const { prisma } = fixture();
    prisma.$transaction.mockRejectedValueOnce(new Error("canceling statement due to statement timeout"));
    const result = await searchOperationsRegistrations(registrar, params("q=Crowd"));
    expect(result).toMatchObject({ ok: false, total: 0 });
    expect(result.issues[0]?.code).toBe("too-broad");
  });

  it("refuses a money-state filter that would resolve to an unbounded id list", async () => {
    const { prisma, transaction } = fixture();
    prisma.$queryRaw.mockResolvedValueOnce(Array.from({ length: 20_001 }, (_, i) => ({ id: `r${i}` })));
    const result = await searchOperationsRegistrations(viewer("VIEW_EVENT", "MANAGE_FINANCE", "VIEW_SENSITIVE_DATA"), params("payment=PAID"));
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("too-broad");
    expect(transaction.registration.count).not.toHaveBeenCalled();
  });
});
