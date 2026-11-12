import { describe, expect, it } from "vitest";
import { CLUB_OPTIONAL_FEATURE_KEYS, canSwitchClubFeatures, clubOptionalFeatureDefinitions } from "@/modules/club-features/domain";
import {
  NAD_CERTIFICATIONS,
  canManageStaffTraining,
  certificationLabel,
  completedOnProblem,
  isNadCertificationKey,
  isRealIsoDate,
  recordAuditName,
  recordLabel,
  sortRecordsNewestFirst,
  staffTrainingApplies,
} from "@/modules/staff-training/domain";
import { parseStaffTrainingAdd } from "@/modules/staff-training/schemas";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";
import { ZodError } from "zod";

/** Staff training records (#1697): the pure rules. Synthetic data only. */

const now = new Date("2026-11-12T12:00:00.000Z");

describe("the optional feature", () => {
  it("is a typed key with a title, and a director or deputy switches it", () => {
    expect(CLUB_OPTIONAL_FEATURE_KEYS).toContain("staff-training-records");
    expect(clubOptionalFeatureDefinitions["staff-training-records"].title).toBe("Staff training records");
    expect(canSwitchClubFeatures(clubCapabilities("DIRECTOR"))).toBe(true);
    expect(canSwitchClubFeatures(clubCapabilities("DEPUTY"))).toBe(true);
    expect(canSwitchClubFeatures(clubCapabilities("REGISTRAR"))).toBe(false);
  });
});

describe("certification levels", () => {
  it("are the five NAD levels named in the issue, kept as data", () => {
    expect(NAD_CERTIFICATIONS.map((item) => item.label)).toEqual(["Basic Staff", "Instructor", "Counselor", "Secretary/Treasurer", "Director"]);
    expect(new Set(NAD_CERTIFICATIONS.map((item) => item.key)).size).toBe(5);
  });

  it("recognises only listed keys", () => {
    expect(isNadCertificationKey("COUNSELOR")).toBe(true);
    expect(isNadCertificationKey("MASTER_GUIDE")).toBe(false);
    expect(isNadCertificationKey(undefined)).toBe(false);
    expect(certificationLabel("SECRETARY_TREASURER")).toBe("Secretary/Treasurer");
    expect(certificationLabel("OLD_KEY")).toBe("Unknown certification");
  });
});

describe("who may manage records, and for whom", () => {
  it("allows the director and deputy only", () => {
    expect(canManageStaffTraining(clubCapabilities("DIRECTOR"))).toBe(true);
    expect(canManageStaffTraining(clubCapabilities("DEPUTY"))).toBe(true);
    expect(canManageStaffTraining(clubCapabilities("REGISTRAR"))).toBe(false);
    expect(canManageStaffTraining(clubCapabilities("REPORTER"))).toBe(false);
  });

  it("applies to adult and staff roster types, not youth or underage", () => {
    expect(staffTrainingApplies("ADULT")).toBe(true);
    expect(staffTrainingApplies("STAFF")).toBe(true);
    expect(staffTrainingApplies("YOUTH")).toBe(false);
    expect(staffTrainingApplies("UNDERAGE")).toBe(false);
  });
});

describe("dates", () => {
  it("accepts only real calendar dates", () => {
    expect(isRealIsoDate("2026-02-28")).toBe(true);
    expect(isRealIsoDate("2026-02-30")).toBe(false);
    expect(isRealIsoDate("11/12/2026")).toBe(false);
    expect(isRealIsoDate("")).toBe(false);
  });

  it("accepts today and the past, and turns away the future and nonsense", () => {
    expect(completedOnProblem("2026-11-12", now)).toBeNull();
    expect(completedOnProblem("2019-06-01", now)).toBeNull();
    expect(completedOnProblem("2026-11-13", now)).toBeNull();
    expect(completedOnProblem("2026-11-14", now)).toMatch(/future/);
    expect(completedOnProblem("1960-01-01", now)).toMatch(/long ago/);
    expect(completedOnProblem("soon", now)).toMatch(/year, month and day/);
  });
});

describe("ordering and labels", () => {
  it("sorts newest completed date first, then latest entered, then id", () => {
    const sorted = sortRecordsNewestFirst([
      { id: "c", completedOn: "2024-05-01", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "a", completedOn: "2025-05-01", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", completedOn: "2024-05-01", createdAt: "2026-02-01T00:00:00.000Z" },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("names a certification by its level and a workshop by its code and title", () => {
    expect(recordLabel({ kind: "CERTIFICATION", certificationKey: "INSTRUCTOR", workshopCode: null, workshopTitle: null })).toBe("Instructor");
    expect(recordLabel({ kind: "WORKSHOP", certificationKey: null, workshopCode: "W-101", workshopTitle: "Campfire safety" })).toBe("W-101 Campfire safety");
    expect(recordAuditName({ kind: "WORKSHOP", certificationKey: null, workshopCode: "W-101" })).toBe("workshop W-101");
    expect(recordAuditName({ kind: "CERTIFICATION", certificationKey: "DIRECTOR", workshopCode: null })).toBe("certification Director");
  });
});

describe("validation of an add", () => {
  const cert = { personId: "person-1", kind: "CERTIFICATION", certificationKey: "COUNSELOR", completedOn: "2026-10-01" };
  const workshop = { personId: "person-1", kind: "WORKSHOP", workshopCode: "W-101", workshopTitle: "Campfire safety", completedOn: "2026-10-01", signedOffBy: "Pat Example" };
  const message = (body: unknown) => {
    try { parseStaffTrainingAdd(body, now); } catch (error) { return error instanceof ZodError ? error.issues[0]?.message : String(error); }
    return null;
  };

  it("accepts a certification and a workshop", () => {
    expect(parseStaffTrainingAdd(cert, now)).toMatchObject({ kind: "CERTIFICATION", certificationKey: "COUNSELOR" });
    expect(parseStaffTrainingAdd(workshop, now)).toMatchObject({ kind: "WORKSHOP", workshopCode: "W-101", signedOffBy: "Pat Example" });
  });

  it("treats a blank sign-off as none", () => {
    expect(parseStaffTrainingAdd({ ...cert, signedOffBy: "  " }, now).signedOffBy).toBeUndefined();
  });

  it("rejects an unlisted certification, a missing kind and a missing workshop title", () => {
    expect(message({ ...cert, certificationKey: "MASTER_GUIDE" })).toMatch(/certification/i);
    expect(message({ ...cert, certificationKey: undefined })).toMatch(/certification/i);
    expect(message({ personId: "person-1", completedOn: "2026-10-01" })).toMatch(/Certification or Workshop/);
    expect(message({ ...workshop, workshopTitle: "" })).toMatch(/title/);
  });

  it("rejects a workshop code with odd characters, over-long text and line breaks", () => {
    expect(message({ ...workshop, workshopCode: "<b>" })).toMatch(/code/);
    expect(message({ ...workshop, workshopTitle: "x".repeat(121) })).toMatch(/at most 120/);
    expect(message({ ...workshop, signedOffBy: "Pat\nExample" })).toMatch(/line breaks/);
  });

  it("rejects a future date, a bad date, and fields that do not belong", () => {
    expect(message({ ...cert, completedOn: "2027-01-01" })).toMatch(/future/);
    expect(message({ ...cert, completedOn: "yesterday" })).toMatch(/year, month and day/);
    expect(message({ ...cert, workshopCode: "W-101" })).not.toBeNull();
  });
});
