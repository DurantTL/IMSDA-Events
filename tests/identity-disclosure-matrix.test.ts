import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The identity disclosure matrix (#128, `modules/people/disclosure-matrix.ts`):
 * one test per field row, each asserting the declared values (written out
 * independently here) and, where a code path enforces the row, that the code
 * agrees. If someone edits the matrix, the declared-value assertion fails; if
 * someone stops the code consulting it, the enforcement assertion fails.
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

import {
  AUDIENCE_REACH,
  DISCLOSURE_ACTIONS,
  DISCLOSURE_AUDIENCES,
  DISCLOSURE_MATRIX,
  IDENTITY_FIELDS,
  disclosureDecision,
  isDisclosureAllowed,
  isEventScopedDisclosureAllowed,
  personColumnSelect,
  staffIdentityAudience,
  type DisclosureAudience,
  type FieldClassification,
  type IdentityField,
} from "@/modules/people/disclosure-matrix";
import { requireSystemAdministrator } from "@/modules/people/duplicate-match-access";
import { requirePersonMergePermission } from "@/modules/people/person-merge-access";
import { listOpenMatchCandidates } from "@/modules/people/duplicate-match-repository";
import { listActivePersonMerges } from "@/modules/people/person-merge-repository";
import { anonymizePerson } from "@/modules/people/anonymization";

/** R = read, E = edit, X = export, A = view audit (upper case: allowed; lower case r/x: EVENT_SCOPED marker, no grant by itself); "-" = denied. Audiences in `DISCLOSURE_AUDIENCES` order. */
const EXPECTED: Record<IdentityField, { classification: FieldClassification; grid: [string, string, string, string, string] }> = {
  PERSON_NAME: { classification: "PERSONAL_IDENTIFIER", grid: ["REXA", "r-x-", "----", "----", "----"] },
  EMAIL: { classification: "CONTACT_DETAIL", grid: ["REXA", "r-x-", "----", "----", "----"] },
  PHONE: { classification: "CONTACT_DETAIL", grid: ["REXA", "r-x-", "----", "----", "----"] },
  HOUSEHOLD_MEMBERSHIP: { classification: "RELATIONSHIP", grid: ["RE-A", "----", "----", "----", "----"] },
  ACCOUNT_LINKS: { classification: "RELATIONSHIP", grid: ["RE-A", "----", "----", "----", "----"] },
  MERGE_HISTORY: { classification: "DERIVED_JUDGEMENT", grid: ["RE-A", "----", "----", "----", "----"] },
  MATCH_CANDIDATE_EVIDENCE: { classification: "DERIVED_JUDGEMENT", grid: ["RE-A", "----", "----", "----", "----"] },
  EXTERNAL_IDENTITIES: { classification: "PERSONAL_IDENTIFIER", grid: ["RE-A", "----", "----", "----", "----"] },
  ANONYMIZATION_RECORD: { classification: "COMPLIANCE_RECORD", grid: ["RE-A", "----", "----", "----", "----"] },
};
const LETTERS = ["R", "E", "X", "A"] as const;

const staffUser = { id: "usr_staff", email: "staff@example.test", displayName: "Event Staff", globalRole: null };
const adminUser = { id: "usr_admin", email: "admin@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" as const };

async function passes(gate: () => Promise<unknown>) {
  return gate().then(() => true, () => false);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPrisma.mockReset();
});

describe("matrix shape", () => {
  it("declares every field, audience and action, and nothing else", () => {
    expect(Object.keys(DISCLOSURE_MATRIX).sort()).toEqual([...IDENTITY_FIELDS].sort());
    expect([...IDENTITY_FIELDS].sort()).toEqual(Object.keys(EXPECTED).sort());
    expect([...DISCLOSURE_AUDIENCES]).toEqual(["SYSTEM_ADMIN", "EVENT_STAFF", "ATTENDEE_SELF", "HOUSEHOLD_MEMBER", "ANONYMOUS"]);
    expect([...DISCLOSURE_ACTIONS]).toEqual(["READ", "EDIT", "EXPORT", "VIEW_AUDIT"]);
  });

  it("gives an anonymous caller and a household member nothing, anywhere", () => {
    for (const field of IDENTITY_FIELDS) {
      for (const audience of ["HOUSEHOLD_MEMBER", "ANONYMOUS"] as const) {
        for (const action of DISCLOSURE_ACTIONS) {
          expect(isDisclosureAllowed(field, audience, action), `${field} ${audience} ${action}`).toBe(false);
        }
      }
    }
  });

  it("is deny-by-default: only the system administrator passes, and an event-staff read of a name or email is not a grant", () => {
    expect(AUDIENCE_REACH).toEqual({ SYSTEM_ADMIN: "GLOBAL", EVENT_STAFF: "OWN_EVENT", ATTENDEE_SELF: "SELF", HOUSEHOLD_MEMBER: "NONE", ANONYMOUS: "NONE" });
    for (const field of IDENTITY_FIELDS) {
      for (const audience of DISCLOSURE_AUDIENCES.filter((a) => a !== "SYSTEM_ADMIN")) {
        for (const action of DISCLOSURE_ACTIONS) {
          expect(isDisclosureAllowed(field, audience, action), `${field} ${audience} ${action}`).toBe(false);
        }
      }
    }
    expect(isDisclosureAllowed("EMAIL", "EVENT_STAFF", "READ")).toBe(false);
    expect(isDisclosureAllowed("EMAIL", "ATTENDEE_SELF", "READ")).toBe(false);
  });

  it("an event-scoped cell applies only with explicit proof for one event, and never to other audiences or cells", () => {
    const proof = { eventId: "evt_a", hasEventPermission: true, personInEvent: true };
    expect(isEventScopedDisclosureAllowed("EMAIL", "EVENT_STAFF", "READ", proof)).toBe(true);
    expect(isEventScopedDisclosureAllowed("EMAIL", "EVENT_STAFF", "READ", { ...proof, eventId: "" })).toBe(false);
    expect(isEventScopedDisclosureAllowed("EMAIL", "EVENT_STAFF", "READ", { ...proof, hasEventPermission: false })).toBe(false);
    expect(isEventScopedDisclosureAllowed("EMAIL", "EVENT_STAFF", "READ", { ...proof, personInEvent: false })).toBe(false);
    expect(isEventScopedDisclosureAllowed("EMAIL", "EVENT_STAFF", "READ", undefined as never)).toBe(false);
    // Cells that are denied, or granted globally, are not event-scoped grants.
    expect(isEventScopedDisclosureAllowed("EMAIL", "EVENT_STAFF", "EDIT", proof)).toBe(false);
    expect(isEventScopedDisclosureAllowed("MERGE_HISTORY", "EVENT_STAFF", "READ", proof)).toBe(false);
    expect(isEventScopedDisclosureAllowed("EMAIL", "ATTENDEE_SELF", "READ", proof)).toBe(false);
    expect(isEventScopedDisclosureAllowed("EMAIL", "SYSTEM_ADMIN", "READ", proof)).toBe(false);
  });

  it("denies anything it does not recognise", () => {
    expect(isDisclosureAllowed("NOT_A_FIELD" as IdentityField, "SYSTEM_ADMIN", "READ")).toBe(false);
    expect(isDisclosureAllowed("EMAIL", "NOT_AN_AUDIENCE" as DisclosureAudience, "READ")).toBe(false);
    expect(isDisclosureAllowed("EMAIL", "SYSTEM_ADMIN", "DELETE" as never)).toBe(false);
  });

  it("classifies a staff account by the global role only, whatever event permissions it holds", () => {
    expect(staffIdentityAudience(adminUser)).toBe("SYSTEM_ADMIN");
    expect(staffIdentityAudience(staffUser)).toBe("EVENT_STAFF");
    expect(staffIdentityAudience({})).toBe("EVENT_STAFF");
  });
});

describe.each(IDENTITY_FIELDS)("matrix row %s", (field) => {
  it("declares the classification and every audience x action value", () => {
    const expected = EXPECTED[field];
    expect(DISCLOSURE_MATRIX[field].classification).toBe(expected.classification);
    DISCLOSURE_AUDIENCES.forEach((audience, row) => {
      LETTERS.forEach((letter, column) => {
        const action = DISCLOSURE_ACTIONS[column]!;
        const cell = expected.grid[row]![column];
        const want = cell === letter ? "ALLOWED" : cell === letter.toLowerCase() ? "EVENT_SCOPED" : "DENIED";
        expect(disclosureDecision(field, audience, action), `${audience} ${action}`).toBe(want);
        // Enforcement: only an ALLOWED cell held by the global-reach audience passes; a marker or denial never does.
        expect(isDisclosureAllowed(field, audience, action), `${audience} ${action}`).toBe(want === "ALLOWED" && audience === "SYSTEM_ADMIN");
      });
    });
  });
});

describe("enforcement: the code decides through the matrix", () => {
  it("MATCH_CANDIDATE_EVIDENCE READ is the review queue gate", async () => {
    for (const [user, audience] of [[adminUser, "SYSTEM_ADMIN"], [staffUser, "EVENT_STAFF"]] as const) {
      mocks.getCurrentSession.mockResolvedValue({ user });
      expect(await passes(requireSystemAdministrator), audience).toBe(isDisclosureAllowed("MATCH_CANDIDATE_EVIDENCE", audience, "READ"));
    }
  });

  it("MERGE_HISTORY READ and EDIT are the merges list and merge/unmerge gates", async () => {
    for (const [user, audience] of [[adminUser, "SYSTEM_ADMIN"], [staffUser, "EVENT_STAFF"]] as const) {
      mocks.getCurrentSession.mockResolvedValue({ user });
      for (const action of ["READ", "EDIT"] as const) {
        expect(await passes(() => requirePersonMergePermission(action)), `${audience} ${action}`).toBe(isDisclosureAllowed("MERGE_HISTORY", audience, action));
      }
    }
  });

  it("ANONYMIZATION_RECORD EDIT is who may approve an anonymization", async () => {
    for (const [globalRole, audience] of [["SYSTEM_ADMIN", "SYSTEM_ADMIN"], [null, "EVENT_STAFF"]] as const) {
      const tx = {
        $executeRaw: vi.fn(async () => 1),
        user: { findUnique: vi.fn(async () => ({ globalRole })) },
        person: { findUnique: vi.fn(async () => ({ id: "per_a", anonymizedAt: new Date() })) },
      };
      mocks.getPrisma.mockReturnValue({ $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) });
      const allowed = await anonymizePerson({ personId: "per_a", approvedByUserId: "usr_x", approvalReference: "Synthetic request 1" }).then(() => true, (error: { code?: string }) => {
        expect(error.code).toBe("APPROVER_NOT_ALLOWED");
        return false;
      });
      expect(allowed, audience).toBe(isDisclosureAllowed("ANONYMIZATION_RECORD", audience, "EDIT"));
    }
  });

  it("PERSON_NAME, EMAIL and PHONE: the projection is the requested columns for the system administrator and an error for anyone else", () => {
    const columns = ["firstName", "lastName", "normalizedEmail", "phone"] as const;
    expect(personColumnSelect("SYSTEM_ADMIN", columns)).toEqual({ id: true, firstName: true, lastName: true, normalizedEmail: true, phone: true });
    // A denied column is refused outright rather than silently dropped from a typed result.
    for (const audience of ["EVENT_STAFF", "ATTENDEE_SELF", "HOUSEHOLD_MEMBER", "ANONYMOUS"] as const) {
      expect(() => personColumnSelect(audience, columns), audience).toThrow(/may not read/);
    }
  });

  it("the queue and the merges list read only matrix-allowed person columns and expose no household, link, or external identity data", async () => {
    const selects: unknown[] = [];
    const person = (id: string) => ({ id, firstName: "Sample", lastName: "Person", normalizedEmail: "sample@example.test", phone: "(515) 555-0100" });
    const candidates = [{
      id: "c1", matchedSignals: ["PHONE_MATCH"], contradictingSignals: [], confidence: "HIGH", ruleVersion: 1, state: "OPEN",
      computedAt: new Date("2026-01-01T00:00:00Z"), dismissedAt: null, dismissedByUserId: null, dismissalReason: null,
      personA: person("per_a"), personB: person("per_b"),
    }];
    mocks.getPrisma.mockReturnValue({
      personMatchCandidate: { findMany: vi.fn(async (args: { select: unknown }) => { selects.push(args.select); return candidates; }) },
      personMerge: {
        findMany: vi.fn(async (args: { select: unknown; where: { state: string } }) => {
          selects.push(args.select);
          // The queue's root resolution also reads merges; give it nothing.
          return args.where.state === "ACTIVE" && "primaryPerson" in (args.select as object)
            ? [{ id: "m1", reason: "Same person", mergedAt: new Date("2026-01-02T00:00:00Z"), primaryPerson: { id: "per_a", firstName: "Sample", lastName: "Person" }, secondaryPerson: { id: "per_b", firstName: "Sample", lastName: "Person" } }]
            : [];
        }),
      },
    });
    const queue = await listOpenMatchCandidates("usr_admin");
    const merges = await listActivePersonMerges("usr_admin");
    const flattened = JSON.stringify(selects);
    expect(flattened).not.toMatch(/household|externalIdentit|accountLink|PersonLink|registration/i);
    expect(selects[0]).toMatchObject({ personA: { select: personColumnSelect("SYSTEM_ADMIN", ["firstName", "lastName", "normalizedEmail", "phone"]) } });
    expect(Object.keys(queue[0]!).join(" ")).not.toMatch(/household|externalIdentit|accountLink/i);
    expect(Object.keys(merges[0]!.primaryPerson).sort()).toEqual(["firstName", "id", "lastName"]);
  });

  it("HOUSEHOLD_MEMBERSHIP, ACCOUNT_LINKS and EXTERNAL_IDENTITIES have no staff, attendee or household read path: only the system administrator audience holds them", () => {
    for (const field of ["HOUSEHOLD_MEMBERSHIP", "ACCOUNT_LINKS", "EXTERNAL_IDENTITIES"] as const) {
      for (const audience of ["EVENT_STAFF", "ATTENDEE_SELF", "HOUSEHOLD_MEMBER", "ANONYMOUS"] as const) {
        expect(isDisclosureAllowed(field, audience, "READ"), `${field} ${audience}`).toBe(false);
      }
    }
  });

  it("the gates consult the matrix rather than a hard-coded role", async () => {
    const { readFileSync } = await import("node:fs");
    for (const path of ["modules/people/duplicate-match-access.ts", "modules/people/person-merge-access.ts", "modules/people/anonymization.ts"]) {
      const text = readFileSync(path, "utf8");
      expect(text, path).toMatch(/isDisclosureAllowed\(/);
      expect(text, path).not.toMatch(/globalRole\s*[!=]==?\s*"SYSTEM_ADMIN"/);
    }
  });
});
