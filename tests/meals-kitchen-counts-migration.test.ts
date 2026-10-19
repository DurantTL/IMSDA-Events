import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("prisma/migrations/20261112100000_meal_kitchen_counts/migration.sql", "utf8");

describe("kitchen counts migration (#1029)", () => {
  it("is additive: new enum values, one enum and one table, nothing altered or dropped", () => {
    expect(sql).toContain(`ALTER TYPE "EventRole" ADD VALUE 'KITCHEN_STAFF'`);
    expect(sql).toContain(`ALTER TYPE "EventPermission" ADD VALUE 'MANAGE_KITCHEN_COUNTS'`);
    expect(sql).not.toMatch(/DROP |DELETE FROM|UPDATE "|ALTER TABLE "(?!EventMealKitchenCount)/);
  });

  it("makes the table append-only with the shared meal history trigger, and forbids forks and cross-service corrections", () => {
    expect(sql).toContain(`BEFORE UPDATE OR DELETE ON "EventMealKitchenCount" FOR EACH ROW EXECUTE FUNCTION "EventMealHistory_append_only"()`);
    expect(sql).toContain(`CREATE UNIQUE INDEX "EventMealKitchenCount_supersedesId_key"`);
    expect(sql).toContain(`WHERE "supersedesId" IS NULL`);
    expect(sql).toContain("EventMealKitchenCount_supersedes_same_chain");
    expect(sql).toContain(`"quantity" >= 0`);
  });
});
