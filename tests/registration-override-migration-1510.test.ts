import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("prisma/migrations/20270187100000_registration_rule_override_permission/migration.sql", "utf8");

describe("registration override permission migration (#1510)", () => {
  it("adds one enum value and one nullable column with a set-null foreign key, and nothing else", () => {
    expect(sql).toContain(`ALTER TYPE "EventPermission" ADD VALUE 'OVERRIDE_REGISTRATION_RULES'`);
    expect(sql).toContain(`ALTER TABLE "StaffRegistrationDraft" ADD COLUMN "submittedByUserId" TEXT;`);
    expect(sql).toContain(`FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE`);
    expect(sql).not.toMatch(/DROP |DELETE FROM|UPDATE "|NOT NULL|CREATE /);
    expect(sql.match(/ALTER TABLE/g)).toHaveLength(2);
  });

  it("does not use the new enum value in the same migration", () => {
    expect(sql.split("OVERRIDE_REGISTRATION_RULES")).toHaveLength(2);
  });
});
