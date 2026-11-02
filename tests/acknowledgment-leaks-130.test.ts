import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #130: what a person was shown and where their paper lives never reach a log line, an audit payload, a response error, or a
 * summary that an export could carry. A failing record or withdrawal is driven through the real routes, the real logger and the
 * real repository, with a synthetic marker in the shown wording and in the paper location, and a database error that echoes
 * the marker the way a Prisma error echoes its query. Synthetic data only.
 */
vi.mock("server-only", () => ({}));

const MARKER = "LEAK-MARKER-7391";

const state = vi.hoisted(() => ({
  evidence: [] as Array<Record<string, unknown>>,
  withdrawals: [] as Array<Record<string, unknown>>,
  audits: [] as unknown[],
  failWrites: false,
  failure: null as unknown,
  registration: null as Record<string, unknown> | null,
}));

vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn(async (entry: unknown) => { state.audits.push(entry); }) }));
vi.mock("@/modules/guardian-authority/repository", () => ({ findActiveDeclaredAuthority: vi.fn(async () => null) }));
vi.mock("@/modules/consent/repository", () => ({ ConsentPolicyError: class extends Error {}, getPolicyVersionForEvidence: vi.fn(), getPolicyVersionEffectiveAt: vi.fn() }));
vi.mock("@/modules/consent/domain", () => ({ PolicyKindMismatchError: class extends Error {} }));
vi.mock("@/modules/access/authorization", () => ({
  requirePermission: vi.fn(async () => ({ user: { id: "staff-1" } })),
  AccessDeniedError: class extends Error {},
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn(async () => ({ user: { id: "staff-1" } })) }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: vi.fn(() => null) }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));

function fakeTx() {
  const joined = (row: Record<string, unknown>) => ({ ...row, withdrawal: state.withdrawals.find((withdrawal) => withdrawal.evidenceId === row.id) ?? null });
  return {
    $executeRaw: vi.fn(async () => 0),
    registration: { findFirst: vi.fn(async () => state.registration) },
    acknowledgmentEvidence: {
      findUnique: vi.fn(async ({ where }: { where: { eventId_idempotencyKey?: { idempotencyKey: string } } }) => {
        const found = state.evidence.find((row) => row.idempotencyKey === where.eventId_idempotencyKey?.idempotencyKey);
        return found ? joined(found) : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => joined(state.evidence.find((row) => row.id === where.id)!)),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = where.id
          ? state.evidence.find((row) => row.id === where.id)
          : state.evidence.find((row) => row.fieldKey === where.fieldKey && row.contentRef === where.contentRef);
        return found ? joined(found) : null;
      }),
      findMany: vi.fn(async () => state.evidence.map(joined)),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        if (state.failWrites) throw state.failure;
        state.evidence.push(...data.map((row) => ({ ...row, recordedAt: new Date("2027-01-02T00:00:00Z") })));
        return { count: data.length };
      }),
    },
    acknowledgmentWithdrawal: {
      findUnique: vi.fn(async () => null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => state.withdrawals.find((row) => row.id === where.id)!),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        if (state.failWrites) throw state.failure;
        state.withdrawals.push(...data.map((row) => ({ ...row, recordedAt: new Date("2027-01-03T00:00:00Z") })));
        return { count: data.length };
      }),
    },
  };
}

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx()),
    registration: { findFirst: async () => state.registration },
    acknowledgmentEvidence: { findMany: async () => state.evidence.map((row) => ({ ...row, withdrawal: state.withdrawals.find((withdrawal) => withdrawal.evidenceId === row.id) ?? null })) },
    consentPolicyVersion: { findUnique: async () => null, count: async () => 0 },
  }),
}));

import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { listRegistrationAcknowledgments } from "@/modules/acknowledgments/repository";
import { POST as record } from "@/app/api/events/[eventId]/registrations/[registrationId]/acknowledgments/route";
import { POST as withdraw } from "@/app/api/events/[eventId]/registrations/[registrationId]/acknowledgments/[evidenceId]/withdraw/route";

const definition = registrationFormDefinitionSchema.parse({
  title: "Synthetic form",
  confirmationMessage: "Received.",
  attendeeRoster: { enabled: false, minAttendees: 1, maxAttendees: 5 },
  sections: [{
    id: "sec_one", title: "Everything", description: "", fields: [
      { id: "f_reg", key: "reg_ack", label: "Registration acknowledgment", type: "ACKNOWLEDGMENT", scope: "REGISTRATION", required: true, options: [], acknowledgment: { source: "TEXT", text: `Shown wording ${MARKER}` } },
    ],
  }],
});

const params = Promise.resolve({ eventId: "event-1", registrationId: "reg-1" });
const post = (body: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const LOCATION = `Binder ${MARKER}`;
const prismaFailure = () => new Prisma.PrismaClientKnownRequestError(`Invalid \`createMany()\` shownText: Shown wording ${MARKER} paperLocation: ${LOCATION}`, { code: "P2010", clientVersion: "test" });

let output: string[] = [];

beforeEach(() => {
  state.evidence.length = 0;
  state.withdrawals.length = 0;
  state.audits.length = 0;
  state.failWrites = false;
  state.failure = prismaFailure();
  state.registration = {
    id: "reg-1", status: "CONFIRMED", accountHolderPersonId: "p-dan",
    event: { startsAt: new Date("2027-03-05T15:00:00Z"), timezone: "America/Chicago", ageOfMajority: 18 },
    publicFormSubmission: { formVersionId: "form-v1", responses: { reg_ack: true }, formVersion: { definition } },
    attendees: [],
  };
  output = [];
  const capture = (...parts: unknown[]) => { output.push(parts.map(String).join(" ")); };
  for (const method of ["error", "warn", "log", "info", "debug"] as const) vi.spyOn(console, method).mockImplementation(capture);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => { output.push(String(chunk)); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { output.push(String(chunk)); return true; });
});

afterEach(() => vi.restoreAllMocks());

const withdrawBody = { channel: "PAPER", paperLocation: LOCATION };
const body = { fieldKey: "reg_ack", channel: "PAPER", paperLocation: LOCATION, clientRequestId: "00000000-0000-4000-8000-000000000130" };

describe("a failing record or withdrawal leaks nothing (#130)", () => {
  it.each([["acknowledge", {}], ["decline", { action: "DECLINE" }]])("keeps the marker out of every output when recording a %s fails", async (_label, extra) => {
    state.failWrites = true;
    const response = await record(post({ ...body, ...extra }), { params });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(MARKER);
    // The failure was logged (so the redaction path really ran), and none of it carries the marker.
    expect(output.length).toBeGreaterThan(0);
    expect(output.join("\n")).not.toContain(MARKER);
    expect(output.join("\n")).toContain("Acknowledgment request failed");
    expect(JSON.stringify(state.audits)).not.toContain(MARKER);
    expect(state.evidence).toHaveLength(0);
  });

  it("keeps the marker out of every output when a withdrawal fails", async () => {
    const recorded = await record(post(body), { params });
    expect(recorded.status).toBe(201);
    const evidenceId = (await recorded.json()).evidence.id as string;
    output.length = 0;
    state.failWrites = true;
    const response = await withdraw(post({ ...withdrawBody, clientRequestId: "00000000-0000-4000-8000-000000000131" }), { params: Promise.resolve({ eventId: "event-1", registrationId: "reg-1", evidenceId }) });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(MARKER);
    expect(output.join("\n")).toContain("Acknowledgment request failed");
    expect(output.join("\n")).not.toContain(MARKER);
    expect(JSON.stringify(state.audits)).not.toContain(MARKER);
    expect(state.withdrawals).toHaveLength(0);
  });

  it("keeps the marker out of refusals, too: a validation error echoes no submitted value", async () => {
    const response = await record(post({ ...body, paperLocation: `${MARKER}${"x".repeat(250)}` }), { params });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain(MARKER);
    expect(output.join("\n")).not.toContain(MARKER);
  });
});

describe("a successful record and withdrawal keep the wording and location out of audit, summaries and exports (#130)", () => {
  it("writes audit entries and summaries with ids and flags only, and the data an export reads has no marker", async () => {
    const recorded = await record(post(body), { params });
    const evidenceId = (await recorded.json()).evidence.id as string;
    const withdrawn = await withdraw(post({ ...withdrawBody, clientRequestId: "00000000-0000-4000-8000-000000000132" }), { params: Promise.resolve({ eventId: "event-1", registrationId: "reg-1", evidenceId }) });
    expect(withdrawn.status).toBe(201);
    expect(state.audits).toHaveLength(2);
    expect(JSON.stringify(state.audits)).not.toContain(MARKER);
    expect(JSON.stringify(await withdrawn.json())).not.toContain(MARKER);
    const views = await listRegistrationAcknowledgments("event-1", "reg-1", new Date("2027-06-01T00:00:00Z"));
    expect(JSON.stringify(views)).not.toContain(MARKER);
    expect(views![0]!.status).toBe("WITHDRAWN");
    // The one place the location is kept is the evidence and withdrawal rows themselves.
    expect(state.evidence[0]!.paperLocation).toBe(LOCATION);
    expect(state.withdrawals[0]!.paperLocation).toBe(LOCATION);
    expect(output.join("\n")).not.toContain(MARKER);
  });
});
