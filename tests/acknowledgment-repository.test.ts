import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #150: recording and reading acknowledgment evidence, against an in-memory stand-in for the few Prisma calls the
 * repository makes. The stand-in knows the two unique rules the database enforces (one row per idempotency key, one row
 * per subject, field and content) so a retry that wrote a second row would fail here. The real database guarantees
 * (append-only trigger, RESTRICT references, check constraints) are proved by scripts/verify-acknowledgments.ts.
 * Synthetic data and wording only.
 */
vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

const { FakeConsentPolicyError, FakePolicyKindMismatchError } = vi.hoisted(() => ({
  FakeConsentPolicyError: class FakeConsentPolicyError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
  FakePolicyKindMismatchError: class FakePolicyKindMismatchError extends Error {},
}));

const state = vi.hoisted(() => ({
  evidence: [] as Row[],
  audits: [] as Row[],
  clock: 0,
  /** Published policy versions the consent module would find, by id. */
  versions: new Map<string, { id: string; versionNumber: number; policyId: string; contentHash: string; title: string; bodyText: string; kind: string; effectiveFrom: Date; effectiveTo: Date | null; isMaterialChange: boolean }>(),
  /** The declared responsible adult per minor person id (what the guardian module's read returns). */
  authority: new Map<string, { id: string; adultPersonId: string }>(),
  authorityLookups: [] as string[],
  registration: null as Row | null,
  persons: new Set<string>(["p-dan", "p-sam", "p-ulf", "p-mum", "p-stranger"]),
}));

const consent = vi.hoisted(() => ({
  getPolicyVersionForEvidence: vi.fn(),
  getPolicyVersionEffectiveAt: vi.fn(),
}));

vi.mock("@/modules/consent/repository", () => ({
  ConsentPolicyError: FakeConsentPolicyError,
  getPolicyVersionForEvidence: consent.getPolicyVersionForEvidence,
  getPolicyVersionEffectiveAt: consent.getPolicyVersionEffectiveAt,
}));
vi.mock("@/modules/consent/domain", () => ({ PolicyKindMismatchError: FakePolicyKindMismatchError }));
vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: vi.fn(async (entry: Row) => { state.audits.push(entry); }),
}));
vi.mock("@/modules/guardian-authority/repository", () => ({
  findActiveDeclaredAuthority: vi.fn(async (_client: unknown, _eventId: string, minorPersonId: string) => {
    state.authorityLookups.push(minorPersonId);
    return state.authority.get(minorPersonId) ?? null;
  }),
}));

function naturalKey(row: Row) {
  return `${row.registrationId}|${row.registrationAttendeeId ?? ""}|${row.fieldKey}|${row.contentRef}`;
}

function fakeTx() {
  return {
    acknowledgmentEvidence: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const key = where.eventId_idempotencyKey as { eventId: string; idempotencyKey: string } | undefined;
        if (key) return state.evidence.find((row) => row.eventId === key.eventId && row.idempotencyKey === key.idempotencyKey) ?? null;
        return state.evidence.find((row) => row.id === where.id) ?? null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: Row }) => {
        const found = state.evidence.find((row) => row.id === where.id);
        if (!found) throw new Error("not found");
        return found;
      }),
      findFirst: vi.fn(async ({ where }: { where: Row }) => state.evidence.find((row) => (
        row.registrationId === where.registrationId
        && (row.registrationAttendeeId ?? null) === (where.registrationAttendeeId ?? null)
        && row.fieldKey === where.fieldKey
        && row.contentRef === where.contentRef
      )) ?? null),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        let count = 0;
        for (const row of data) {
          const duplicate = state.evidence.some((existing) => (
            (existing.eventId === row.eventId && existing.idempotencyKey === row.idempotencyKey) || naturalKey(existing) === naturalKey(row)
          ));
          if (duplicate) continue;
          state.clock += 1;
          state.evidence.push({ ...row, recordedAt: new Date(Date.UTC(2027, 0, 1, 0, 0, state.clock)) });
          count += 1;
        }
        return { count };
      }),
    },
    registration: { findFirst: vi.fn(async () => state.registration) },
    person: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (state.persons.has(where.id) ? { id: where.id } : null)) },
  };
}

const prismaStand = vi.hoisted(() => ({ tx: null as unknown, registrationLookups: 0 }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaStand.tx),
    registration: { findFirst: async () => state.registration },
    acknowledgmentEvidence: {
      findMany: async () => [...state.evidence].sort((a, b) => (a.acknowledgedAt as Date).getTime() - (b.acknowledgedAt as Date).getTime()),
      findFirst: async ({ where }: { where: Row }) => state.evidence.find((row) => row.id === where.id && row.eventId === where.eventId && row.registrationId === where.registrationId) ?? null,
    },
    consentPolicyVersion: {
      findUnique: async ({ where }: { where: { id: string } }) => state.versions.get(where.id) ?? null,
      count: async ({ where }: { where: { policyId: string; versionNumber: { gt: number; lte: number }; effectiveFrom: { lte: Date } } }) => (
        [...state.versions.values()].filter((version) => (
          version.policyId === where.policyId
          && version.versionNumber > where.versionNumber.gt && version.versionNumber <= where.versionNumber.lte
          && version.effectiveFrom <= where.effectiveFrom.lte && version.isMaterialChange
        )).length
      ),
    },
  }),
}));

import { registrationFormDefinitionSchema, type RegistrationFormField } from "@/modules/forms/definition";
import {
  AcknowledgmentError,
  assertAcknowledgmentPoliciesAvailable,
  getAcknowledgmentEvidencePayload,
  listRegistrationAcknowledgments,
  recordAcknowledgmentEvidence,
  recordStaffAcknowledgment,
  recordSubmissionAcknowledgments,
  type RecordRequest,
} from "@/modules/acknowledgments/repository";

const WORDING = "Synthetic acknowledgment wording.\nSecond line.";
const BODY_V1 = "Synthetic policy body, version one.";

const definition = registrationFormDefinitionSchema.parse({
  title: "Synthetic acknowledgment form",
  confirmationMessage: "Received.",
  attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 5 },
  sections: [{
    id: "sec_one", title: "Everything", description: "", fields: [
      { id: "f_first", key: "first_name", label: "First name", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
      { id: "f_last", key: "last_name", label: "Last name", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
      { id: "f_program", key: "wants_program", label: "Program?", type: "RADIO", scope: "REGISTRATION", required: false, options: ["Yes", "No"] },
      { id: "f_activity", key: "attending_activity", label: "Activity?", type: "RADIO", scope: "ATTENDEE", required: false, options: ["Yes", "No"] },
      { id: "f_reg", key: "reg_ack", label: "Registration acknowledgment", type: "ACKNOWLEDGMENT", scope: "REGISTRATION", required: true, options: [], acknowledgment: { source: "TEXT", text: WORDING } },
      { id: "f_program_ack", key: "program_ack", label: "Program acknowledgment", type: "ACKNOWLEDGMENT", scope: "REGISTRATION", required: false, options: [], conditional: { fieldKey: "wants_program", operator: "EQUALS", value: "Yes" }, acknowledgment: { source: "TEXT", text: WORDING } },
      { id: "f_att", key: "att_ack", label: "Attendee acknowledgment", type: "ACKNOWLEDGMENT", scope: "ATTENDEE", required: false, options: [], acknowledgment: { source: "POLICY_VERSION", policyVersionId: "version-1" } },
      { id: "f_att_cond", key: "att_cond_ack", label: "Conditional attendee acknowledgment", type: "ACKNOWLEDGMENT", scope: "ATTENDEE", required: false, options: [], conditional: { fieldKey: "attending_activity", operator: "EQUALS", value: "Yes" }, acknowledgment: { source: "TEXT", text: WORDING } },
    ],
  }],
});
const field = (key: string) => definition.sections[0]!.fields.find((candidate) => candidate.key === key) as RegistrationFormField;

function addVersion(options: { id: string; versionNumber: number; effectiveFrom: Date; effectiveTo?: Date | null; isMaterialChange?: boolean; kind?: string }) {
  state.versions.set(options.id, {
    id: options.id, versionNumber: options.versionNumber, policyId: "policy-1", contentHash: `hash-${options.id}`, title: `Synthetic title v${options.versionNumber}`,
    bodyText: options.versionNumber === 1 ? BODY_V1 : `Synthetic policy body, version ${options.versionNumber}.`, kind: options.kind ?? "ACKNOWLEDGMENT",
    effectiveFrom: options.effectiveFrom, effectiveTo: options.effectiveTo ?? null, isMaterialChange: options.isMaterialChange ?? false,
  });
}

function request(overrides: Partial<RecordRequest> = {}): RecordRequest {
  return {
    eventId: "event-1", registrationId: "reg-1", formVersionId: "form-v1", field: field("reg_ack"), attendee: null, actedByPersonId: "p-dan",
    channel: "ONLINE", recordedByUserId: null, acknowledgedAt: new Date("2027-01-01T12:00:00Z"), idempotencyKey: "key-1", ...overrides,
  };
}

const run = <T>(callback: (tx: ReturnType<typeof fakeTx>) => Promise<T>) => callback(prismaStand.tx as ReturnType<typeof fakeTx>);
const asTx = (tx: ReturnType<typeof fakeTx>) => tx as unknown as Parameters<typeof recordAcknowledgmentEvidence>[0];

async function failure(promise: Promise<unknown>) {
  return promise.then(() => null, (error: unknown) => error);
}

beforeEach(() => {
  state.evidence.length = 0;
  state.audits.length = 0;
  state.clock = 0;
  state.versions.clear();
  state.authority.clear();
  state.authorityLookups.length = 0;
  prismaStand.tx = fakeTx();
  addVersion({ id: "version-1", versionNumber: 1, effectiveFrom: new Date("2026-01-01T00:00:00Z") });
  consent.getPolicyVersionForEvidence.mockReset();
  consent.getPolicyVersionEffectiveAt.mockReset();
  consent.getPolicyVersionForEvidence.mockImplementation(async (eventId: string, versionId: string, kind?: string) => {
    const version = state.versions.get(versionId);
    if (!version || eventId === "other-event") throw new FakeConsentPolicyError("VERSION_NOT_FOUND", "not found");
    if (kind && version.kind !== kind) throw new FakePolicyKindMismatchError("wrong kind");
    return { ...version, policy: { id: version.policyId, kind: version.kind } };
  });
  consent.getPolicyVersionEffectiveAt.mockImplementation(async (_eventId: string, policyId: string, at: Date) => {
    const effective = [...state.versions.values()]
      .filter((version) => version.policyId === policyId && version.effectiveFrom <= at && (version.effectiveTo === null || at < version.effectiveTo))
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
    return effective ? { ...effective } : null;
  });
  state.registration = null;
});

describe("recording evidence (#150)", () => {
  it("records the exact text shown, who gave it, the channel and the moment", async () => {
    const outcome = await run((tx) => recordAcknowledgmentEvidence(asTx(tx), request({ requestMetadata: { userAgentHash: "ua-hash", ipAddress: "203.0.113.9", formVersionId: "form-v1" } })));
    expect(outcome).toMatchObject({ created: true, replayed: false });
    const [stored] = state.evidence;
    expect(stored).toMatchObject({
      eventId: "event-1", registrationId: "reg-1", registrationAttendeeId: null, subjectPersonId: null, actedByPersonId: "p-dan", channel: "ONLINE", recordedByUserId: null,
      fieldKey: "reg_ack", source: "TEXT", shownText: WORDING, policyVersionId: null, subjectMinorStatus: "ADULT", guardianAuthorityId: null,
    });
    expect(stored!.acknowledgedAt).toEqual(new Date("2027-01-01T12:00:00Z"));
    expect(stored!.contentRef).toBe(`text:${stored!.contentHash}`);
    // Only approved request metadata is stored: the address is dropped.
    expect(stored!.requestMetadata).toEqual({ userAgentHash: "ua-hash", formVersionId: "form-v1" });
    // The summary that leaves the repository carries no payload.
    expect(JSON.stringify(outcome.evidence)).not.toContain("Synthetic acknowledgment wording");
    expect(Object.keys(outcome.evidence)).not.toContain("shownText");
  });

  it("references a published policy version by id and stores no text", async () => {
    const outcome = await run((tx) => recordAcknowledgmentEvidence(asTx(tx), request({
      field: field("att_ack"), attendee: { attendeeId: "att-dan", personId: "p-dan", status: "ADULT" },
    })));
    expect(consent.getPolicyVersionForEvidence).toHaveBeenCalledWith("event-1", "version-1", "ACKNOWLEDGMENT");
    expect(state.evidence[0]).toMatchObject({ source: "POLICY_VERSION", policyVersionId: "version-1", shownText: null, contentHash: "hash-version-1", contentRef: "policy:version-1" });
    expect(outcome.evidence.policyVersionId).toBe("version-1");
  });

  it.each([
    ["another event's version", "version-1", "other-event"],
    ["a version that does not exist", "missing-version", "event-1"],
  ])("refuses %s and writes nothing", async (_label, versionId, eventId) => {
    const error = await failure(run((tx) => recordAcknowledgmentEvidence(asTx(tx), request({
      eventId, field: { ...field("att_ack"), acknowledgment: { source: "POLICY_VERSION", policyVersionId: versionId } }, attendee: { attendeeId: "att-dan", personId: "p-dan", status: "ADULT" },
    }))));
    expect(error).toBeInstanceOf(AcknowledgmentError);
    expect((error as AcknowledgmentError).code).toBe("POLICY_VERSION_UNAVAILABLE");
    expect(state.evidence).toHaveLength(0);
  });

  it("refuses a policy of another kind: a waiver never stands in for an acknowledgment", async () => {
    addVersion({ id: "waiver-1", versionNumber: 1, effectiveFrom: new Date("2026-01-01T00:00:00Z"), kind: "WAIVER" });
    const error = await failure(run((tx) => recordAcknowledgmentEvidence(asTx(tx), request({
      field: { ...field("att_ack"), acknowledgment: { source: "POLICY_VERSION", policyVersionId: "waiver-1" } }, attendee: { attendeeId: "att-dan", personId: "p-dan", status: "ADULT" },
    }))));
    expect((error as AcknowledgmentError).code).toBe("POLICY_VERSION_UNAVAILABLE");
    expect(state.evidence).toHaveLength(0);
  });

  it("checks every policy reference on a definition for the builder, and passes a good one", async () => {
    await expect(assertAcknowledgmentPoliciesAvailable("event-1", definition)).resolves.toBeUndefined();
    const broken = { ...definition, sections: [{ ...definition.sections[0]!, fields: [{ ...field("att_ack"), acknowledgment: { source: "POLICY_VERSION" as const, policyVersionId: "missing-version" } }] }] };
    const error = await failure(assertAcknowledgmentPoliciesAvailable("event-1", broken));
    expect((error as AcknowledgmentError).code).toBe("POLICY_VERSION_UNAVAILABLE");
    expect((error as AcknowledgmentError).message).toContain("Attendee acknowledgment");
    // A text acknowledgment never touches the policy module.
    consent.getPolicyVersionForEvidence.mockClear();
    await assertAcknowledgmentPoliciesAvailable("event-1", { ...definition, sections: [{ ...definition.sections[0]!, fields: [field("reg_ack")] }] });
    expect(consent.getPolicyVersionForEvidence).not.toHaveBeenCalled();
  });

  it("refuses a field that is not an acknowledgment", async () => {
    const error = await failure(run((tx) => recordAcknowledgmentEvidence(asTx(tx), request({ field: field("first_name") }))));
    expect((error as AcknowledgmentError).code).toBe("FIELD_NOT_FOUND");
  });

  it("writes one audit entry per row with ids and flags only", async () => {
    await run((tx) => recordAcknowledgmentEvidence(asTx(tx), request({ requestMetadata: { userAgentHash: "ua-hash" } })));
    expect(state.audits).toHaveLength(1);
    const entry = state.audits[0]!;
    expect(entry).toMatchObject({ eventId: "event-1", action: "ACKNOWLEDGMENT_RECORDED", entityType: "AcknowledgmentEvidence" });
    const text = JSON.stringify(entry);
    expect(text).not.toContain("Synthetic acknowledgment wording");
    expect(text).not.toContain("Registration acknowledgment");
    expect(text).not.toContain("ua-hash");
  });
});

describe("retries are safe (#150)", () => {
  it("replays the first result under the same request key and writes nothing more", async () => {
    const first = await run((tx) => recordAcknowledgmentEvidence(asTx(tx), request()));
    const again = await run((tx) => recordAcknowledgmentEvidence(asTx(tx), request({ acknowledgedAt: new Date("2027-02-02T00:00:00Z") })));
    expect(again).toMatchObject({ created: false, replayed: true });
    expect(again.evidence.id).toBe(first.evidence.id);
    expect(again.evidence.acknowledgedAt).toBe(first.evidence.acknowledgedAt);
    expect(state.evidence).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
  });

  it("still replays after the authority behind a minor's acknowledgment was revoked", async () => {
    state.authority.set("p-sam", { id: "auth-1", adultPersonId: "p-dan" });
    const minor = request({ field: field("att_ack"), attendee: { attendeeId: "att-sam", personId: "p-sam", status: "MINOR" } });
    const first = await run((tx) => recordAcknowledgmentEvidence(asTx(tx), minor));
    state.authority.clear();
    const again = await run((tx) => recordAcknowledgmentEvidence(asTx(tx), minor));
    expect(again).toMatchObject({ created: false, replayed: true });
    expect(again.evidence.id).toBe(first.evidence.id);
  });

  it("returns the row already on file when the same content is recorded again under a new key", async () => {
    const first = await run((tx) => recordAcknowledgmentEvidence(asTx(tx), request()));
    const second = await run((tx) => recordAcknowledgmentEvidence(asTx(tx), request({ idempotencyKey: "key-2", channel: "STAFF_ENTERED", recordedByUserId: "staff-1" })));
    expect(second).toMatchObject({ created: false, replayed: false });
    expect(second.evidence.id).toBe(first.evidence.id);
    expect(second.evidence.channel).toBe("ONLINE");
    expect(state.evidence).toHaveLength(1);
  });

  it("refuses one request key reused for a different request", async () => {
    await run((tx) => recordAcknowledgmentEvidence(asTx(tx), request()));
    const error = await failure(run((tx) => recordAcknowledgmentEvidence(asTx(tx), request({ channel: "PAPER", recordedByUserId: "staff-1" }))));
    expect((error as AcknowledgmentError).code).toBe("IDEMPOTENCY_CONFLICT");
    expect(state.evidence).toHaveLength(1);
  });

  it("keeps different content as a new appended row: evidence is never overwritten", async () => {
    await run((tx) => recordAcknowledgmentEvidence(asTx(tx), request({ field: field("att_ack"), attendee: { attendeeId: "att-dan", personId: "p-dan", status: "ADULT" } })));
    addVersion({ id: "version-2", versionNumber: 2, effectiveFrom: new Date("2026-06-01T00:00:00Z") });
    await run((tx) => recordAcknowledgmentEvidence(asTx(tx), request({
      idempotencyKey: "key-2", field: { ...field("att_ack"), acknowledgment: { source: "POLICY_VERSION", policyVersionId: "version-2" } },
      attendee: { attendeeId: "att-dan", personId: "p-dan", status: "ADULT" },
    })));
    expect(state.evidence.map((row) => row.contentRef)).toEqual(["policy:version-1", "policy:version-2"]);
  });
});

describe("acting for a minor needs declared authority (#131)", () => {
  const minorRequest = (overrides: Partial<RecordRequest> = {}) => request({
    field: field("att_ack"), attendee: { attendeeId: "att-sam", personId: "p-sam", status: "MINOR" }, ...overrides,
  });

  it("accepts the declared responsible adult and records the authority that allowed it", async () => {
    state.authority.set("p-sam", { id: "auth-1", adultPersonId: "p-dan" });
    const outcome = await run((tx) => recordAcknowledgmentEvidence(asTx(tx), minorRequest()));
    expect(outcome.evidence).toMatchObject({ subjectPersonId: "p-sam", actedByPersonId: "p-dan", subjectMinorStatus: "MINOR", guardianAuthorityId: "auth-1" });
    expect(state.authorityLookups).toEqual(["p-sam"]);
  });

  it.each([
    ["an adult who was not declared (the account holder, a household member)", { id: "auth-1", adultPersonId: "p-mum" }],
    ["nobody declared (None of us, revoked, or stale)", null],
  ])("refuses %s", async (_label, declared) => {
    if (declared) state.authority.set("p-sam", declared);
    const error = await failure(run((tx) => recordAcknowledgmentEvidence(asTx(tx), minorRequest())));
    expect((error as AcknowledgmentError).code).toBe("ACTING_FOR_MINOR_NOT_AUTHORIZED");
    expect(state.evidence).toHaveLength(0);
  });

  it("refuses the minor's own tick even when an adult is declared", async () => {
    state.authority.set("p-sam", { id: "auth-1", adultPersonId: "p-dan" });
    const error = await failure(run((tx) => recordAcknowledgmentEvidence(asTx(tx), minorRequest({ actedByPersonId: "p-sam" }))));
    expect((error as AcknowledgmentError).code).toBe("ACTING_FOR_MINOR_NOT_AUTHORIZED");
  });

  it("refuses acknowledging for another adult and never asks for authority for an adult", async () => {
    const error = await failure(run((tx) => recordAcknowledgmentEvidence(asTx(tx), request({
      field: field("att_ack"), attendee: { attendeeId: "att-ulf", personId: "p-ulf", status: "ADULT" }, actedByPersonId: "p-dan",
    }))));
    expect((error as AcknowledgmentError).code).toBe("ACTING_FOR_ANOTHER_NOT_AUTHORIZED");
    expect(state.authorityLookups).toEqual([]);
    expect(state.evidence).toHaveLength(0);
  });
});

describe("a registration form submission (#150)", () => {
  const input = (overrides: Partial<Parameters<typeof recordSubmissionAcknowledgments>[1]> = {}): Parameters<typeof recordSubmissionAcknowledgments>[1] => ({
    eventId: "event-1", registrationId: "reg-1", formVersionId: "form-v1", definition,
    registrationResponses: { wants_program: "Yes", reg_ack: true, program_ack: true },
    attendees: [
      { clientId: "a-dan", attendeeId: "att-dan", personId: "p-dan", responses: { first_name: "Dan", attending_activity: "Yes", att_ack: true, att_cond_ack: true } },
      { clientId: "a-sam", attendeeId: "att-sam", personId: "p-sam", responses: { first_name: "Sam", attendee_age: "12", att_ack: true } },
      { clientId: "a-ulf", attendeeId: "att-ulf", personId: "p-ulf", responses: { first_name: "Ulf", attending_activity: "No", att_cond_ack: true } },
    ],
    actedByPersonId: "p-dan", channel: "ONLINE", recordedByUserId: null, submissionKey: "sub-1", acknowledgedAt: new Date("2027-01-01T12:00:00Z"),
    requestMetadata: { userAgentHash: "ua", submissionKey: "sub-1" }, event: { startsAt: new Date("2027-03-05T15:00:00Z"), timezone: "America/Chicago", ageOfMajority: 18 },
    ...overrides,
  });

  it("records registration, visible conditional and repeating attendee acknowledgments, and skips hidden or unticked ones", async () => {
    state.authority.set("p-sam", { id: "auth-1", adultPersonId: "p-dan" });
    const result = await run((tx) => recordSubmissionAcknowledgments(asTx(tx), input()));
    expect(result).toEqual({ planned: 5, recorded: 5 });
    expect(state.evidence.map((row) => `${row.fieldKey}:${(row.registrationAttendeeId as string | null) ?? "registration"}`).sort()).toEqual([
      "att_ack:att-dan", "att_ack:att-sam", "att_cond_ack:att-dan", "program_ack:registration", "reg_ack:registration",
    ]);
    // Ulf's activity is "No": his conditional acknowledgment recorded nothing even though it was sent.
    expect(state.evidence.some((row) => row.registrationAttendeeId === "att-ulf")).toBe(false);
    const sam = state.evidence.find((row) => row.registrationAttendeeId === "att-sam")!;
    expect(sam).toMatchObject({ subjectMinorStatus: "MINOR", guardianAuthorityId: "auth-1", actedByPersonId: "p-dan" });
  });

  it("is retry-safe: a second pass under the same submission key creates nothing", async () => {
    state.authority.set("p-sam", { id: "auth-1", adultPersonId: "p-dan" });
    await run((tx) => recordSubmissionAcknowledgments(asTx(tx), input()));
    const second = await run((tx) => recordSubmissionAcknowledgments(asTx(tx), input()));
    expect(second.recorded).toBe(0);
    expect(state.evidence).toHaveLength(5);
  });

  it("collects every refusal and throws them together so the form can mark each field", async () => {
    // Nobody is declared for Sam, and Ulf is another adult.
    const error = await failure(run((tx) => recordSubmissionAcknowledgments(asTx(tx), input({
      attendees: [
        { clientId: "a-dan", attendeeId: "att-dan", personId: "p-dan", responses: { first_name: "Dan", att_ack: true } },
        { clientId: "a-sam", attendeeId: "att-sam", personId: "p-sam", responses: { first_name: "Sam", attendee_age: "12", att_ack: true } },
        { clientId: "a-ulf", attendeeId: "att-ulf", personId: "p-ulf", responses: { first_name: "Ulf", att_ack: true } },
      ],
    }))));
    expect(error).toBeInstanceOf(AcknowledgmentError);
    const refused = error as AcknowledgmentError;
    expect(refused.code).toBe("ACKNOWLEDGMENT_REFUSED");
    expect(refused.refusals.map((refusal) => `${refusal.attendeeClientId}:${refusal.code}`).sort()).toEqual([
      "a-sam:ACTING_FOR_MINOR_NOT_AUTHORIZED",
      "a-ulf:ACTING_FOR_ANOTHER_NOT_AUTHORIZED",
    ]);
    expect(refused.refusals.every((refusal) => refusal.key === "att_ack" && refusal.fieldId === "f_att")).toBe(true);
  });

  it("records a staff-submitted form as staff-entered, naming the staff member", async () => {
    await run((tx) => recordSubmissionAcknowledgments(asTx(tx), input({
      registrationResponses: { reg_ack: true }, attendees: [], channel: "STAFF_ENTERED", recordedByUserId: "staff-1",
    })));
    expect(state.evidence[0]).toMatchObject({ channel: "STAFF_ENTERED", recordedByUserId: "staff-1" });
  });
});

describe("staff-entered and paper evidence (#150)", () => {
  function seedRegistration(overrides: Row = {}) {
    state.registration = {
      id: "reg-1", status: "CONFIRMED", accountHolderPersonId: "p-dan",
      event: { startsAt: new Date("2027-03-05T15:00:00Z"), timezone: "America/Chicago", ageOfMajority: 18 },
      publicFormSubmission: { formVersionId: "form-v1", responses: { wants_program: "No", reg_ack: true }, formVersion: { definition } },
      attendees: [
        { id: "att-dan", personId: "p-dan", formResponses: { first_name: "Dan", attendee_age: "44", attending_activity: "Yes" }, profileSnapshot: { firstName: "Dan", lastName: "Sample" } },
        { id: "att-sam", personId: "p-sam", formResponses: { first_name: "Sam", attendee_age: "12" }, profileSnapshot: { firstName: "Sam", lastName: "Sample" } },
        { id: "att-ulf", personId: "p-ulf", formResponses: { first_name: "Ulf", attendee_age: "40" }, profileSnapshot: { firstName: "Ulf", lastName: "Sample" } },
      ],
      ...overrides,
    };
  }
  const staff = (overrides: Partial<Parameters<typeof recordStaffAcknowledgment>[0]> = {}) => recordStaffAcknowledgment({
    eventId: "event-1", registrationId: "reg-1", fieldKey: "att_ack", attendeeId: "att-dan", channel: "PAPER", actorUserId: "staff-1", clientRequestId: "req-1", ...overrides,
  }, new Date("2027-01-10T00:00:00Z"));

  beforeEach(() => seedRegistration());

  it("records a paper acknowledgment with the paper's date, the staff member, and the wording of the registration's own form version", async () => {
    const outcome = await staff({ acknowledgedAt: new Date("2027-01-05T00:00:00Z") });
    expect(outcome).toMatchObject({ created: true, replayed: false });
    expect(state.evidence[0]).toMatchObject({
      channel: "PAPER", recordedByUserId: "staff-1", actedByPersonId: "p-dan", subjectPersonId: "p-dan", registrationAttendeeId: "att-dan",
      source: "POLICY_VERSION", policyVersionId: "version-1", formVersionId: "form-v1", fieldKey: "att_ack",
    });
    expect(state.evidence[0]!.acknowledgedAt).toEqual(new Date("2027-01-05T00:00:00Z"));
    expect(state.evidence[0]!.idempotencyKey).toBe("staff:req-1");
    expect((state.evidence[0]!.requestMetadata as Record<string, unknown>).formVersionId).toBe("form-v1");
  });

  it("records a staff-entered registration-level text acknowledgment for the registrant", async () => {
    const outcome = await staff({ fieldKey: "reg_ack", attendeeId: null, channel: "STAFF_ENTERED", clientRequestId: "req-reg" });
    expect(outcome.created).toBe(true);
    expect(state.evidence[0]).toMatchObject({ channel: "STAFF_ENTERED", recordedByUserId: "staff-1", registrationAttendeeId: null, subjectPersonId: null, actedByPersonId: "p-dan", source: "TEXT", shownText: WORDING });
  });

  it("is retry-safe by request id, and the same content under another id returns the row on file", async () => {
    const first = await staff();
    const retry = await staff({ acknowledgedAt: new Date("2027-01-09T00:00:00Z") });
    expect(retry).toMatchObject({ replayed: true, created: false });
    expect(retry.evidence.id).toBe(first.evidence.id);
    const sameContent = await staff({ clientRequestId: "req-2" });
    expect(sameContent).toMatchObject({ replayed: false, created: false });
    expect(sameContent.evidence.id).toBe(first.evidence.id);
    expect(state.evidence).toHaveLength(1);
    expect((await failure(staff({ channel: "STAFF_ENTERED" })) as AcknowledgmentError).code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("refuses a minor unless the person who signed is the declared responsible adult", async () => {
    state.authority.set("p-sam", { id: "auth-1", adultPersonId: "p-dan" });
    for (const actor of [null, "p-ulf", "p-mum", "p-stranger"]) {
      const error = await failure(staff({ attendeeId: "att-sam", actedByPersonId: actor, clientRequestId: `req-${actor}` }));
      expect((error as AcknowledgmentError).code).toBe("ACTING_FOR_MINOR_NOT_AUTHORIZED");
    }
    expect(state.evidence).toHaveLength(0);
    const allowed = await staff({ attendeeId: "att-sam", actedByPersonId: "p-dan", clientRequestId: "req-dad" });
    expect(allowed.evidence).toMatchObject({ actedByPersonId: "p-dan", guardianAuthorityId: "auth-1", subjectMinorStatus: "MINOR" });
  });

  it("refuses staff signing in for another adult", async () => {
    const error = await failure(staff({ attendeeId: "att-ulf", actedByPersonId: "p-dan" }));
    expect((error as AcknowledgmentError).code).toBe("ACTING_FOR_ANOTHER_NOT_AUTHORIZED");
  });

  it.each([
    ["an unknown field", { fieldKey: "no_such_field" }, "FIELD_NOT_FOUND"],
    ["a field that is not an acknowledgment", { fieldKey: "first_name" }, "FIELD_NOT_FOUND"],
    ["an attendee-level field without an attendee", { attendeeId: null }, "ATTENDEE_REQUIRED"],
    ["a registration-level field with an attendee", { fieldKey: "reg_ack", attendeeId: "att-dan" }, "ATTENDEE_NOT_ALLOWED"],
    ["an attendee who is not on the registration", { attendeeId: "att-elsewhere" }, "ATTENDEE_NOT_FOUND"],
    ["a date in the future", { acknowledgedAt: new Date("2027-02-01T00:00:00Z") }, "ACKNOWLEDGED_AT_INVALID"],
    ["a person who does not exist", { actedByPersonId: "p-nobody" }, "ACTOR_NOT_FOUND"],
    ["an attendee conditional that does not apply to the person", { fieldKey: "att_cond_ack", attendeeId: "att-ulf" }, "FIELD_NOT_APPLICABLE"],
    ["a registration conditional that does not apply", { fieldKey: "program_ack", attendeeId: null }, "FIELD_NOT_APPLICABLE"],
  ])("refuses %s", async (_label, overrides, code) => {
    const error = await failure(staff(overrides as Partial<Parameters<typeof recordStaffAcknowledgment>[0]>));
    expect((error as AcknowledgmentError).code).toBe(code);
    expect(state.evidence).toHaveLength(0);
  });

  it("applies a conditional acknowledgment to the person it applies to", async () => {
    const outcome = await staff({ fieldKey: "att_cond_ack", attendeeId: "att-dan" });
    expect(outcome.created).toBe(true);
  });

  it("refuses a registration that is not on the event, not active, or not made through a form", async () => {
    state.registration = null;
    expect(((await failure(staff())) as AcknowledgmentError).code).toBe("REGISTRATION_NOT_FOUND");
    seedRegistration({ status: "CANCELLED" });
    expect(((await failure(staff())) as AcknowledgmentError).code).toBe("REGISTRATION_NOT_ACTIVE");
    seedRegistration({ publicFormSubmission: null });
    expect(((await failure(staff())) as AcknowledgmentError).code).toBe("FORM_VERSION_UNAVAILABLE");
  });
});

describe("historical status resolution (#150)", () => {
  const day = (offset: number) => new Date(Date.UTC(2027, 0, 1 + offset));

  function seedStatusRegistration() {
    state.registration = {
      id: "reg-1",
      publicFormSubmission: { responses: { reg_ack: true }, formVersion: { definition } },
      attendees: [{ id: "att-dan", personId: "p-dan", formResponses: { first_name: "Dan", attending_activity: "No" }, profileSnapshot: { firstName: "Dan", lastName: "Sample" } }],
    };
  }
  function evidenceRow(overrides: Row) {
    state.evidence.push({
      id: `ev-${state.evidence.length + 1}`, eventId: "event-1", registrationId: "reg-1", registrationAttendeeId: "att-dan", subjectPersonId: "p-dan", actedByPersonId: "p-dan", channel: "ONLINE",
      fieldKey: "att_ack", fieldLabel: "Attendee acknowledgment", source: "POLICY_VERSION", policyVersionId: "version-1", contentHash: "hash-version-1", subjectMinorStatus: "ADULT",
      guardianAuthorityId: null, acknowledgedAt: day(10), recordedAt: day(10), shownText: null, requestMetadata: {}, ...overrides,
    });
  }
  const statusAt = async (at: Date, key = "att_ack") => {
    const views = (await listRegistrationAcknowledgments("event-1", "reg-1", at))!;
    return views.find((view) => view.fieldKey === key && view.subject.kind === "ATTENDEE")!.status;
  };

  beforeEach(() => {
    seedStatusRegistration();
    // Version 1 in force from day 0 until day 30; version 2 from day 30.
    state.versions.clear();
    addVersion({ id: "version-1", versionNumber: 1, effectiveFrom: day(0), effectiveTo: day(30), isMaterialChange: true });
  });

  it("is not acknowledged before the evidence existed, and acknowledged while its version was in force", async () => {
    evidenceRow({});
    expect(await statusAt(day(5))).toBe("NOT_ACKNOWLEDGED");
    expect(await statusAt(day(20))).toBe("ACKNOWLEDGED");
  });

  it("asks for a new acknowledgment after a material later version took effect, and only from that moment", async () => {
    evidenceRow({});
    addVersion({ id: "version-2", versionNumber: 2, effectiveFrom: day(30), isMaterialChange: true });
    expect(await statusAt(day(29))).toBe("ACKNOWLEDGED");
    expect(await statusAt(day(31))).toBe("REACKNOWLEDGMENT_REQUIRED");
    // The same question about the past still has the same answer after the later version exists.
    expect(await statusAt(day(20))).toBe("ACKNOWLEDGED");
  });

  it("leaves an earlier acknowledgment standing after a non-material later version", async () => {
    evidenceRow({});
    addVersion({ id: "version-2", versionNumber: 2, effectiveFrom: day(30), isMaterialChange: false });
    expect(await statusAt(day(40))).toBe("ACKNOWLEDGED_EARLIER_VERSION");
  });

  it("is satisfied again by a new acknowledgment of the later version, judged from its own moment", async () => {
    evidenceRow({});
    addVersion({ id: "version-2", versionNumber: 2, effectiveFrom: day(30), isMaterialChange: true });
    evidenceRow({ policyVersionId: "version-2", contentHash: "hash-version-2", acknowledgedAt: day(35) });
    expect(await statusAt(day(32))).toBe("REACKNOWLEDGMENT_REQUIRED");
    expect(await statusAt(day(36))).toBe("ACKNOWLEDGED");
  });

  it("stands for a text acknowledgment whatever happens to any policy", async () => {
    evidenceRow({ fieldKey: "reg_ack", registrationAttendeeId: null, subjectPersonId: null, source: "TEXT", policyVersionId: null, shownText: WORDING, acknowledgedAt: day(10) });
    const views = (await listRegistrationAcknowledgments("event-1", "reg-1", day(500)))!;
    expect(views.find((view) => view.fieldKey === "reg_ack")!.status).toBe("ACKNOWLEDGED");
  });

  it("returns summaries only: no wording, no metadata", async () => {
    evidenceRow({ fieldKey: "reg_ack", registrationAttendeeId: null, subjectPersonId: null, source: "TEXT", policyVersionId: null, shownText: WORDING, requestMetadata: { userAgentHash: "ua-hash" } });
    const views = (await listRegistrationAcknowledgments("event-1", "reg-1", day(20)))!;
    const text = JSON.stringify(views);
    expect(text).not.toContain("Synthetic acknowledgment wording");
    expect(text).not.toContain("ua-hash");
    expect(views.find((view) => view.fieldKey === "reg_ack")!.evidence[0]).not.toHaveProperty("shownText");
  });

  it("reads a registration that is not on the event as not found", async () => {
    state.registration = null;
    expect(await listRegistrationAcknowledgments("event-1", "reg-1")).toBeNull();
  });

  it("reads back the exact version the person saw, though a later one is in force", async () => {
    evidenceRow({});
    addVersion({ id: "version-2", versionNumber: 2, effectiveFrom: day(30), isMaterialChange: true });
    const payload = await getAcknowledgmentEvidencePayload("event-1", "reg-1", "ev-1");
    expect(consent.getPolicyVersionForEvidence).toHaveBeenCalledWith("event-1", "version-1");
    expect(payload.policyVersion).toMatchObject({ id: "version-1", versionNumber: 1, bodyText: BODY_V1 });
    const missing = await failure(getAcknowledgmentEvidencePayload("event-1", "another-registration", "ev-1"));
    expect((missing as AcknowledgmentError).code).toBe("EVIDENCE_NOT_FOUND");
  });

  it("reads the exact text of a text acknowledgment in the payload only", async () => {
    evidenceRow({ fieldKey: "reg_ack", registrationAttendeeId: null, subjectPersonId: null, source: "TEXT", policyVersionId: null, shownText: WORDING, requestMetadata: { userAgentHash: "ua-hash" } });
    const payload = await getAcknowledgmentEvidencePayload("event-1", "reg-1", "ev-1");
    expect(payload).toMatchObject({ shownText: WORDING, policyVersion: null, requestMetadata: { userAgentHash: "ua-hash" } });
  });
});
