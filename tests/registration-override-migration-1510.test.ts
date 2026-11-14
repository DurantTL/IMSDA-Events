import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("prisma/migrations/20270187100000_registration_rule_override_permission/migration.sql", "utf8");

describe("registration override permission migration (#1510)", () => {
  it("adds one enum value and nothing else", () => {
    expect(sql).toContain(`ALTER TYPE "EventPermission" ADD VALUE 'OVERRIDE_REGISTRATION_RULES'`);
    expect(sql).not.toMatch(/DROP |DELETE FROM|UPDATE "|ALTER TABLE|CREATE /);
  });
});
