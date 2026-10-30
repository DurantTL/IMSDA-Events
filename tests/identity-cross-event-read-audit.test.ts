import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #128 item 8: every identity read that crosses an event boundary is audited,
 * ids only. A global people search is out of scope for ordinary event staff;
 * this audit trail is how that stays true.
 */

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));

import { CROSS_EVENT_READ_ID_CAP, PERSON_CROSS_EVENT_READ_ACTION, auditCrossEventIdentityRead } from "@/modules/people/identity-read-audit";
import { listOpenMatchCandidates } from "@/modules/people/duplicate-match-repository";
import { getMergedPersonView, listActivePersonMerges } from "@/modules/people/person-merge-repository";

const NAME = "Sampleton";
const EMAIL = "sampleton@example.test";
const PHONE = "(515) 555-0100";
const REASON = "Synthetic reason text that must stay out of the audit";

const person = (id: string) => ({ id, firstName: NAME, lastName: NAME, normalizedEmail: EMAIL, phone: PHONE });

function fakePrisma(linked = true) {
  return {
    personMatchCandidate: {
      findMany: vi.fn(async () => [{
        id: "cand_1", matchedSignals: ["PHONE_MATCH"], contradictingSignals: [], confidence: "HIGH", ruleVersion: 1, state: "OPEN",
        computedAt: new Date("2026-01-01T00:00:00Z"), dismissedAt: null, dismissedByUserId: null, dismissalReason: null,
        personA: person("per_a"), personB: person("per_b"),
      }]),
    },
    personMerge: {
      findMany: vi.fn(async (args: { select?: Record<string, unknown>; where: Record<string, unknown> }) => {
        if (args.select && "primaryPerson" in args.select) {
          return [{ id: "merge_1", reason: REASON, mergedAt: new Date("2026-01-02T00:00:00Z"), primaryPerson: { id: "per_a", firstName: NAME, lastName: NAME }, secondaryPerson: { id: "per_b", firstName: NAME, lastName: NAME } }];
        }
        const secondaries = (args.where.secondaryPersonId as { in: string[] } | undefined)?.in;
        const primaries = (args.where.primaryPersonId as { in: string[] } | undefined)?.in;
        if (secondaries) return secondaries.includes("per_b") && linked ? [{ secondaryPersonId: "per_b", primaryPersonId: "per_a" }] : [];
        if (primaries) return primaries.includes("per_a") && linked ? [{ id: "merge_1", primaryPersonId: "per_a", secondaryPersonId: "per_b" }] : [];
        return [];
      }),
    },
    registration: { findMany: vi.fn(async () => [{ id: "reg_a", eventId: "evt_a", confirmationCode: "A-1", status: "CONFIRMED", accountHolderPersonId: "per_a" }]) },
    registrationAttendee: { findMany: vi.fn(async () => [{ personId: "per_b", registration: { id: "reg_b", eventId: "evt_b", confirmationCode: "B-1", status: "CONFIRMED" } }]) },
  };
}

function expectIdsOnly(entry: unknown) {
  const text = JSON.stringify(entry);
  for (const secret of [NAME, EMAIL, PHONE, REASON]) expect(text).not.toContain(secret);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPrisma.mockReturnValue(fakePrisma());
});

describe("cross-event identity reads write an ids-only audit entry", () => {
  it("listOpenMatchCandidates", async () => {
    mocks.getPrisma.mockReturnValue(fakePrisma(false));
    await listOpenMatchCandidates("usr_admin");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({ action: PERSON_CROSS_EVENT_READ_ACTION, actorUserId: "usr_admin", metadata: { surface: "OPEN_MATCH_CANDIDATES", resultCount: 1, resultIds: ["cand_1"] } });
    expect(entry.eventId).toBeUndefined();
    expectIdsOnly(entry);
  });

  it("listActivePersonMerges", async () => {
    await listActivePersonMerges("usr_admin");
    const entry = mocks.writeAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({ action: PERSON_CROSS_EVENT_READ_ACTION, actorUserId: "usr_admin", metadata: { surface: "ACTIVE_MERGES_LIST", resultIds: ["merge_1"] } });
    expectIdsOnly(entry);
  });

  it("getMergedPersonView records the people and events it spanned", async () => {
    const view = await getMergedPersonView("per_b", "usr_admin");
    expect(view.registrations).toHaveLength(2);
    const entry = mocks.writeAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: PERSON_CROSS_EVENT_READ_ACTION, actorUserId: "usr_admin", entityId: "per_a",
      metadata: { surface: "MERGED_PERSON_VIEW", canonicalPersonId: "per_a", memberPersonIds: ["per_a", "per_b"], eventIds: ["evt_a", "evt_b"] },
    });
    expectIdsOnly(entry);
  });

  it("GET /api/people/merges and GET /api/people/matches audit under the signed-in administrator", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "usr_admin", email: "a@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" } });
    const merges = await import("@/app/api/people/merges/route");
    const matches = await import("@/app/api/people/matches/route");
    expect((await merges.GET(new Request("https://events.imsda.test/api/people/merges"))).status).toBe(200);
    expect((await matches.GET(new Request("https://events.imsda.test/api/people/matches"))).status).toBe(200);
    expect(mocks.writeAuditLog.mock.calls.map(([entry]) => [entry.actorUserId, entry.metadata.surface])).toEqual([
      ["usr_admin", "ACTIVE_MERGES_LIST"],
      ["usr_admin", "OPEN_MATCH_CANDIDATES"],
    ]);
  });

  it("is written even when nothing is returned", async () => {
    mocks.getPrisma.mockReturnValue({ personMerge: { findMany: vi.fn(async () => []) } });
    expect(await listActivePersonMerges("usr_admin")).toEqual([]);
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({ metadata: { resultCount: 0, resultIds: [] } });
  });

  it("a refused read writes nothing, and a read whose audit fails returns no data", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "usr_staff", email: "s@example.test", displayName: "Staff", globalRole: null } });
    const merges = await import("@/app/api/people/merges/route");
    expect((await merges.GET(new Request("https://events.imsda.test/api/people/merges"))).status).toBe(403);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();

    mocks.writeAuditLog.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(listActivePersonMerges("usr_admin")).rejects.toThrow("audit unavailable");
  });

  it("refuses to record a read with no actor, and caps the ids it keeps", async () => {
    await expect(auditCrossEventIdentityRead({ actorUserId: "", surface: "ACTIVE_MERGES_LIST", resultIds: [] })).rejects.toThrow();
    const ids = Array.from({ length: CROSS_EVENT_READ_ID_CAP + 5 }, (_, index) => `id_${index}`);
    await auditCrossEventIdentityRead({ actorUserId: "usr_admin", surface: "ACTIVE_MERGES_LIST", resultIds: ids });
    const metadata = mocks.writeAuditLog.mock.calls[0][0].metadata;
    expect(metadata.resultIds).toHaveLength(CROSS_EVENT_READ_ID_CAP);
    expect(metadata).toMatchObject({ resultCount: CROSS_EVENT_READ_ID_CAP + 5, truncated: true });
  });

  it("caps the other id lists (people, events) the same way", async () => {
    const many = Array.from({ length: CROSS_EVENT_READ_ID_CAP + 3 }, (_, index) => `x_${index}`);
    await auditCrossEventIdentityRead({ actorUserId: "usr_admin", surface: "MERGED_PERSON_VIEW", resultIds: [], extra: { memberPersonIds: many, eventIds: ["evt_a"] } });
    const metadata = mocks.writeAuditLog.mock.calls[0][0].metadata;
    expect(metadata.memberPersonIds).toHaveLength(CROSS_EVENT_READ_ID_CAP);
    expect(metadata.eventIds).toEqual(["evt_a"]);
    expect(metadata.truncated).toBe(true);
  });
});
