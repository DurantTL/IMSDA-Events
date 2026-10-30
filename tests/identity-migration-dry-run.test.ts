import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  classifyIdentityMigration,
  type AccountRow,
  type DryRunInput,
  type PersonRow,
} from "@/modules/people/identity-migration-dry-run-domain";

/** Synthetic rows only. */
const person = (id: string, extra: Partial<PersonRow> = {}): PersonRow => ({
  id, firstName: `First${id}`, lastName: `Last${id}`, normalizedEmail: null, phone: null, anonymized: false, ...extra,
});
const account = (id: string, email: string, extra: Partial<AccountRow> = {}): AccountRow => ({
  id, email, status: "ACTIVE", emailVerifiedAt: true, disabled: false, linkedPersonIds: [], ...extra,
});
const empty: DryRunInput = { accounts: [], persons: [], householdMembers: [], attendees: [], externalIdentities: [], activeMerges: [], existingCandidates: [], accountLinks: [] };
const run = (input: Partial<DryRunInput>, options = {}) => classifyIdentityMigration({ ...empty, ...input }, options);
const codes = (report: ReturnType<typeof run>, table: string) => report.exceptions.filter((row) => row.table === table).map((row) => `${row.rowId}:${row.code}`);

describe("account link classification", () => {
  it("proposes a link only for one unambiguous verified exact-email match, and masks the email", () => {
    const report = run({ persons: [person("p1", { normalizedEmail: "alicia@example.test" })], accounts: [account("a1", "Alicia@Example.test")] });
    expect(report.wouldLinkAccounts).toEqual([{ accountId: "a1", personId: "p1", rule: "VERIFIED_EMAIL_EXACT", email: "a***@e***.test" }]);
    expect(run({ persons: [person("p1", { normalizedEmail: "alicia@example.test" })], accounts: [account("a1", "alicia@example.test")] }, { showEmails: true }).wouldLinkAccounts[0]!.email).toBe("alicia@example.test");
  });

  it("never proposes, and routes to review, the ambiguous cases", () => {
    const report = run({
      persons: [
        person("p1", { normalizedEmail: "one@example.test" }), person("p2", { normalizedEmail: "ONE@example.test" }),
        person("anon", { normalizedEmail: "anon@example.test", anonymized: true }),
        person("sec", { normalizedEmail: "sec@example.test" }), person("prim"),
        person("taken", { normalizedEmail: "taken@example.test" }),
      ],
      accounts: [
        account("multi", "one@example.test"), account("isanon", "anon@example.test"), account("ismerged", "sec@example.test"),
        account("istaken", "taken@example.test"), account("holder", "h@example.test", { linkedPersonIds: ["taken"] }),
        account("two", "t@example.test", { linkedPersonIds: ["p1", "p2"] }),
        account("unverified", "u@example.test", { emailVerifiedAt: false }),
        account("disabled", "d@example.test", { disabled: true }),
        account("pending", "x@example.test", { status: "PENDING_VERIFICATION" }),
      ],
      activeMerges: [{ secondaryPersonId: "sec", primaryPersonId: "prim" }],
      accountLinks: [{ accountId: "holder", personId: "taken" }],
    });
    expect(report.wouldLinkAccounts).toEqual([]);
    expect(codes(report, "AttendeeAccount")).toEqual([
      "disabled:ACCOUNT_NOT_VERIFIED_ACTIVE", "isanon:MATCHED_PERSON_ANONYMIZED", "ismerged:MATCHED_PERSON_IS_MERGED",
      "istaken:PERSON_ALREADY_LINKED_TO_ANOTHER_ACCOUNT", "multi:SEVERAL_PEOPLE_MATCH_EMAIL", "pending:ACCOUNT_NOT_VERIFIED_ACTIVE",
      "two:ACCOUNT_LINKED_TO_SEVERAL_PEOPLE", "unverified:ACCOUNT_NOT_VERIFIED_ACTIVE",
    ]);
    const review = report.exceptions.filter((row) => row.routing === "REVIEW_QUEUE").map((row) => row.rowId);
    expect(review).toEqual(["isanon", "ismerged", "istaken", "multi", "two"]);
  });
});

describe("household backfill and attendee rows", () => {
  it("selects legacy rows like household-backfill.ts and flags rows the backfill would invert", () => {
    const base = { householdId: "h1", personId: "p1", createdAt: "2026-03-01T00:00:00.000Z", effectiveTo: null };
    const report = run({
      householdMembers: [
        { id: "m1", ...base, effectiveFrom: null }, { id: "m2", ...base, householdId: "h2", effectiveFrom: null },
        { id: "m3", ...base, effectiveFrom: "2026-01-01T00:00:00.000Z" },
        { id: "m4", ...base, effectiveFrom: null, effectiveTo: "2000-01-01T00:00:00.000Z" },
        { id: "m5", ...base, effectiveFrom: "2026-05-01T00:00:00.000Z", effectiveTo: "2026-04-01T00:00:00.000Z" },
      ],
    });
    expect(report.householdsNeedingBackfill).toEqual([
      { householdId: "h1", memberRowIds: ["m1"], personIds: ["p1"] }, { householdId: "h2", memberRowIds: ["m2"], personIds: ["p1"] },
    ]);
    expect(codes(report, "HouseholdMember")).toEqual(["m4:BACKFILL_WOULD_INVERT_INTERVAL", "m5:INVERTED_INTERVAL"]);
  });

  it("classifies attendee rows, with no person or an anonymized person as exceptions", () => {
    const report = run({
      persons: [person("p1"), person("anon", { anonymized: true }), person("sec")],
      activeMerges: [{ secondaryPersonId: "sec", primaryPersonId: "p1" }],
      attendees: [{ id: "r1", personId: "p1" }, { id: "r2", personId: "anon" }, { id: "r3", personId: null }, { id: "r4", personId: "ghost" }, { id: "r5", personId: "sec" }],
    });
    expect(report.reconciliation.find((table) => table.table === "RegistrationAttendee")).toMatchObject({ input: 5, buckets: { ON_ACTIVE_PERSON: 1, ON_MERGED_SECONDARY: 1 }, exceptions: 3, reconciled: true });
    expect(codes(report, "RegistrationAttendee")).toEqual(["r2:PERSON_ANONYMIZED", "r3:NO_PERSON", "r4:NO_PERSON"]);
  });
});

describe("duplicate candidates", () => {
  const twins = [person("a", { phone: "(515) 555-0111", lastName: "Same" }), person("b", { phone: "5155550111", lastName: "Same" })];

  it("proposes a surfaced pair for the review queue, once", () => {
    const report = run({ persons: twins });
    expect(report.duplicateCandidates).toEqual([expect.objectContaining({ personAId: "a", personBId: "b", action: "WOULD_CREATE", routing: "REVIEW_QUEUE" })]);
  });

  it("skips pairs sharing a canonical person and marks a changed open candidate (the same-fingerprint skip is checked on a real database)", () => {
    expect(run({ persons: twins, activeMerges: [{ secondaryPersonId: "b", primaryPersonId: "a" }] }).duplicateCandidates).toEqual([]);
    expect(run({ persons: twins, existingCandidates: [{ personAId: "a", personBId: "b", fingerprint: "stale", state: "OPEN" }] }).duplicateCandidates[0]!.action).toBe("WOULD_SUPERSEDE_OPEN");
  });

  it("leaves anonymized people out and reports a merge cycle as an exception instead of throwing", () => {
    expect(run({ persons: [twins[0]!, { ...twins[1]!, anonymized: true }] }).duplicateCandidates).toEqual([]);
    const cyclic = run({ persons: twins, activeMerges: [{ secondaryPersonId: "a", primaryPersonId: "b" }, { secondaryPersonId: "b", primaryPersonId: "a" }] });
    expect(cyclic.exceptions.map((row) => row.code)).toContain("MERGE_CHAIN_UNRESOLVABLE");
    expect(cyclic.reconciled).toBe(true);
  });
});

describe("reconciliation and determinism", () => {
  const input: DryRunInput = {
    ...empty,
    persons: [person("p2", { normalizedEmail: "b@example.test", phone: "5155550100" }), person("p1", { normalizedEmail: "a@example.test", phone: "5155550100" })],
    accounts: [account("z", "b@example.test"), account("y", "a@example.test"), account("x", "none@example.test")],
    attendees: [{ id: "r1", personId: "p1" }],
  };

  it("every table reconciles and the report holds no name or full email", () => {
    const report = run(input);
    expect(report.reconciled).toBe(true);
    for (const table of report.reconciliation) {
      expect(table.input).toBe(Object.values(table.buckets).reduce((sum, count) => sum + count, 0) + table.exceptions);
    }
    expect(JSON.stringify(report)).not.toMatch(/First|Last|@example\.test|5155550100/);
  });

  it("is byte-identical for the same data in any input order", () => {
    const shuffled: DryRunInput = { ...input, persons: [...input.persons].reverse(), accounts: [...input.accounts].reverse() };
    expect(JSON.stringify(run(shuffled))).toBe(JSON.stringify(run(input)));
  });
});

describe("the loader is read-only", () => {
  const loader = readFileSync("modules/people/identity-migration-dry-run.ts", "utf8");
  const domain = readFileSync("modules/people/identity-migration-dry-run-domain.ts", "utf8");

  it("runs everything inside the read-only transaction helper and calls no writer", () => {
    expect(loader).toMatch(/withReadOnlyTransaction\(prisma/);
    expect(loader).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe/);
    expect(loader).not.toMatch(/generateMatchCandidates|backfillHouseholdMembership|writeAuditLog|audit-service|anonymizePerson|mergePeople|unmergePeople|addHouseholdMember|closeHouseholdMember/);
    expect(loader).not.toMatch(/from ["'](?:@\/lib\/prisma|\.\.\/\.\.\/lib\/prisma)["']/);
  });

  it("the pure domain imports no database, clock or random source", () => {
    expect(domain).not.toMatch(/@prisma|lib\/prisma|Date\.now|new Date\(|Math\.random|randomUUID/);
  });

  it("the transaction helper really sets READ ONLY first", async () => {
    const { withReadOnlyTransaction } = await import("@/modules/account-merge/dry-run");
    const statements: string[] = [];
    const tx = { $executeRaw: vi.fn(async (strings: TemplateStringsArray) => { statements.push(strings.join("")); return 0; }) };
    await withReadOnlyTransaction({ $transaction: (async (work: (client: unknown) => unknown) => work(tx)) as never }, async () => "ok");
    expect(statements[0]).toBe("SET TRANSACTION READ ONLY");
  });
});
