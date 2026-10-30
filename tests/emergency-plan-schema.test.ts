import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { readdirSync, readFileSync } from "node:fs";

/**
 * The emergency plan models carry no personal-data joins (#114): staff-entered
 * operational data only. Read from Prisma's own data model, so a new relation
 * field fails here.
 */
const models = Prisma.dmmf.datamodel.models.filter((model) => model.name.startsWith("EmergencyPlan"));

// The only models an emergency plan table may point at: the event it belongs to, its own tables, and the staff user who published.
const allowedRelationTargets = new Set(["Event", "EmergencyPlan", "EmergencyPlanLocation", "EmergencyPlanProcedure", "EmergencyPlanContact", "EmergencyPlanVersion", "User"]);
const personalDataModels = ["Person", "Registration", "RegistrationAttendee", "Attendee", "HealthRecord", "HealthRecordSnapshot", "GuardianAuthority", "Incident"];

describe("emergency plan data model", () => {
  it("defines the five tables", () => {
    expect(models.map((model) => model.name).sort()).toEqual(["EmergencyPlan", "EmergencyPlanContact", "EmergencyPlanLocation", "EmergencyPlanProcedure", "EmergencyPlanVersion"]);
  });

  it("has no relation to a person, registration, health, custody or incident model", () => {
    for (const model of models) {
      for (const field of model.fields.filter((entry) => entry.kind === "object")) {
        expect(allowedRelationTargets.has(field.type), `${model.name}.${field.name} -> ${field.type}`).toBe(true);
        expect(personalDataModels).not.toContain(field.type);
      }
    }
  });

  it("reaches a user only to record who published a version", () => {
    const userRelations = models.flatMap((model) => model.fields.filter((field) => field.type === "User").map((field) => `${model.name}.${field.name}`));
    expect(userRelations).toEqual(["EmergencyPlanVersion.publishedBy"]);
  });

  it("has no scalar column that points at a person, registration, or health record", () => {
    for (const model of models) {
      for (const field of model.fields.filter((entry) => entry.kind === "scalar")) {
        expect(field.name, `${model.name}.${field.name}`).not.toMatch(/person|registration|attendee|health|guardian|custody|incident|medical/i);
      }
    }
  });

  it("is added by an additive migration that only creates", () => {
    const folders = readdirSync("prisma/migrations").filter((name) => /^\d{14}_/.test(name)).sort();
    const folder = "20261217100000_event_emergency_plans";
    expect(folders.indexOf(folder)).toBe(folders.length - 1);
    const sql = readFileSync(`prisma/migrations/${folder}/migration.sql`, "utf8");
    expect(sql).not.toMatch(/DROP |RENAME |ALTER TABLE "(?!Emergency)/i);
    expect(sql).toContain('CREATE TABLE "EmergencyPlanVersion"');
    expect(sql).toContain('CREATE UNIQUE INDEX "EmergencyPlanVersion_planId_versionNumber_key"');
  });
});
