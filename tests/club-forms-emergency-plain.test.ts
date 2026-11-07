import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Emergency contact and physician/clinic answers on the Off-Premises Permission Slip and the Transportation
 * Passenger List are plain answers (owner decision, 2026-11-07; ADR 0005 Addendum G). These tests use the real seeds.
 */

const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  templateFindMany: vi.fn(),
  templateFindUnique: vi.fn(),
  templateFindFirst: vi.fn(),
  templateUpsert: vi.fn(),
  templateUpdate: vi.fn(),
  submissionFindMany: vi.fn(),
  submissionFindFirst: vi.fn(),
  submissionUpdate: vi.fn(),
  versionFindMany: vi.fn(),
  versionCreateMany: vi.fn(),
  queryRaw: vi.fn(),
}));

const client = {
  clubFormTemplate: {
    findMany: mocks.templateFindMany,
    findUnique: mocks.templateFindUnique,
    findFirst: mocks.templateFindFirst,
    upsert: mocks.templateUpsert,
    update: mocks.templateUpdate,
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  clubFormSubmission: { findMany: mocks.submissionFindMany, findFirst: mocks.submissionFindFirst, update: mocks.submissionUpdate },
  clubFormTemplateVersion: { findMany: mocks.versionFindMany, findUnique: vi.fn(async () => null), createMany: mocks.versionCreateMany },
  $queryRaw: mocks.queryRaw,
  $executeRaw: vi.fn(async () => 0),
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-club-form-tests" }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { buildClubFormsCsv } from "@/modules/club-forms/csv";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import { parseClubFormTemplate, restrictedFieldKeys, splitAnswers, type ClubFormsViewer } from "@/modules/club-forms/domain";
import { EMERGENCY_PLAIN_KEYS, emergencyPlainKeys, withoutEmergencyPlainKeys } from "@/modules/club-forms/plain-emergency";
import { getSubmissionForViewer } from "@/modules/club-forms/submissions";
import { syncClubFormTemplates } from "@/modules/club-forms/templates";

const seedOf = (key: string) => clubFormTemplateSeeds.find((seed) => seed.key === key)!;
const slip = seedOf("off_premises_permission_slip");
const passengers = seedOf("transportation_passenger_list");
const OLD_SLIP_KEYS = ["physician_name", "physician_phone", "clinic_name", "clinic_phone", "emergency_contact_phone"];
const OLD_PASSENGER_KEYS = Array.from({ length: 20 }, (_, index) => `passenger_${index + 1}_emergency_contact`);

const director: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-1" } };
const areaCoordinator: ClubFormsViewer = { kind: "AREA_COORDINATOR", actor: { kind: "ATTENDEE", accountId: "acct-2" } };
const eventAdmin: ClubFormsViewer = { kind: "STAFF", userId: "staff-2", systemAdmin: false, clubsAdministrator: false, sensitiveAnswers: false };
const sysAdmin: ClubFormsViewer = { kind: "STAFF", userId: "staff-1", systemAdmin: true, clubsAdministrator: false, sensitiveAnswers: true };

function row(seed: (typeof clubFormTemplateSeeds)[number], overrides: Record<string, unknown> = {}) {
  return {
    id: `template-${seed.key}`, key: seed.key, name: seed.name, description: seed.description, version: seed.version,
    definition: seed.definition, sectionNotes: seed.sectionNotes, sensitiveFieldKeys: seed.sensitiveFieldKeys,
    birthDateFieldKeys: seed.birthDateFieldKeys, staffOnlyFieldKeys: seed.staffOnlyFieldKeys, printLayout: seed.printLayout, enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.writeAuditLog.mockResolvedValue({});
  mocks.queryRaw.mockResolvedValue([]);
  mocks.versionFindMany.mockResolvedValue([]);
  mocks.versionCreateMany.mockResolvedValue({ count: 1 });
  mocks.templateUpsert.mockImplementation(async ({ create }: { create: { version: number } }) => ({ id: "created", version: create.version }));
  mocks.templateFindUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => {
    const rows = (await mocks.templateFindMany()) as Array<{ id?: string }> | undefined;
    return rows?.find((candidate) => candidate.id === where.id) ?? null;
  });
});

describe("the fixed allowance", () => {
  it("names exactly the two forms and their keys, and nothing else", () => {
    expect(Object.keys(EMERGENCY_PLAIN_KEYS).sort()).toEqual(["off_premises_permission_slip", "transportation_passenger_list"]);
    expect([...emergencyPlainKeys("off_premises_permission_slip")]).toEqual(OLD_SLIP_KEYS);
    expect([...emergencyPlainKeys("transportation_passenger_list")]).toEqual(OLD_PASSENGER_KEYS);
    expect(emergencyPlainKeys("pathfinder_staff_service_information")).toEqual([]);
    expect(emergencyPlainKeys("a_staff_copy_of_the_slip")).toEqual([]);
    expect(withoutEmergencyPlainKeys("off_premises_permission_slip", [...OLD_SLIP_KEYS, "activity"])).toEqual(["activity"]);
    expect(withoutEmergencyPlainKeys("a_staff_copy_of_the_slip", OLD_SLIP_KEYS)).toEqual(OLD_SLIP_KEYS);
  });

  it("leaves every other seeded sensitive and birth-date key as it was", () => {
    expect(seedOf("pathfinder_membership_application").sensitiveFieldKeys).toEqual(["birth_date"]);
    expect(seedOf("pathfinder_membership_application").birthDateFieldKeys).toEqual(["birth_date"]);
    const staff = seedOf("pathfinder_staff_service_information");
    expect(staff.sensitiveFieldKeys).toEqual(expect.arrayContaining(["health_limitation", "conduct_accused", "birth_date"]));
    expect(staff.birthDateFieldKeys.length).toBeGreaterThan(0);
  });
});

describe("syncing the new template versions", () => {
  const stored = (overrides: Record<string, { version?: number; sensitiveFieldKeys?: string[] }> = {}) => clubFormTemplateSeeds.map((seed) => ({
    id: `id-${seed.key}`, key: seed.key, version: seed.version, sensitiveFieldKeys: seed.sensitiveFieldKeys, birthDateFieldKeys: seed.birthDateFieldKeys,
    ...overrides[seed.key],
  }));

  it("applies slip v3 and passenger list v2 over the old stored versions without refusing or re-sealing", async () => {
    mocks.templateFindMany.mockResolvedValue(stored({
      [slip.key]: { version: 2, sensitiveFieldKeys: OLD_SLIP_KEYS },
      [passengers.key]: { version: 1, sensitiveFieldKeys: OLD_PASSENGER_KEYS },
    }));
    const result = await syncClubFormTemplates(client as never, { continueOnRefusal: true });
    expect(result.refused).toEqual([]);
    expect(result.updated.map((item) => item.key).sort()).toEqual([slip.key, passengers.key]);
    const updates = Object.fromEntries(mocks.templateUpdate.mock.calls.map(([call]) => [call.where.key, call.data]));
    expect(updates[slip.key]).toMatchObject({ version: 3, sensitiveFieldKeys: [] });
    expect(updates[passengers.key]).toMatchObject({ version: 2, sensitiveFieldKeys: [] });
    // The sync never reads or moves an answer: the human-run script does that.
    expect(mocks.submissionFindMany).not.toHaveBeenCalled();
    expect(mocks.submissionUpdate).not.toHaveBeenCalled();
    expect(mocks.versionCreateMany).toHaveBeenCalled();
  });

  it("refuses any other key that would stop being sensitive on those two forms", async () => {
    mocks.templateFindMany.mockResolvedValue(stored({ [slip.key]: { version: 2, sensitiveFieldKeys: [...OLD_SLIP_KEYS, "activity"] } }));
    const result = await syncClubFormTemplates(client as never, { continueOnRefusal: true });
    expect(result.refused).toEqual([{ key: slip.key, message: expect.stringContaining("activity would stop being sensitive") }]);
    expect(mocks.templateUpdate).not.toHaveBeenCalled();
  });

  it("refuses one form's emergency keys on the other form", async () => {
    mocks.templateFindMany.mockResolvedValue(stored({ [slip.key]: { version: 2, sensitiveFieldKeys: [...OLD_SLIP_KEYS, "passenger_1_emergency_contact"] } }));
    const result = await syncClubFormTemplates(client as never, { continueOnRefusal: true });
    expect(result.refused.map((item) => item.key)).toEqual([slip.key]);
  });

  it("still refuses a health or birth-date key that would stop being sensitive on any other form", async () => {
    const staff = seedOf("pathfinder_staff_service_information");
    mocks.templateFindMany.mockResolvedValue(stored({
      [staff.key]: { version: staff.version - 1, sensitiveFieldKeys: [...staff.sensitiveFieldKeys, "physician_name"] },
      pathfinder_membership_application: { version: seedOf("pathfinder_membership_application").version - 1, sensitiveFieldKeys: ["birth_date", "full_name"] },
    }));
    const result = await syncClubFormTemplates(client as never, { continueOnRefusal: true });
    expect(result.refused.map((item) => item.key).sort()).toEqual(["pathfinder_membership_application", staff.key]);
  });
});

describe("what everyone who can see the form gets", () => {
  it("splits the slip's and the passenger list's emergency answers into the plain half", () => {
    const slipSplit = splitAnswers(parseClubFormTemplate(row(slip)), { physician_name: "Dr. Example", emergency_contact_phone: "(515) 555-0111", activity: "Canoe trip" });
    expect(slipSplit.sensitive).toEqual({});
    expect(Object.keys(slipSplit.plain).sort()).toEqual(["activity", "emergency_contact_phone", "physician_name"]);
    const listSplit = splitAnswers(parseClubFormTemplate(row(passengers)), { passenger_1_emergency_contact: "Pat Sample (515) 555-0123", passenger_20_emergency_contact: "Sam Sample" });
    expect(listSplit.sensitive).toEqual({});
  });

  it("restricts nothing on these two forms for any viewer", () => {
    for (const seed of [slip, passengers]) {
      const template = parseClubFormTemplate(row(seed));
      for (const [viewer, organizationId] of [[director, "club-a"], [areaCoordinator, null], [eventAdmin, null], [sysAdmin, null]] as const) {
        expect(restrictedFieldKeys(viewer, organizationId, template), `${seed.key} ${viewer.kind}`).toEqual([]);
      }
    }
  });

  it("shows the answers to an Area Coordinator and an Event Admin and writes no sensitive-view audit row", async () => {
    mocks.templateFindUnique.mockResolvedValue(row(slip));
    mocks.submissionFindFirst.mockResolvedValue({
      id: "sub-1", organizationId: "club-a", clubYear: "2026-27", rosterMemberId: null, subjectName: "Riley Sample", status: "SUBMITTED",
      submittedAt: new Date("2026-10-05T15:00:00Z"), enteredVia: "ATTENDEE", unlistedClubName: null,
      answers: { child_name: "Riley Sample", physician_name: "Dr. Synthetic Physician", emergency_contact_phone: "(515) 555-0199" },
      sealedSensitiveAnswers: null, hasSensitiveAnswers: false, templateVersion: slip.version,
      organization: { name: "Example Pathfinders" }, template: row(slip),
    });
    for (const viewer of [areaCoordinator, eventAdmin]) {
      const view = await getSubmissionForViewer(viewer, "sub-1");
      expect(view.restrictedKeys).toEqual([]);
      expect(view.answers).toMatchObject({ physician_name: "Dr. Synthetic Physician", emergency_contact_phone: "(515) 555-0199" });
    }
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("the staff CSV", () => {
  const exportRows = [{
    clubYear: "2026-27", subjectName: "Riley Sample", templateVersion: 3, status: "SUBMITTED", submittedAt: new Date("2026-10-30T12:00:00Z"), enteredVia: "LINK",
    answers: { child_name: "Riley Sample", physician_name: "Dr. Synthetic Physician", emergency_contact_phone: "(515) 555-0199" },
    unlistedClubName: null, organization: { name: "Example Pathfinders" },
  }];

  it("has a column and a value for the slip's physician, clinic and emergency answers, and never reads the sealed column", async () => {
    mocks.templateFindUnique.mockResolvedValue(row(slip));
    mocks.submissionFindMany.mockResolvedValue(exportRows);
    const { csv } = await buildClubFormsCsv(eventAdmin, { templateKey: slip.key });
    const header = csv.split("\r\n")[0];
    for (const label of ["Physician's name", "Physician's phone", "Clinic", "Clinic phone", "Emergency contact phone number"]) expect(header).toContain(`"${label}"`);
    expect(csv).toContain("Dr. Synthetic Physician");
    expect(csv).toContain("(515) 555-0199");
    expect(mocks.submissionFindMany.mock.calls[0][0].select).not.toHaveProperty("sealedSensitiveAnswers");
  });

  it("has a column for each passenger's emergency contact", async () => {
    mocks.templateFindUnique.mockResolvedValue(row(passengers));
    mocks.submissionFindMany.mockResolvedValue([{ ...exportRows[0], templateVersion: 2, answers: { contact_name: "Dana Director", passenger_1_emergency_contact: "Pat Sample (515) 555-0123" } }]);
    const { csv } = await buildClubFormsCsv(eventAdmin, { templateKey: passengers.key });
    expect(csv.split("\r\n")[0]).toContain("\"Passenger 20 emergency contact (name and phone)\"");
    expect(csv).toContain("Pat Sample (515) 555-0123");
  });

  it("includes the keys from an older recorded version that listed them as sensitive, once the current version does not", async () => {
    mocks.templateFindUnique.mockResolvedValue(row(slip));
    mocks.versionFindMany.mockResolvedValue([{
      version: 2, definition: slip.definition, sectionNotes: slip.sectionNotes, sensitiveFieldKeys: OLD_SLIP_KEYS, birthDateFieldKeys: [],
      staffOnlyFieldKeys: [], hiddenFieldKeys: [], printLayout: "STANDARD",
    }]);
    mocks.submissionFindMany.mockResolvedValue([{ ...exportRows[0], templateVersion: 2 }]);
    const { csv } = await buildClubFormsCsv(eventAdmin, { templateKey: slip.key });
    expect(csv.split("\r\n")[0]).toContain("\"Physician's name\"");
    expect(csv).toContain("Dr. Synthetic Physician");
  });

  it("still leaves a staff copy's sensitive column out when that copy keeps the keys sensitive under its own key", async () => {
    mocks.templateFindUnique.mockResolvedValue(row(slip, { key: "staff_slip_copy", sensitiveFieldKeys: ["physician_name"] }));
    mocks.submissionFindMany.mockResolvedValue(exportRows);
    const { csv } = await buildClubFormsCsv(sysAdmin, { templateKey: "staff_slip_copy" });
    expect(csv.split("\r\n")[0]).not.toContain("\"Physician's name\"");
    expect(csv).not.toContain("Dr. Synthetic Physician");
  });
});
