import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../prisma/migrations/20270196100000_staff_draft_attendees/migration.sql", import.meta.url),
  "utf8",
);
const statements = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .trim();
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

describe("staff draft people migration (#1510)", () => {
  it("adds one column with an empty-list default, and nothing else", () => {
    expect(statements).toBe(`ALTER TABLE "StaffRegistrationDraft" ADD COLUMN "attendees" JSONB NOT NULL DEFAULT '[]';`);
  });

  it("matches the schema", () => {
    const model = schema.slice(schema.indexOf("model StaffRegistrationDraft {"));
    expect(model.slice(0, model.indexOf("\n}"))).toMatch(/\n\s+attendees\s+Json\s+@default\("\[\]"\)/);
  });
});
