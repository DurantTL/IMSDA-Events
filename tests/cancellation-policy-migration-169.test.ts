import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../prisma/migrations/20261019100000_cancellation_policy/migration.sql", import.meta.url),
  "utf8",
);

describe("cancellation policy migration (#169)", () => {
  it("is additive: two new tables and no change to anything that exists", () => {
    expect(migration.match(/CREATE TABLE "/g)).toHaveLength(2);
    expect(migration).not.toMatch(/DROP |ALTER TABLE "(?!EventCancellationPolicyVersion|CancellationCalculation)/);
    expect(migration).not.toMatch(/UPDATE "|DELETE FROM|TRUNCATE/);
  });

  it("keeps both tables append-only, with the one event-deletion exception", () => {
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "EventCancellationPolicyVersion"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "CancellationCalculation"');
    expect(migration).toContain("current_setting('imsda.event_deletion', true) = 'on'");
    expect(migration).toContain("RAISE EXCEPTION");
  });

  it("restricts deletes of the parents it cites and does not link calculations to registrations", () => {
    expect(migration.match(/ON DELETE RESTRICT ON UPDATE CASCADE;/g)).toHaveLength(3);
    expect(migration).not.toContain("ON DELETE CASCADE");
    expect(migration).not.toContain('REFERENCES "Registration"');
  });
});
