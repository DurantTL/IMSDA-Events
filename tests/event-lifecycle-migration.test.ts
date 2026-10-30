import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("prisma/migrations/20261218100000_event_lifecycle_states/migration.sql", "utf8");
const statements = sql.replace(/--.*$/gm, "");

describe("event lifecycle migration (#156)", () => {
  it("is additive: nothing is dropped, renamed, rewritten or backfilled", () => {
    expect(statements).not.toMatch(/\bDROP\b|\bRENAME\b|\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/\bUPDATE\s+"Event"/i);
    expect(statements).not.toMatch(/\bINSERT\b/i);
    expect(statements).not.toMatch(/ALTER COLUMN|SET NOT NULL/i);
  });

  it("adds a nullable state, so a legacy event keeps null, and a version that starts at 0", () => {
    expect(statements).toContain('ADD COLUMN "lifecycleState" "EventLifecycleState",');
    expect(statements).toContain('ADD COLUMN "lifecycleVersion" INTEGER NOT NULL DEFAULT 0');
  });

  it("never stores ARCHIVED on the event", () => {
    expect(statements).toContain(`CHECK ("lifecycleState" IS NULL OR "lifecycleState" <> 'ARCHIVED')`);
  });

  it("keeps the actor as a plain id with no foreign key, and removes history only with its event", () => {
    expect(statements).not.toMatch(/FOREIGN KEY \("actorUserId"\)/);
    expect(statements).toContain('FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE');
    expect(statements).toContain("TG_OP = 'UPDATE'");
    expect(statements).toContain("current_setting('imsda.event_deletion', true)");
    expect(statements).toContain('BEFORE UPDATE OR DELETE ON "EventLifecycleTransition"');
  });
});
