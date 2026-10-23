import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("prisma/migrations/20261127100000_meal_closeout_reviews/migration.sql", "utf8");

describe("meal closeout reviews migration (#212)", () => {
  it("is additive: one enum and one table, nothing altered or dropped", () => {
    expect(sql).toContain(`CREATE TYPE "MealCloseoutReviewStatus"`);
    expect(sql).toContain(`CREATE TABLE "EventMealCloseoutReview"`);
    expect(sql).not.toMatch(/DROP |DELETE FROM|UPDATE "|ALTER TYPE|ALTER TABLE "(?!EventMealCloseoutReview)/);
  });

  it("makes reviews append-only with the shared meal history trigger and bounds the note", () => {
    expect(sql).toContain(`BEFORE UPDATE OR DELETE ON "EventMealCloseoutReview" FOR EACH ROW EXECUTE FUNCTION "EventMealHistory_append_only"()`);
    expect(sql).toContain(`length("note") > 0 AND length("note") <= 1000`);
  });
});
