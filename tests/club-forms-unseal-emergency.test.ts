import { beforeEach, describe, expect, it, vi } from "vitest";

/** The human-run step that moves the 2026-11-07 emergency answers out of the sealed value. Synthetic data only. */

type Sub = { id: string; templateId: string; answers: Record<string, unknown>; sealedSensitiveAnswers: string | null; hasSensitiveAnswers: boolean };
const state = vi.hoisted(() => ({
  templates: [] as Array<{ id: string; key: string; sensitiveFieldKeys: string[]; version: number; birthDateFieldKeys: string[]; customizedAt: null; draftUpdatedAt: null }>,
  submissions: [] as Sub[],
  audit: [] as Array<Record<string, unknown>>,
  failOnUpdateOf: null as string | null,
}));

const client = {
  clubFormTemplate: {
    findUnique: async ({ where }: { where: { key?: string; id?: string } }) => state.templates.find((row) => row.key === where.key || row.id === where.id) ?? null,
  },
  clubFormSubmission: {
    findMany: async ({ where, cursor, skip = 0, take }: { where: { templateId: string }; cursor?: { id: string }; skip?: number; take?: number }) => {
      const rows = state.submissions.filter((row) => row.templateId === where.templateId && row.sealedSensitiveAnswers !== null).sort((left, right) => left.id.localeCompare(right.id));
      const start = cursor ? rows.findIndex((row) => row.id === cursor.id) + skip : 0;
      return rows.slice(start, take === undefined ? undefined : start + take).map((row) => ({ ...row }));
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Sub> }) => {
      if (state.failOnUpdateOf === where.id) throw new Error("synthetic failure");
      Object.assign(state.submissions.find((row) => row.id === where.id)!, data);
    },
  },
  $queryRaw: async () => [],
  $transaction: async (work: (tx: unknown) => unknown) => {
    const snapshot = structuredClone({ s: state.submissions, a: state.audit });
    try {
      return await work(client);
    } catch (error) {
      state.submissions.splice(0, state.submissions.length, ...snapshot.s);
      state.audit.splice(0, state.audit.length, ...snapshot.a);
      throw error;
    }
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-club-form-tests" }) }));
vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: async (entry: Record<string, unknown>) => { state.audit.push(entry); return entry; },
}));

import { openSensitiveAnswers, sealSensitiveAnswers } from "@/modules/club-forms/sealed-answers";
import { unsealEmergencyAnswers } from "@/modules/club-forms/unseal-emergency";

const PHYSICIAN = "Dr. Synthetic Physician";
const CONTACT = "Pat Sample (515) 555-0123";

function sub(id: string, templateId: string, plain: Record<string, unknown>, sealed: Record<string, unknown> | null): Sub {
  return { id, templateId, answers: plain, sealedSensitiveAnswers: sealed ? sealSensitiveAnswers(id, sealed) : null, hasSensitiveAnswers: sealed !== null };
}

const find = (id: string) => state.submissions.find((row) => row.id === id)!;
const report = (result: Awaited<ReturnType<typeof unsealEmergencyAnswers>>, key: string) => result.templates.find((item) => item.templateKey === key)!;

beforeEach(() => {
  state.failOnUpdateOf = null;
  state.audit.length = 0;
  state.templates.splice(0, state.templates.length,
    { id: "tpl-slip", key: "off_premises_permission_slip", sensitiveFieldKeys: [], version: 3, birthDateFieldKeys: [], customizedAt: null, draftUpdatedAt: null },
    { id: "tpl-list", key: "transportation_passenger_list", sensitiveFieldKeys: [], version: 2, birthDateFieldKeys: [], customizedAt: null, draftUpdatedAt: null },
    { id: "tpl-staff", key: "pathfinder_staff_service_information", sensitiveFieldKeys: ["health_limitation"], version: 4, birthDateFieldKeys: [], customizedAt: null, draftUpdatedAt: null },
  );
  state.submissions.splice(0, state.submissions.length,
    // Only emergency keys sealed: the sealed value is dropped.
    sub("s1", "tpl-slip", { child_name: "Riley Sample" }, { physician_name: PHYSICIAN, emergency_contact_phone: "(515) 555-0199" }),
    // An emergency key plus another sealed key: the other stays sealed.
    sub("s2", "tpl-slip", { child_name: "Sam Sample" }, { physician_name: PHYSICIAN, activity: "kept sealed (a staff-built sensitive field)" }),
    // Nothing from the decision in the sealed value: untouched.
    sub("s3", "tpl-slip", { child_name: "Alex Sample", physician_name: "Already Plain" }, { activity: "kept sealed" }),
    // No sealed value at all.
    sub("s4", "tpl-slip", { child_name: "Casey Sample" }, null),
    sub("p1", "tpl-list", { passenger_1_name: "Riley Sample" }, { passenger_1_emergency_contact: CONTACT, passenger_2_emergency_contact: "Second Contact" }),
    // Another form's sealed answers are never touched, even a key that looks similar.
    sub("t1", "tpl-staff", { full_name: "Jordan Sample" }, { health_limitation: "Yes", physician_name: "Not this form" }),
  );
});

describe("unsealing the emergency answers (owner decision, 2026-11-07)", () => {
  it("changes nothing in a dry run, and says what it would move", async () => {
    const before = structuredClone(state.submissions);
    const result = await unsealEmergencyAnswers(client as never);
    expect(result.execute).toBe(false);
    expect(state.submissions).toEqual(before);
    expect(state.audit).toEqual([]);
    expect(report(result, "off_premises_permission_slip")).toMatchObject({ status: "DRY_RUN", scanned: 3, submissionsMoved: 2, answersMoved: 3, sealedDropped: 1 });
    expect(report(result, "transportation_passenger_list")).toMatchObject({ status: "DRY_RUN", scanned: 1, submissionsMoved: 1, answersMoved: 2, sealedDropped: 1 });
  });

  it("moves only the decided keys, keeps every other answer sealed, and drops an emptied sealed value", async () => {
    const result = await unsealEmergencyAnswers(client as never, { execute: true });
    expect(report(result, "off_premises_permission_slip")).toMatchObject({ status: "DONE", submissionsMoved: 2, answersMoved: 3, sealedDropped: 1 });

    expect(find("s1")).toMatchObject({ sealedSensitiveAnswers: null, hasSensitiveAnswers: false });
    expect(find("s1").answers).toEqual({ child_name: "Riley Sample", physician_name: PHYSICIAN, emergency_contact_phone: "(515) 555-0199" });

    expect(find("s2").hasSensitiveAnswers).toBe(true);
    expect(find("s2").answers).toEqual({ child_name: "Sam Sample", physician_name: PHYSICIAN });
    expect(openSensitiveAnswers("s2", find("s2").sealedSensitiveAnswers!)).toEqual({ activity: "kept sealed (a staff-built sensitive field)" });

    expect(find("s3").answers).toEqual({ child_name: "Alex Sample", physician_name: "Already Plain" });
    expect(openSensitiveAnswers("s3", find("s3").sealedSensitiveAnswers!)).toEqual({ activity: "kept sealed" });

    expect(find("p1")).toMatchObject({ sealedSensitiveAnswers: null, hasSensitiveAnswers: false });
    expect(find("p1").answers).toMatchObject({ passenger_1_emergency_contact: CONTACT, passenger_2_emergency_contact: "Second Contact" });

    // Another template is not touched at all.
    expect(openSensitiveAnswers("t1", find("t1").sealedSensitiveAnswers!)).toEqual({ health_limitation: "Yes", physician_name: "Not this form" });
    expect(find("t1").answers).toEqual({ full_name: "Jordan Sample" });
  });

  it("is idempotent: a second run changes nothing and reports nothing to move", async () => {
    await unsealEmergencyAnswers(client as never, { execute: true });
    const after = structuredClone(state.submissions);
    state.audit.length = 0;
    const again = await unsealEmergencyAnswers(client as never, { execute: true });
    expect(state.submissions).toEqual(after);
    expect(state.audit).toEqual([]);
    expect(report(again, "off_premises_permission_slip")).toMatchObject({ submissionsMoved: 0, answersMoved: 0, sealedDropped: 0 });
    expect(report(again, "transportation_passenger_list")).toMatchObject({ submissionsMoved: 0 });
  });

  it("audits ids-free counts per template and never an answer", async () => {
    await unsealEmergencyAnswers(client as never, { execute: true });
    expect(state.audit.map((entry) => entry.action)).toEqual(["CLUB_FORM_EMERGENCY_ANSWERS_UNSEALED", "CLUB_FORM_EMERGENCY_ANSWERS_UNSEALED"]);
    expect(state.audit[0]).toMatchObject({ entityType: "ClubFormTemplate", entityId: "tpl-slip", metadata: { templateKey: "off_premises_permission_slip", scanned: 3, submissionsMoved: 2, answersMoved: 3, sealedDropped: 1 } });
    const text = JSON.stringify(state.audit);
    for (const secret of [PHYSICIAN, CONTACT, "Second Contact", "Riley", "kept sealed"]) expect(text).not.toContain(secret);
  });

  it("refuses to run while the template still lists the keys as sensitive, and changes nothing", async () => {
    state.templates[0].sensitiveFieldKeys = ["physician_name"];
    const before = structuredClone(state.submissions);
    const result = await unsealEmergencyAnswers(client as never, { execute: true });
    expect(report(result, "off_premises_permission_slip")).toMatchObject({ status: "NOT_SYNCED", submissionsMoved: 0 });
    expect(find("s1")).toEqual(before.find((row) => row.id === "s1"));
    // The other template is still done.
    expect(report(result, "transportation_passenger_list").status).toBe("DONE");
  });

  it("leaves a template untouched when one sealed value cannot be read", async () => {
    state.submissions.push({ id: "s0", templateId: "tpl-slip", answers: {}, sealedSensitiveAnswers: "v1.not.a.value", hasSensitiveAnswers: true });
    const before = structuredClone(state.submissions.filter((row) => row.templateId === "tpl-slip"));
    const result = await unsealEmergencyAnswers(client as never, { execute: true });
    expect(report(result, "off_premises_permission_slip")).toMatchObject({ status: "FAILED", failedSubmissionIds: ["s0"] });
    expect(state.submissions.filter((row) => row.templateId === "tpl-slip")).toEqual(before);
    expect(state.audit.filter((entry) => (entry.metadata as { templateKey: string }).templateKey === "off_premises_permission_slip")).toEqual([]);
  });

  it("rolls the template back when a write fails part way", async () => {
    state.failOnUpdateOf = "s2";
    const before = structuredClone(state.submissions.filter((row) => row.templateId === "tpl-slip"));
    await expect(unsealEmergencyAnswers(client as never, { execute: true })).rejects.toThrow("synthetic failure");
    expect(state.submissions.filter((row) => row.templateId === "tpl-slip")).toEqual(before);
  });

  it("reports a template that is not in this database", async () => {
    state.templates.splice(1, 1);
    const result = await unsealEmergencyAnswers(client as never);
    expect(report(result, "transportation_passenger_list").status).toBe("NOT_PRESENT");
  });
});
