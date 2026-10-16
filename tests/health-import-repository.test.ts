/* eslint-disable @typescript-eslint/no-explicit-any -- a loose in-memory stand-in for the Prisma client */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTACT_HEADERS, MAIN_HEADERS, contactRow, csvBytes, importMarkers, mainRow } from "./health-import-fixtures";

const state = vi.hoisted(() => ({
  env: { HEALTH_RECORDS_ENABLED: true, SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-health-import-tests" } as Record<string, unknown>,
  audit: [] as Array<Record<string, any>>,
  organizations: [] as Array<Record<string, any>>,
  members: [] as Array<Record<string, any>>,
  records: [] as Array<Record<string, any>>,
  fields: [] as Array<Record<string, any>>,
  acknowledged: true,
  failCreateFor: null as string | null,
  logged: [] as unknown[],
}));

const sealBirth = vi.hoisted(() => ({ value: (date: string) => `sealed:${date}` }));

const client: any = {
  organization: { findMany: async () => state.organizations },
  clubRosterMember: {
    findMany: async ({ where }: { where: { organizationId: { in: string[] }; clubYear: string } }) =>
      state.members.filter((member) => where.organizationId.in.includes(member.organizationId) && member.clubYear === where.clubYear && member.status === "ACTIVE"),
    findFirst: async ({ where }: { where: { id: string; organizationId: string; clubYear: string } }) =>
      state.members.find((member) => member.id === where.id && member.organizationId === where.organizationId && member.clubYear === where.clubYear && member.status === "ACTIVE") ?? null,
  },
  healthRecord: {
    findMany: async () => state.records.map((record) => ({ ...record, rosterMember: { personId: state.members.find((member) => member.id === record.rosterMemberId)?.personId ?? null } })),
    findFirst: async ({ where }: { where: { organizationId: string; OR: Array<Record<string, any>> } }) =>
      state.records.find((record) => record.organizationId === where.organizationId && where.OR.some((clause) =>
        clause.rosterMemberId ? record.rosterMemberId === clause.rosterMemberId : state.members.find((member) => member.id === record.rosterMemberId)?.personId === clause.rosterMember.personId)) ?? null,
    create: async ({ data }: { data: Record<string, any> }) => {
      if (state.failCreateFor && data.rosterMemberId === state.failCreateFor) throw Object.assign(new Error("database said: Synthetic peanut reaction"), { code: "P9999" });
      const { fields, ...record } = data;
      state.records.push({ ...record });
      for (const field of fields.create) state.fields.push({ recordId: record.id, ...field });
      return record;
    },
  },
  healthPrivacyAcknowledgment: { findFirst: async () => (state.acknowledged ? { id: "ack" } : null) },
  $queryRaw: async () => [],
  // A transaction that rolls back what it wrote when the work throws.
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
    const snapshot = { records: [...state.records], fields: [...state.fields], audit: [...state.audit] };
    try {
      return await work(client);
    } catch (error) {
      Object.assign(state, snapshot);
      throw error;
    }
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => state.env }));
vi.mock("@/lib/logger", () => ({ logError: (...args: unknown[]) => state.logged.push(args) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: async (entry: Record<string, unknown>) => { state.audit.push(entry); } }));
vi.mock("@/modules/club-rosters/birth-dates", () => ({ openBirthDate: (sealed: string) => sealed.replace(/^sealed:/, "") }));

import { openHealthField } from "@/modules/health-records/crypto";
import type { HealthViewer } from "@/modules/health-records/domain";
import { HealthRecordError } from "@/modules/health-records/errors";
import { applyHealthImport, previewHealthImport } from "@/modules/health-records/import-repository";
import { healthRecordStatus } from "@/modules/health-records/domain";

const now = new Date("2026-10-15T15:00:00Z");
const admin: HealthViewer = { kind: "SYSTEM_ADMIN", userId: "admin-1" };

const clubYear = "2026-27";
function member(id: string, firstName: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: "club-a",
    clubYear,
    status: "ACTIVE",
    personId: `person-${id}`,
    sealedBirthDate: sealBirth.value("2012-04-09"),
    person: { firstName, lastName: "Sample" },
    guardians: [],
    ...overrides,
  };
}

function files(rows: Array<Record<string, string>>, contacts: Array<Record<string, string>> = []) {
  return [{ bytes: csvBytes(MAIN_HEADERS, rows) }, { bytes: csvBytes(CONTACT_HEADERS, contacts) }];
}

/** The rows an administrator would tick in the preview: the `sourceId:memberId` pairs, optionally only some entries. */
async function pairs(upload: ReturnType<typeof files>, only?: string[]) {
  const preview = await previewHealthImport(admin, upload, now);
  state.audit = [];
  return preview.rows
    .filter((row) => (row.outcome === "MATCHED" || row.outcome === "ALREADY_HAS_RECORD") && row.memberId && (!only || only.includes(row.sourceId)))
    .map((row) => ({ sourceId: row.sourceId, memberId: row.memberId! }));
}

async function applySelected(upload: ReturnType<typeof files>, only?: string[]) {
  return applyHealthImport(admin, upload, { include: await pairs(upload, only) }, now);
}

function openAll(recordId: string) {
  return Object.fromEntries(state.fields.filter((field) => field.recordId === recordId).map((field) => [field.fieldKey, openHealthField(recordId, field.fieldKey, field.sealedValue)]));
}

beforeEach(() => {
  state.env.HEALTH_RECORDS_ENABLED = true;
  state.audit = [];
  state.records = [];
  state.fields = [];
  state.logged = [];
  state.acknowledged = true;
  state.failCreateFor = null;
  state.organizations = [
    { id: "club-a", name: "Example Pathfinders", normalizedName: "example pathfinders", parentOrganization: { name: "Example SDA Church" } },
    { id: "club-b", name: "Other Pathfinders", normalizedName: "other pathfinders", parentOrganization: null },
  ];
  state.members = [member("m1", "Riley"), member("m2", "Jordan")];
});

describe("the preview", () => {
  it("shows club, name, result and section names, and no health value", async () => {
    const preview = await previewHealthImport(admin, files([mainRow(), mainRow({ PathfinderHealthRecord_Id: "1002", Name_First: "Nobody", Name_Last: "Listed" })], [contactRow("1001", "e1", "Alex", "Sample", "515-555-0180", "Aunt")]), now);
    expect(preview.counts).toMatchObject({ MATCHED: 1, UNMATCHED: 1 });
    expect(preview.rows[0]).toMatchObject({ name: "Riley Sample", clubName: "Example Pathfinders", outcome: "MATCHED" });
    expect(preview.rows[0]!.sections).toEqual(expect.arrayContaining(["allergies", "insurance", "emergency contacts"]));
    expect(preview.rows[1]).toMatchObject({ name: "Nobody Listed", outcome: "UNMATCHED", clubName: "Example Pathfinders" });
    const dump = JSON.stringify(preview);
    for (const marker of importMarkers) expect(dump).not.toContain(marker);
    expect(dump).not.toMatch(/Alex|0180|peanut/i);
  });

  it("writes nothing but a counts-only audit row", async () => {
    await previewHealthImport(admin, files([mainRow()]), now);
    expect(state.records).toEqual([]);
    expect(state.fields).toEqual([]);
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ action: "HEALTH_IMPORT_PREVIEWED", actorUserId: "admin-1" });
    const dump = JSON.stringify(state.audit);
    for (const marker of importMarkers) expect(dump).not.toContain(marker);
    expect(dump).not.toMatch(/Riley|Sample|2012/);
  });

  it("reports a row that already has a record, in this year or an earlier one, as skipped", async () => {
    state.records = [{ id: "r1", organizationId: "club-a", rosterMemberId: "m1" }];
    expect((await previewHealthImport(admin, files([mainRow()]), now)).rows[0]!.outcome).toBe("ALREADY_HAS_RECORD");
    state.members = [member("m1-now", "Riley", { personId: "person-m1" }), member("m1", "Riley", { clubYear: "2025-26", personId: "person-m1" })];
    expect((await previewHealthImport(admin, files([mainRow()]), now)).rows[0]!.outcome).toBe("ALREADY_HAS_RECORD");
  });

  it("matches with a birth date the roster holds sealed, and never reports it", async () => {
    state.members = [member("m1", "Riley", { sealedBirthDate: sealBirth.value("2011-01-01") })];
    const preview = await previewHealthImport(admin, files([mainRow()]), now);
    expect(preview.rows[0]).toMatchObject({ outcome: "NEEDS_CHECK" });
    expect(JSON.stringify(preview)).not.toMatch(/2011|2012/);
  });
});

describe("who may import", () => {
  it("refuses everyone except a system administrator, and an administrator acting as a director", async () => {
    for (const viewer of [
      { kind: "CLUB_LEADER", organizationId: "club-a", accountId: "a" },
      { kind: "CLUB_REGISTRAR", organizationId: "club-a", accountId: "a" },
      { kind: "AREA_COORDINATOR", accountId: "a" },
      { kind: "HEALTH_ROLE", userId: "u", eventIds: ["e"] },
      { kind: "SYSTEM_ADMIN", userId: "u", actAsId: "director" },
    ] as HealthViewer[]) {
      await expect(previewHealthImport(viewer, files([mainRow()]), now)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(applyHealthImport(viewer, files([mainRow()]), {}, now)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(state.records).toEqual([]);
  });

  it("answers as a missing page when the feature is off, and asks for the privacy acknowledgment first", async () => {
    state.env.HEALTH_RECORDS_ENABLED = false;
    await expect(applyHealthImport(admin, files([mainRow()]), {}, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    state.env.HEALTH_RECORDS_ENABLED = true;
    state.acknowledged = false;
    await expect(previewHealthImport(admin, files([mainRow()]), now)).rejects.toMatchObject({ code: "ACKNOWLEDGMENT_REQUIRED" });
    await expect(applyHealthImport(admin, files([mainRow()]), {}, now)).rejects.toMatchObject({ code: "ACKNOWLEDGMENT_REQUIRED" });
    expect(state.records).toEqual([]);
  });

  it("refuses to write without an encryption key", async () => {
    state.env.SECRET_ENCRYPTION_KEY = "";
    await expect(applyHealthImport(admin, files([mainRow()]), {}, now)).rejects.toMatchObject({ code: "ENCRYPTION_NOT_CONFIGURED" });
    state.env.SECRET_ENCRYPTION_KEY = "a-synthetic-encryption-key-for-health-import-tests";
  });

  it("turns a bad file into a validation error that carries no cell content", async () => {
    const error = await previewHealthImport(admin, [{ bytes: csvBytes(["Other_Export"], [{ Other_Export: "Synthetic peanut reaction" }]) }], now).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HealthRecordError);
    expect((error as HealthRecordError).code).toBe("VALIDATION_FAILED");
    expect((error as Error).message).not.toMatch(/peanut/);
  });
});

describe("applying the import", () => {
  it("writes a sealed record flagged for director review, which reads as Needs update", async () => {
    const result = await applySelected(files([mainRow()], [contactRow("1001", "e1", "Alex", "Sample", "515-555-0180", "Aunt")]));
    expect(result.imported).toBe(1);
    expect(result.rows[0]).toMatchObject({ outcome: "IMPORTED" });
    expect(state.records).toHaveLength(1);
    const record = state.records[0]!;
    expect(record).toMatchObject({ organizationId: "club-a", rosterMemberId: "m1", confirmedClubYear: null, lastConfirmedAt: null, hasHealthNote: true, importedAt: now, lastSavedByActor: "admin-1" });
    expect(healthRecordStatus(record as never, now)).toBe("NEEDS_UPDATE");
    // Each field is its own sealed row, and none of them is plaintext.
    expect(state.fields.length).toBeGreaterThan(10);
    expect(JSON.stringify(state.fields)).not.toMatch(/peanut|Synthetic Cover|Imaginary/);
    const opened = openAll(record.id);
    expect(opened).toMatchObject({
      hasAllergies: "YES",
      allergyDetails: "Synthetic peanut reaction, mild, synthetic remedy",
      insuranceCompany: "Synthetic Cover Co",
      emergencyContacts: [{ firstName: "Alex", lastName: "Sample", phone: "(515) 555-0180", relationship: "Aunt" }],
    });
  });

  it("keeps every audit row to ids and counts", async () => {
    await applySelected(files([mainRow(), mainRow({ PathfinderHealthRecord_Id: "1002", Name_First: "Nobody", Name_Last: "Listed" })]));
    expect(state.audit.map((entry) => entry.action)).toEqual(["HEALTH_RECORD_IMPORTED", "HEALTH_IMPORT_CLUB_APPLIED", "HEALTH_IMPORT_APPLIED"]);
    const dump = JSON.stringify(state.audit);
    for (const marker of importMarkers) expect(dump).not.toContain(marker);
    expect(dump).not.toMatch(/Riley|Nobody|Listed|Sample|Example Pathfinders|2012|2026-09-20/);
    const run = state.audit.find((entry) => entry.action === "HEALTH_IMPORT_APPLIED")!;
    expect(run).toMatchObject({ actorUserId: "admin-1", entityType: "HealthImport" });
    expect(run.metadata).toMatchObject({ entryCount: 2, counts: { IMPORTED: 1, UNMATCHED: 1 } });
    expect(state.audit.find((entry) => entry.action === "HEALTH_IMPORT_CLUB_APPLIED")).toMatchObject({ entityId: "club-a", metadata: { imported: 1, organizationId: "club-a" } });
    for (const entry of state.audit) {
      const values = Object.values(entry.metadata as Record<string, unknown>).filter((value) => typeof value === "string");
      for (const value of values) expect(String(value).length).toBeLessThan(60);
    }
  });

  it("is idempotent: the same file again imports nothing and changes nothing", async () => {
    const upload = () => files([mainRow(), mainRow({ PathfinderHealthRecord_Id: "1002", Name_First: "Jordan" })]);
    const selection = await pairs(upload());
    expect((await applyHealthImport(admin, upload(), { include: selection }, now)).imported).toBe(2);
    const before = JSON.stringify({ records: state.records, fields: state.fields });
    const again = await applyHealthImport(admin, upload(), { include: selection }, now);
    expect(again.imported).toBe(0);
    expect(again.counts.ALREADY_HAS_RECORD).toBe(2);
    expect(JSON.stringify({ records: state.records, fields: state.fields })).toBe(before);
  });

  it("never overwrites an existing record, including one that is a director's own", async () => {
    state.records = [{ id: "existing", organizationId: "club-a", rosterMemberId: "m1", importedAt: null, hasHealthNote: false }];
    state.fields = [{ recordId: "existing", fieldKey: "hasAllergies", sealedValue: "untouched" }];
    const result = await applySelected(files([mainRow()]));
    expect(result.imported).toBe(0);
    expect(result.rows[0]!.outcome).toBe("ALREADY_HAS_RECORD");
    expect(state.records).toEqual([{ id: "existing", organizationId: "club-a", rosterMemberId: "m1", importedAt: null, hasHealthNote: false }]);
    expect(state.fields).toEqual([{ recordId: "existing", fieldKey: "hasAllergies", sealedValue: "untouched" }]);
  });

  it("imports only the entries named, and never an unmatched or needs-check row", async () => {
    state.members = [member("m1", "Riley"), member("m2", "Jordan"), member("m3", "Casey", { sealedBirthDate: sealBirth.value("2001-01-01") })];
    const rows = [
      mainRow(),
      mainRow({ PathfinderHealthRecord_Id: "1002", Name_First: "Jordan" }),
      mainRow({ PathfinderHealthRecord_Id: "1003", Name_First: "Casey" }),
      mainRow({ PathfinderHealthRecord_Id: "1004", Name_First: "Nobody" }),
    ];
    const result = await applySelected(files(rows), ["1001", "1003", "1004"]);
    expect(result.rows.map((row) => row.outcome)).toEqual(["IMPORTED", "NOT_SELECTED", "NEEDS_CHECK", "UNMATCHED"]);
    expect(state.records.map((record) => record.rosterMemberId)).toEqual(["m1"]);
  });

  it("seals the imported consent and signature when the form is signed, and none when it is not", async () => {
    await applySelected(files([mainRow({ Signature: "Pat Sample", Date: "2026-09-20" })]));
    const opened = openAll(state.records[0]!.id);
    expect(opened.consent).toEqual({ version: "cognito-pathfinder-health-record-2026", emergencyTreatment: true, activities: true, photocopy: true, agreedOn: "2026-09-20", importedFromOnlineForm: true });
    expect(opened.signature).toEqual({ typedName: "Pat Sample", signedOn: "2026-09-20" });
    // Sealed like every other field: no plaintext in the stored rows.
    expect(JSON.stringify(state.fields)).not.toMatch(/Pat Sample|cognito-pathfinder/);

    state.records = [];
    state.fields = [];
    await applySelected(files([mainRow({ Signature: "" })]));
    const keys = state.fields.map((field) => field.fieldKey);
    expect(keys).not.toContain("consent");
    expect(keys).not.toContain("signature");
  });

  it("keeps the consent out of the audit rows", async () => {
    await applySelected(files([mainRow({ Signature: "Pat Sample" })]));
    expect(JSON.stringify(state.audit)).not.toMatch(/Pat Sample|cognito-pathfinder|consent/i);
  });

  it("imports only what was previewed: a row whose match has changed is reported, not written", async () => {
    const upload = files([mainRow(), mainRow({ PathfinderHealthRecord_Id: "1002", Name_First: "Jordan" })]);
    const selection = await pairs(upload);
    expect(selection).toHaveLength(2);
    // Between preview and apply: Riley's roster row is replaced by a different member, and Jordan is removed.
    state.members = [member("m-other", "Riley")];
    const result = await applyHealthImport(admin, upload, { include: selection }, now);
    expect(result.rows.map((row) => row.outcome)).toEqual(["CHANGED", "CHANGED"]);
    expect(result.imported).toBe(0);
    expect(state.records).toEqual([]);
    // A pair naming a member the file does not match is refused as well, and nothing is selected by default.
    state.members = [member("m1", "Riley")];
    const forged = await applyHealthImport(admin, files([mainRow()]), { include: [{ sourceId: "1001", memberId: "m2" }] }, now);
    expect(forged.rows[0]!.outcome).toBe("CHANGED");
    const none = await applyHealthImport(admin, files([mainRow()]), {}, now);
    expect(none.rows[0]!.outcome).toBe("NOT_SELECTED");
    expect(state.records).toEqual([]);
  });

  it("reports a selected older entry as superseded, not changed", async () => {
    const upload = files([
      mainRow({ PathfinderHealthRecord_Id: "old", Entry_DateSubmitted: "2026-08-01" }),
      mainRow({ PathfinderHealthRecord_Id: "new", Entry_DateSubmitted: "2026-09-01" }),
    ]);
    const preview = await previewHealthImport(admin, upload, now);
    state.audit = [];
    const selection = preview.rows.filter((row) => row.memberId).map((row) => ({ sourceId: row.sourceId, memberId: row.memberId! }));
    expect(selection).toHaveLength(2);
    const result = await applyHealthImport(admin, upload, { include: selection }, now);
    expect(result.rows.map((row) => row.outcome)).toEqual(["SUPERSEDED", "IMPORTED"]);
    expect(result.counts.CHANGED).toBe(0);
  });

  it("does not import an entry with a cell over the length cap", async () => {
    const result = await applySelected(files([mainRow({ ListOfMedicalRestrictions: "x".repeat(20_001) })]));
    expect(result.rows[0]!.outcome).toBe("NEEDS_CHECK");
    expect(result.rows[0]!.reason).toMatch(/20,000/);
    expect(state.records).toEqual([]);
  });

  it("keeps long text whole and counts the field as needing correction", async () => {
    const long = "Synthetic note ".repeat(160);
    const upload = () => files([mainRow({ ListOfMedicationsOrPertinentHealthincludingMentalHealthInformation: long })]);
    await applySelected(upload());
    expect(openAll(state.records[0]!.id).medications).toBe(long.trim());
    const preview = await previewHealthImport(admin, upload(), now);
    expect(preview.rows[0]!.needsCorrectionCount).toBe(1);
  });

  it("lists unmatched rows by name only", async () => {
    const result = await applySelected(files([mainRow({ Name_First: "Nobody", Name_Last: "Listed" })]));
    expect(result.rows[0]).toMatchObject({ name: "Nobody Listed", outcome: "UNMATCHED" });
    expect(Object.keys(result.rows[0]!).sort()).toEqual(["clubName", "clubText", "contactsOmitted", "memberId", "name", "needsCorrectionCount", "outcome", "reason", "sections", "sourceId"]);
  });

  it("rolls a club back when a write fails, reports it without the cause, and carries on with other clubs", async () => {
    state.members = [member("m1", "Riley"), member("m2", "Jordan"), member("m9", "Sam", { organizationId: "club-b" })];
    state.failCreateFor = "m2";
    const rows = [
      mainRow(),
      mainRow({ PathfinderHealthRecord_Id: "1002", Name_First: "Jordan" }),
      mainRow({ PathfinderHealthRecord_Id: "1009", Name_First: "Sam", ChurchAndClubName_First: "Other", ChurchAndClubName_Last: "Pathfinders" }),
    ];
    const result = await applySelected(files(rows));
    expect(result.rows.map((row) => row.outcome)).toEqual(["FAILED", "FAILED", "IMPORTED"]);
    expect(state.records.map((record) => record.rosterMemberId)).toEqual(["m9"]);
    // The log carries the error code only, not the database's message.
    const loggedMessages = state.logged.map((args) => (args as unknown[]).map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
    expect(loggedMessages.join("\n")).toContain("P9999");
    expect(loggedMessages.join("\n")).not.toMatch(/peanut/);
  });

  it("uses the later of two entries for one member", async () => {
    const result = await applySelected(files([
      mainRow({ PathfinderHealthRecord_Id: "old", Entry_DateSubmitted: "2026-08-01", Phone: "515-555-0101" }),
      mainRow({ PathfinderHealthRecord_Id: "new", Entry_DateSubmitted: "2026-09-01", Phone: "515-555-0102" }),
    ]));
    expect(result.rows.map((row) => row.outcome)).toEqual(["SUPERSEDED", "IMPORTED"]);
    expect(openAll(state.records[0]!.id).phone).toBe("(515) 555-0102");
  });

  it("does not import an incomplete form", async () => {
    const result = await applySelected(files([mainRow({ Entry_Status: "Incomplete" })]));
    expect(result.rows[0]!.outcome).toBe("INCOMPLETE");
    expect(state.records).toEqual([]);
  });
});
