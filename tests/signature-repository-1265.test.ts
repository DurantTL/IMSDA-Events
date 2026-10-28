import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  rows: [] as Row[],
  registrationExists: true,
  findManySelects: [] as Array<Record<string, boolean>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    registration: { findFirst: async () => (state.registrationExists ? { id: "reg-1" } : null) },
    signatureEvidence: {
      findMany: async ({ select }: { select: Record<string, boolean> }) => {
        state.findManySelects.push(select);
        return state.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => select[key])));
      },
    },
  }),
}));

import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { hashUserAgent } from "@/modules/access/tokens";
import { listRegistrationSignatures, recordSubmissionSignatures } from "@/modules/signatures/repository";
import { sha256 } from "@/modules/signatures/domain";

const STATEMENT = "Synthetic statement signed in the repository tests.";
const base = { helpText: "", required: false, options: [] as string[] };

const definition = registrationFormDefinitionSchema.parse({
  title: "Synthetic signature form",
  confirmationMessage: "Received.",
  attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 4 },
  sections: [{
    id: "sec", title: "All", description: "", fields: [
      { id: "f_first", key: "first_name", label: "First name", type: "TEXT", scope: "ATTENDEE", ...base, required: true },
      { id: "f_last", key: "last_name", label: "Last name", type: "TEXT", scope: "ATTENDEE", ...base, required: true },
      { id: "f_reg", key: "reg_sig", label: "Registrant signature", type: "SIGNATURE", scope: "REGISTRATION", ...base, signature: { text: STATEMENT } },
      { id: "f_att", key: "att_sig", label: "Attendee signature", type: "SIGNATURE", scope: "ATTENDEE", ...base, signature: { text: STATEMENT } },
    ],
  }],
});

function fakeTx() {
  const stored: Row[] = [];
  return {
    stored,
    tx: {
      signatureEvidence: {
        createMany: vi.fn(async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
          let count = 0;
          for (const row of data) {
            if (stored.some((existing) => existing.eventId === row.eventId && existing.idempotencyKey === row.idempotencyKey)) {
              if (!skipDuplicates) throw new Error("unique violation");
              continue;
            }
            stored.push({ ...row });
            count += 1;
          }
          return { count };
        }),
      },
    },
  };
}

const input = (overrides: Record<string, unknown> = {}) => ({
  eventId: "event-1",
  registrationId: "reg-1",
  formVersionId: "version-1",
  definition,
  registrationResponses: { reg_sig: "  Ann Sample " },
  attendees: [
    { clientId: "c1", attendeeId: "att-1", responses: { first_name: "Ann", last_name: "Sample", att_sig: "Ann Sample" } },
    { clientId: "c2", attendeeId: "att-2", responses: { first_name: "Bob", last_name: "Sample" } },
  ],
  submissionKey: "submission-1",
  signedAt: new Date("2027-03-04T18:30:00.000Z"),
  ...overrides,
});

beforeEach(() => {
  state.rows = [];
  state.registrationExists = true;
  state.findManySelects = [];
});

describe("recording signature evidence with a submission (#1265)", () => {
  it("records name, exact text, hash, moment, IP and hashed user agent", async () => {
    const { tx, stored } = fakeTx();
    const outcome = await recordSubmissionSignatures(tx as never, input({ ipAddress: "203.0.113.9", userAgent: "SyntheticAgent/1.0" }));
    expect(outcome).toEqual({ planned: 2, recorded: 2 });
    const registrationRow = stored.find((row) => row.fieldKey === "reg_sig")!;
    expect(registrationRow).toMatchObject({
      eventId: "event-1", registrationId: "reg-1", registrationAttendeeId: null, formVersionId: "version-1", fieldId: "f_reg",
      fieldLabel: "Registrant signature", signerName: "Ann Sample", signedText: STATEMENT, contentHash: sha256(STATEMENT),
      signedAt: new Date("2027-03-04T18:30:00.000Z"), ipAddress: "203.0.113.9", userAgentHash: hashUserAgent("SyntheticAgent/1.0"),
      idempotencyKey: "submission:submission-1:f_reg:registration",
    });
    expect(JSON.stringify(stored)).not.toContain("SyntheticAgent");
    const attendeeRow = stored.find((row) => row.fieldKey === "att_sig")!;
    expect(attendeeRow).toMatchObject({ registrationAttendeeId: "att-1", idempotencyKey: "submission:submission-1:f_att:c1" });
  });

  it("records a null IP when none could be resolved", async () => {
    const { tx, stored } = fakeTx();
    await recordSubmissionSignatures(tx as never, input());
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => row.ipAddress === null && row.userAgentHash === null)).toBe(true);
    const nulled = fakeTx();
    await recordSubmissionSignatures(nulled.tx as never, input({ ipAddress: null, userAgent: null }));
    expect(nulled.stored.every((row) => row.ipAddress === null)).toBe(true);
  });

  it("writes each signature once when a submission is retried", async () => {
    const { tx, stored } = fakeTx();
    await recordSubmissionSignatures(tx as never, input({ ipAddress: "203.0.113.9" }));
    const again = await recordSubmissionSignatures(tx as never, input({ ipAddress: "203.0.113.10" }));
    expect(again).toEqual({ planned: 2, recorded: 0 });
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => row.ipAddress === "203.0.113.9")).toBe(true);
  });

  it("records nothing, and does not touch the database, when nobody signed", async () => {
    const { tx } = fakeTx();
    const outcome = await recordSubmissionSignatures(tx as never, input({ registrationResponses: { reg_sig: "  " }, attendees: [{ clientId: "c1", attendeeId: "att-1", responses: { first_name: "Ann", last_name: "Sample" } }] }));
    expect(outcome).toEqual({ planned: 0, recorded: 0 });
    expect(tx.signatureEvidence.createMany).not.toHaveBeenCalled();
  });
});

describe("what staff read back", () => {
  const row = { id: "s1", fieldKey: "reg_sig", fieldLabel: "Registrant signature", registrationAttendeeId: null, signerName: "Ann Sample", signedAt: new Date("2027-03-04T18:30:00.000Z"), signedText: STATEMENT, contentHash: sha256(STATEMENT), ipAddress: "203.0.113.9" };

  it("reads the signed text and IP only for a caller with permission", async () => {
    state.rows = [row];
    const full = await listRegistrationSignatures("event-1", "reg-1", true);
    expect(full?.signatures[0]).toMatchObject({ signerName: "Ann Sample", signedText: STATEMENT, ipAddress: "203.0.113.9" });
    expect(state.findManySelects[0]).toMatchObject({ signedText: true, ipAddress: true });
  });

  it("never selects them otherwise, so they cannot leak", async () => {
    state.rows = [row];
    const limited = await listRegistrationSignatures("event-1", "reg-1", false);
    expect(state.findManySelects[0]).not.toHaveProperty("signedText");
    expect(state.findManySelects[0]).not.toHaveProperty("ipAddress");
    expect(limited?.canViewRecord).toBe(false);
    expect(JSON.stringify(limited)).not.toContain("203.0.113.9");
    expect(JSON.stringify(limited)).not.toContain(STATEMENT);
    expect(limited?.signatures[0]).toMatchObject({ signerName: "Ann Sample" });
  });

  it("is null for a registration that is not on the event", async () => {
    state.registrationExists = false;
    expect(await listRegistrationSignatures("event-1", "reg-9", true)).toBeNull();
  });
});
