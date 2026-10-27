import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Layer one of the ledger's append-only rule (#117): no code path may update or delete a ledger entry. (Layer two is the
// database trigger, proven by scripts/verify-ledger-shadow.ts.) A correction is a new entry.

const root = path.join(__dirname, "..");
const scanned = ["modules", "app", "scripts", "prisma"];
const skip = new Set(["node_modules", ".next", "migrations"]);
const forbidden = /registrationLedgerEntry\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/;
const rawMutation = /(UPDATE|DELETE\s+FROM)\s+"RegistrationLedgerEntry"/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|js|mjs|cjs|sql)$/.test(name) ? [full] : [];
  });
}

describe("ledger entries are append-only in code", () => {
  const files = scanned.flatMap((dir) => walk(path.join(root, dir)));

  it("scans the code it is meant to scan", () => {
    expect(files.some((file) => file.endsWith(path.join("modules", "ledger", "entries.ts")))).toBe(true);
    expect(files.length).toBeGreaterThan(100);
  });

  it("never calls update, updateMany, upsert, delete or deleteMany on the ledger delegate", () => {
    const offenders = files.filter((file) => forbidden.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });

  it("never writes raw SQL that changes a ledger row, outside the one script that proves the trigger refuses it", () => {
    const allowed = path.join("scripts", "verify-ledger-shadow.ts");
    const offenders = files
      .filter((file) => !file.endsWith(allowed) && !file.endsWith(path.join("tests", "ledger-append-only-guard.test.ts")))
      .filter((file) => rawMutation.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });

  it("the guard itself recognises a mutation", () => {
    expect(forbidden.test("await tx.registrationLedgerEntry.update({})")).toBe(true);
    expect(forbidden.test("await tx.registrationLedgerEntry.deleteMany({})")).toBe(true);
    expect(forbidden.test("await tx.registrationLedgerEntry.create({})")).toBe(false);
    expect(forbidden.test("await tx.registrationLedgerEntry.createMany({})")).toBe(false);
  });

  it("the migration refuses every UPDATE and a DELETE that is not the foreign key's cascade", () => {
    const migrations = path.join(root, "prisma", "migrations");
    const folder = readdirSync(migrations).find((name) => name.endsWith("_registration_ledger_entries"));
    expect(folder).toBeDefined();
    const sql = readFileSync(path.join(migrations, folder!, "migration.sql"), "utf8");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON \"RegistrationLedgerEntry\"");
    expect(sql).toContain("pg_trigger_depth() > 1");
    expect(sql).toContain("CHECK (");
  });
});
