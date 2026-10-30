import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  writeAuditLog: vi.fn(),
  getCurrentSession: vi.fn(),
  mergeMatchCandidate: vi.fn(),
  unmergePeople: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));

import {
  MAX_MERGE_CHAIN_DEPTH,
  PersonMergeResolutionError,
  collectMergedMembers,
  resolveCanonicalIds,
} from "@/modules/people/person-merge-domain";
import {
  PersonMergeError,
  mergeMatchCandidate,
  mergePeople,
  resolveCanonicalPersonId,
  unmergePeople,
} from "@/modules/people/person-merge-repository";
import {
  PERSON_ANONYMIZED_FIELDS,
  PERSON_ANONYMIZED_REPLACEMENTS,
  PersonAnonymizationError,
  anonymizePerson,
} from "@/modules/people/anonymization";

type MergeRow = {
  id: string;
  primaryPersonId: string;
  secondaryPersonId: string;
  state: "ACTIVE" | "REVERSED";
  actorUserId: string;
  reason: string;
  evidence: Record<string, unknown>;
  sourceCandidateId: string | null;
  priorState: { sourceCandidate: { id: string; state: string } | null };
  reversedAt?: Date;
  reversedByUserId?: string;
  reversalReason?: string;
};
type CandidateRow = { id: string; personAId: string; personBId: string; state: string; matchedSignals: string[]; ruleVersion: number };
type PersonRow = { id: string; anonymizedAt: Date | null; [key: string]: unknown };

function link(secondaryPersonId: string, primaryPersonId: string, id = `m_${secondaryPersonId}`): MergeRow {
  return {
    id, primaryPersonId, secondaryPersonId, state: "ACTIVE", actorUserId: "u1", reason: "same person",
    evidence: {}, sourceCandidateId: null, priorState: { sourceCandidate: null },
  };
}

function buildFake(fixture: { people?: string[]; merges?: MergeRow[]; candidates?: CandidateRow[]; anonymized?: string[]; users?: Array<{ id: string; globalRole: string | null }> }) {
  const people: PersonRow[] = (fixture.people ?? []).map((id) => ({ id, anonymizedAt: fixture.anonymized?.includes(id) ? new Date() : null, firstName: "First" }));
  const merges = fixture.merges ?? [];
  const candidates = fixture.candidates ?? [];
  const anonymizations: unknown[] = [];
  let next = 1;
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    person: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => people.filter((p) => where.id.in.includes(p.id))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => people.find((p) => p.id === where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; anonymizedAt: null }; data: Record<string, unknown> }) => {
        const row = people.find((p) => p.id === where.id && p.anonymizedAt === null);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (fixture.users ?? []).find((u) => u.id === where.id) ?? null) },
    personAnonymization: { create: vi.fn(async ({ data }: { data: unknown }) => { anonymizations.push(data); return data; }) },
    personMerge: {
      findMany: vi.fn(async ({ where }: { where: { secondaryPersonId?: { in: string[] }; primaryPersonId?: { in: string[] }; state: string } }) =>
        merges.filter((m) =>
          m.state === where.state &&
          (!where.secondaryPersonId || where.secondaryPersonId.in.includes(m.secondaryPersonId)) &&
          (!where.primaryPersonId || where.primaryPersonId.in.includes(m.primaryPersonId))).map((m) => ({ ...m }))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const m = merges.find((row) => row.id === where.id); return m ? { ...m } : null; }),
      create: vi.fn(async ({ data }: { data: Omit<MergeRow, "id" | "state"> }) => {
        const row = { id: `merge_${next++}`, state: "ACTIVE" as const, ...data };
        merges.push(row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MergeRow> }) => {
        const row = merges.find((m) => m.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      }),
    },
    personMatchCandidate: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const c = candidates.find((row) => row.id === where.id); return c ? { ...c } : null; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<CandidateRow> }) => {
        const row = candidates.find((c) => c.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      }),
    },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
  return { prisma, tx, merges, candidates, people, anonymizations };
}

beforeEach(() => vi.clearAllMocks());

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  return error instanceof PersonMergeError ? error.code : error;
}

describe("canonical resolution", () => {
  it("follows a chain to the ultimate primary and leaves an unmerged person alone", async () => {
    const { prisma } = buildFake({ merges: [link("a", "b"), link("b", "c")] });
    expect(await resolveCanonicalPersonId("a", prisma as never)).toBe("c");
    expect(await resolveCanonicalPersonId("b", prisma as never)).toBe("c");
    expect(await resolveCanonicalPersonId("c", prisma as never)).toBe("c");
    expect(await resolveCanonicalPersonId("z", prisma as never)).toBe("z");
  });

  it("ignores reversed links", async () => {
    const reversed = { ...link("a", "b"), state: "REVERSED" as const };
    const { prisma } = buildFake({ merges: [reversed] });
    expect(await resolveCanonicalPersonId("a", prisma as never)).toBe("a");
  });

  it("resolves a batch in one lookup per hop", async () => {
    const calls: string[][] = [];
    const links = new Map([["a", "b"], ["b", "c"], ["x", "c"]]);
    const result = await resolveCanonicalIds(["a", "x", "c", "q"], async (ids) => {
      calls.push(ids);
      return new Map(ids.filter((id) => links.has(id)).map((id) => [id, links.get(id)!]));
    });
    expect([...result]).toEqual([["a", "c"], ["x", "c"], ["c", "c"], ["q", "q"]]);
    expect(calls).toHaveLength(3);
  });

  it("throws on a cycle instead of looping", async () => {
    const links = new Map([["a", "b"], ["b", "c"], ["c", "a"]]);
    const loader = async (ids: string[]) => new Map(ids.filter((id) => links.has(id)).map((id) => [id, links.get(id)!]));
    await expect(resolveCanonicalIds(["a"], loader)).rejects.toMatchObject({ code: "CYCLE" });
  });

  it("enforces the depth cap", async () => {
    const loader = async (ids: string[]) => new Map(ids.map((id) => [id, `${id}x`]));
    await expect(resolveCanonicalIds(["a"], loader)).rejects.toBeInstanceOf(PersonMergeResolutionError);
    await expect(resolveCanonicalIds(["a"], loader)).rejects.toMatchObject({ code: "DEPTH_EXCEEDED" });

    const exactly = new Map<string, string>();
    for (let i = 0; i < MAX_MERGE_CHAIN_DEPTH; i += 1) exactly.set(`p${i}`, `p${i + 1}`);
    const ok = await resolveCanonicalIds(["p0"], async (ids) => new Map(ids.filter((id) => exactly.has(id)).map((id) => [id, exactly.get(id)!])));
    expect(ok.get("p0")).toBe(`p${MAX_MERGE_CHAIN_DEPTH}`);
  });

  it("lists everyone merged beneath a root with the tree height, and refuses a cycle", async () => {
    const rows = [
      { id: "m1", primaryPersonId: "r", secondaryPersonId: "a" },
      { id: "m2", primaryPersonId: "a", secondaryPersonId: "b" },
    ];
    const loader = async (ids: string[]) => rows.filter((row) => ids.includes(row.primaryPersonId));
    const result = await collectMergedMembers("r", loader);
    expect(result.height).toBe(2);
    expect(result.members.map((m) => m.personId)).toEqual(["a", "b"]);
    const cyclic = [...rows, { id: "m3", primaryPersonId: "b", secondaryPersonId: "r" }];
    await expect(collectMergedMembers("r", async (ids) => cyclic.filter((row) => ids.includes(row.primaryPersonId)))).rejects.toMatchObject({ code: "CYCLE" });
  });
});

describe("mergePeople", () => {
  it("creates one link, audits it with ids only, and keeps the reason off the audit entry", async () => {
    const fake = buildFake({ people: ["a", "b"] });
    mocks.getPrisma.mockReturnValue(fake.prisma);
    const merge = await mergePeople({ primaryPersonId: "a", secondaryPersonId: "b", actorUserId: "u1", reason: "Same person, confirmed by phone" });
    expect(merge).toMatchObject({ primaryPersonId: "a", secondaryPersonId: "b", state: "ACTIVE" });
    expect(fake.tx.$executeRaw).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({ action: "PERSON_MERGED", actorUserId: "u1", entityType: "PersonMerge", entityId: merge.id });
    expect(JSON.stringify(entry)).not.toContain("confirmed by phone");
  });

  it("merging an already-merged person links the roots, so it lands on the ultimate primary", async () => {
    const fake = buildFake({ people: ["a", "b", "c", "d"], merges: [link("b", "c")] });
    mocks.getPrisma.mockReturnValue(fake.prisma);
    // b is already under c; merging d under b links d to c, not to b.
    const first = await mergePeople({ primaryPersonId: "b", secondaryPersonId: "d", actorUserId: "u1", reason: "same person" });
    expect(first).toMatchObject({ primaryPersonId: "c", secondaryPersonId: "d" });
    expect(first.evidence).toMatchObject({ requestedPrimaryPersonId: "b", requestedSecondaryPersonId: "d" });
    // a selected as secondary of d (which resolves to c): a joins c.
    const second = await mergePeople({ primaryPersonId: "d", secondaryPersonId: "a", actorUserId: "u1", reason: "same person" });
    expect(second).toMatchObject({ primaryPersonId: "c", secondaryPersonId: "a" });
  });

  it("refuses people who already share a root (would cycle) and the same person twice", async () => {
    const fake = buildFake({ people: ["a", "b", "c"], merges: [link("a", "b"), link("c", "b")] });
    mocks.getPrisma.mockReturnValue(fake.prisma);
    expect(await codeOf(mergePeople({ primaryPersonId: "a", secondaryPersonId: "c", actorUserId: "u1", reason: "same person" }))).toBe("SAME_PERSON");
    expect(await codeOf(mergePeople({ primaryPersonId: "b", secondaryPersonId: "a", actorUserId: "u1", reason: "same person" }))).toBe("SAME_PERSON");
    expect(await codeOf(mergePeople({ primaryPersonId: "a", secondaryPersonId: "a", actorUserId: "u1", reason: "same person" }))).toBe("SAME_PERSON");
    expect(fake.merges).toHaveLength(2);
  });

  it("refuses a short reason, a missing person, and an anonymized person", async () => {
    const fake = buildFake({ people: ["a", "b", "z"], anonymized: ["z"] });
    mocks.getPrisma.mockReturnValue(fake.prisma);
    expect(await codeOf(mergePeople({ primaryPersonId: "a", secondaryPersonId: "b", actorUserId: "u1", reason: "no" }))).toBe("INVALID_REASON");
    expect(await codeOf(mergePeople({ primaryPersonId: "a", secondaryPersonId: "ghost", actorUserId: "u1", reason: "same person" }))).toBe("NOT_FOUND");
    expect(await codeOf(mergePeople({ primaryPersonId: "a", secondaryPersonId: "z", actorUserId: "u1", reason: "same person" }))).toBe("ANONYMIZED_PERSON");
    expect(fake.merges).toHaveLength(0);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses a merge that would build a chain past the depth cap", async () => {
    const chain: MergeRow[] = [];
    for (let i = 0; i < MAX_MERGE_CHAIN_DEPTH; i += 1) chain.push(link(`p${i + 1}`, `p${i}`));
    const fake = buildFake({ people: ["top", ...Array.from({ length: MAX_MERGE_CHAIN_DEPTH + 1 }, (_, i) => `p${i}`)], merges: chain });
    mocks.getPrisma.mockReturnValue(fake.prisma);
    // p0 is the root of a full-height tree; putting it under "top" would exceed the cap.
    expect(await codeOf(mergePeople({ primaryPersonId: "top", secondaryPersonId: "p0", actorUserId: "u1", reason: "same person" }))).toBe("RESOLUTION_FAILED");
  });

  it("marks the source candidate MERGED, requires it to be open and to be this pair", async () => {
    const candidates: CandidateRow[] = [
      { id: "c1", personAId: "a", personBId: "b", state: "OPEN", matchedSignals: ["PHONE_MATCH"], ruleVersion: 1 },
      { id: "c2", personAId: "a", personBId: "b", state: "DISMISSED", matchedSignals: [], ruleVersion: 1 },
    ];
    const fake = buildFake({ people: ["a", "b", "c"], candidates });
    mocks.getPrisma.mockReturnValue(fake.prisma);
    expect(await codeOf(mergePeople({ primaryPersonId: "a", secondaryPersonId: "b", actorUserId: "u1", reason: "same person", sourceCandidateId: "c2" }))).toBe("CANDIDATE_NOT_OPEN");
    expect(await codeOf(mergePeople({ primaryPersonId: "a", secondaryPersonId: "c", actorUserId: "u1", reason: "same person", sourceCandidateId: "c1" }))).toBe("INVALID_CANDIDATE");
    const merge = await mergePeople({ primaryPersonId: "a", secondaryPersonId: "b", actorUserId: "u1", reason: "same person", sourceCandidateId: "c1" });
    expect(candidates[0].state).toBe("MERGED");
    expect(merge.priorState).toEqual({ sourceCandidate: { id: "c1", state: "OPEN" } });
  });

  it("mergeMatchCandidate picks the other person as secondary and rejects a primary outside the pair", async () => {
    const candidates: CandidateRow[] = [{ id: "c1", personAId: "a", personBId: "b", state: "OPEN", matchedSignals: [], ruleVersion: 1 }];
    const fake = buildFake({ people: ["a", "b"], candidates });
    mocks.getPrisma.mockReturnValue(fake.prisma);
    expect(await codeOf(mergeMatchCandidate("c1", "zzz", "u1", "same person"))).toBe("INVALID_CANDIDATE");
    const merge = await mergeMatchCandidate("c1", "b", "u1", "same person");
    expect(merge).toMatchObject({ primaryPersonId: "b", secondaryPersonId: "a" });
  });
});

describe("unmergePeople", () => {
  it("reverses the merge, keeps the row, restores the candidate, and audits", async () => {
    const candidates: CandidateRow[] = [{ id: "c1", personAId: "a", personBId: "b", state: "OPEN", matchedSignals: [], ruleVersion: 1 }];
    const fake = buildFake({ people: ["a", "b"], candidates });
    mocks.getPrisma.mockReturnValue(fake.prisma);
    const merge = await mergePeople({ primaryPersonId: "a", secondaryPersonId: "b", actorUserId: "u1", reason: "same person", sourceCandidateId: "c1" });
    expect(candidates[0].state).toBe("MERGED");
    const reversed = await unmergePeople(merge.id, "u2", "Merged by mistake");
    expect(reversed).toMatchObject({ state: "REVERSED", reversedByUserId: "u2", reversalReason: "Merged by mistake" });
    expect(fake.merges).toHaveLength(1);
    expect(candidates[0].state).toBe("OPEN");
    const entry = mocks.writeAuditLog.mock.calls.at(-1)![0];
    expect(entry).toMatchObject({ action: "PERSON_MERGE_REVERSED", actorUserId: "u2", entityId: merge.id });
    expect(JSON.stringify(entry)).not.toContain("by mistake");
    // The pair can be merged again afterwards.
    expect((await mergePeople({ primaryPersonId: "a", secondaryPersonId: "b", actorUserId: "u1", reason: "same person" })).state).toBe("ACTIVE");
  });

  it("refuses a non-active merge, a missing merge, and a short reason", async () => {
    const reversed = { ...link("a", "b", "m1"), state: "REVERSED" as const };
    const fake = buildFake({ merges: [reversed, link("c", "d", "m2")] });
    mocks.getPrisma.mockReturnValue(fake.prisma);
    expect(await codeOf(unmergePeople("m1", "u1", "valid reason"))).toBe("NOT_ACTIVE");
    expect(await codeOf(unmergePeople("nope", "u1", "valid reason"))).toBe("NOT_FOUND");
    expect(await codeOf(unmergePeople("m2", "u1", "x"))).toBe("INVALID_REASON");
    expect(fake.merges[1].state).toBe("ACTIVE");
  });
});

describe("anonymization", () => {
  it("declares its personal fields in one list with a replacement for each", () => {
    expect([...PERSON_ANONYMIZED_FIELDS]).toEqual(["firstName", "lastName", "normalizedEmail", "phone"]);
    expect(Object.keys(PERSON_ANONYMIZED_REPLACEMENTS).sort()).toEqual([...PERSON_ANONYMIZED_FIELDS].sort());
    expect(PERSON_ANONYMIZED_REPLACEMENTS).toMatchObject({ firstName: "Anonymized", lastName: "Person", normalizedEmail: null, phone: null });
  });

  it("anonymizes once, records the approval, audits ids only, and is idempotent", async () => {
    const fake = buildFake({ people: ["p1"], users: [{ id: "admin", globalRole: "SYSTEM_ADMIN" }] });
    mocks.getPrisma.mockReturnValue(fake.prisma);
    const first = await anonymizePerson({ personId: "p1", approvedByUserId: "admin", approvalReference: "Request 2026-14" });
    expect(first.alreadyAnonymized).toBe(false);
    expect(fake.people[0]).toMatchObject({ firstName: "Anonymized", lastName: "Person", normalizedEmail: null, phone: null });
    expect(fake.people[0].anonymizedAt).toBeInstanceOf(Date);
    expect(fake.anonymizations).toHaveLength(1);
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls[0][0])).not.toContain("Request 2026-14");
    const again = await anonymizePerson({ personId: "p1", approvedByUserId: "admin", approvalReference: "Request 2026-14" });
    expect(again.alreadyAnonymized).toBe(true);
    expect(fake.anonymizations).toHaveLength(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("refuses a short reference, a non-administrator approver, and a missing person", async () => {
    const fake = buildFake({ people: ["p1"], users: [{ id: "admin", globalRole: "SYSTEM_ADMIN" }, { id: "staff", globalRole: null }] });
    mocks.getPrisma.mockReturnValue(fake.prisma);
    await expect(anonymizePerson({ personId: "p1", approvedByUserId: "admin", approvalReference: "x" })).rejects.toBeInstanceOf(PersonAnonymizationError);
    await expect(anonymizePerson({ personId: "p1", approvedByUserId: "staff", approvalReference: "Request 1" })).rejects.toMatchObject({ code: "APPROVER_NOT_ALLOWED" });
    await expect(anonymizePerson({ personId: "ghost", approvedByUserId: "admin", approvalReference: "Request 1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.people[0].anonymizedAt).toBeNull();
  });

  it("is not reachable from the merge module or any merge route", () => {
    const files = [
      "modules/people/person-merge-repository.ts",
      "modules/people/person-merge-domain.ts",
      "modules/people/person-merge-access.ts",
      "app/api/people/matches/[candidateId]/merge/route.ts",
      "app/api/people/merges/[mergeId]/unmerge/route.ts",
      "app/api/people/merges/route.ts",
    ];
    for (const file of files) expect(readFileSync(file, "utf8")).not.toMatch(/people\/anonymization|anonymizePerson/);
    expect(readFileSync("modules/people/anonymization.ts", "utf8")).not.toMatch(/person-merge/);
  });
});

describe("merge routes", () => {
  async function loadRoutes() {
    vi.doMock("@/modules/people/person-merge-repository", async () => {
      const actual = await vi.importActual<typeof import("@/modules/people/person-merge-repository")>("@/modules/people/person-merge-repository");
      return { ...actual, mergeMatchCandidate: mocks.mergeMatchCandidate, unmergePeople: mocks.unmergePeople };
    });
    const merge = await import("@/app/api/people/matches/[candidateId]/merge/route");
    const unmerge = await import("@/app/api/people/merges/[mergeId]/unmerge/route");
    return { merge: merge.POST, unmerge: unmerge.POST };
  }
  const post = (body: unknown) => new Request("https://events.imsda.test/x", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://events.imsda.test" }, body: JSON.stringify(body),
  });

  it("refuses a non-administrator and an anonymous caller before touching anything", async () => {
    const { merge, unmerge } = await loadRoutes();
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "u1", globalRole: null } });
    const mergeContext = { params: Promise.resolve({ candidateId: "c1" }) };
    const unmergeContext = { params: Promise.resolve({ mergeId: "m1" }) };
    expect((await merge(post({ primaryPersonId: "a", reason: "same person" }), mergeContext)).status).toBe(403);
    expect((await unmerge(post({ reason: "mistake made" }), unmergeContext)).status).toBe(403);
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await merge(post({ primaryPersonId: "a", reason: "same person" }), mergeContext)).status).toBe(401);
    expect(mocks.mergeMatchCandidate).not.toHaveBeenCalled();
    expect(mocks.unmergePeople).not.toHaveBeenCalled();
  });

  it("lets a system administrator merge and unmerge, and rejects a missing reason", async () => {
    const { merge, unmerge } = await loadRoutes();
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin", globalRole: "SYSTEM_ADMIN" } });
    mocks.mergeMatchCandidate.mockResolvedValue({ id: "m1", state: "ACTIVE" });
    mocks.unmergePeople.mockResolvedValue({ id: "m1", state: "REVERSED" });
    const mergeContext = { params: Promise.resolve({ candidateId: "c1" }) };
    expect((await merge(post({ primaryPersonId: "a", reason: "same person" }), mergeContext)).status).toBe(200);
    expect(mocks.mergeMatchCandidate).toHaveBeenCalledWith("c1", "a", "admin", "same person");
    expect((await merge(post({ primaryPersonId: "a", reason: "no" }), mergeContext)).status).toBe(400);
    expect((await unmerge(post({ reason: "mistake made" }), { params: Promise.resolve({ mergeId: "m1" }) })).status).toBe(200);
    expect(mocks.unmergePeople).toHaveBeenCalledWith("m1", "admin", "mistake made");
  });
});
