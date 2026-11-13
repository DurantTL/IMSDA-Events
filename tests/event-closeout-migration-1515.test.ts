import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("prisma/migrations/20270157100000_event_closeout_signoffs/migration.sql", "utf8");
const statements = sql.replace(/--.*$/gm, "");

describe("event closeout migration (#1515)", () => {
  it("is additive: two new tables, nothing dropped, rewritten or backfilled", () => {
    expect(statements).not.toMatch(/\bDROP\b|\bRENAME\b|\bTRUNCATE\b|\bINSERT\b|ALTER COLUMN/i);
    expect(statements).not.toMatch(/ALTER TABLE "Event"\s/);
    expect(statements).toContain('CREATE TABLE "EventCloseoutSignoff"');
    expect(statements).toContain('CREATE TABLE "EventCloseoutReopening"');
  });

  it("keeps people as plain ids (no foreign key), and a name snapshot", () => {
    expect(statements).not.toMatch(/FOREIGN KEY \("(signedByUserId|reopenedByUserId)"\)/);
    expect(statements).toContain('"signedByNameSnapshot" TEXT NOT NULL');
    expect(statements).toContain('"reopenedByNameSnapshot" TEXT NOT NULL');
  });

  it("makes both tables append-only, deleted only with their event", () => {
    expect(statements).toContain("TG_OP = 'UPDATE'");
    expect(statements).toContain("current_setting('imsda.event_deletion', true)");
    expect(statements).toContain('BEFORE UPDATE OR DELETE ON "EventCloseoutSignoff"');
    expect(statements).toContain('BEFORE UPDATE OR DELETE ON "EventCloseoutReopening"');
  });

  it("requires a reason to reopen", () => {
    expect(statements).toContain('"reason" TEXT NOT NULL');
    expect(statements).toContain("length(btrim(\"reason\")) > 0");
  });
});
