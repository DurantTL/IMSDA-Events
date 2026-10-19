import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #171: carrying out is human-only and additive. Static checks over the files, because the real-database harness
 * (`npm run test:cancellation-requests`) is run by hand. Synthetic data only.
 */

const root = path.join(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const folder = "20261113100000_cancellation_execution";
const migration = read(`prisma/migrations/${folder}/migration.sql`);

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const relative = (file: string) => path.relative(root, file).split(path.sep).join("/");

describe("only a named staff member's button press carries a cancellation out", () => {
  const sources = ["app", "modules", "lib", "components", "scripts"].flatMap((dir) => walk(path.join(root, dir))).filter((file) => /\.(ts|tsx|mjs|cjs)$/.test(file));

  it("is called from the staff route and nowhere else (the real-database harness is run by hand)", () => {
    const callers = sources.filter((file) => read(relative(file)).includes("carryOutCancellation(")).map(relative).sort();
    expect(callers).toEqual([
      "app/api/events/[eventId]/cancellation-requests/[requestId]/carry-out/route.ts",
      "modules/cancellation-execution/repository.ts",
      "scripts/verify-cancellation-requests.ts",
      "scripts/verify-mobile-layout.ts",
    ]);
  });

  it("is not imported by any scheduler, worker, webhook, cron or the approval workflow", () => {
    const importers = sources.filter((file) => /cancellation-execution\/repository/.test(read(relative(file)))).map(relative).sort();
    expect(importers).toEqual([
      "app/(workspace)/finance/cancellation-requests/page.tsx",
      "app/api/events/[eventId]/cancellation-requests/[requestId]/carry-out/route.ts",
      "modules/cancellation-execution/api.ts",
      "scripts/verify-cancellation-requests.ts",
      "scripts/verify-mobile-layout.ts",
    ]);
    // The page only reads (getCarryOutPanel).
    expect(read("app/(workspace)/finance/cancellation-requests/page.tsx")).not.toContain("carryOutCancellation");
    expect(read("modules/cancellation-requests/repository.ts")).not.toMatch(/cancellation-execution|lifecycle|payments\//);
  });

  it("requires MANAGE_FINANCE and takes the actor from the session, never the body", () => {
    const route = read("app/api/events/[eventId]/cancellation-requests/[requestId]/carry-out/route.ts");
    expect(route.match(/"MANAGE_FINANCE"/g)).toHaveLength(2);
    expect(route).toContain("{ userId: access.user.id }");
    expect(route).toContain("rejectCrossOriginRequest");
  });

  it("calls the Square refund only from the execution repository", () => {
    const callers = sources.filter((file) => /createSquareRefund\(/.test(read(relative(file)))).map(relative).sort();
    expect(callers).toEqual(["modules/cancellation-execution/repository.ts", "modules/payments/square-adapter.ts"]);
  });

  it("keeps ids and amounts only in the execution audit entries", () => {
    const source = read("modules/cancellation-execution/repository.ts");
    expect(source).not.toMatch(/metadata: \{[^}]*(reason|displayName|email|note)\b/);
  });
});

describe("the execution migration is additive and the database holds the line (#171)", () => {
  it("is in its own folder, once", () => {
    const names = readdirSync(path.join(root, "prisma", "migrations")).filter((name) => /^\d{14}_/.test(name));
    expect(names.filter((name) => name === folder)).toHaveLength(1);
    expect(folder > "20261109110000_cancellation_requests").toBe(true);
  });

  it("only adds: three enums, two tables, one nullable column, and constraints on the new tables", () => {
    expect(migration.match(/CREATE TABLE "/g)).toHaveLength(2);
    expect(migration.match(/CREATE TYPE "/g)).toHaveLength(3);
    expect(migration.match(/ALTER TABLE "CancellationRequest" ADD COLUMN/g)).toHaveLength(1);
    expect(migration).not.toMatch(/DROP |TRUNCATE|DELETE FROM|UPDATE "|ALTER TYPE/);
    expect(migration).not.toMatch(/ALTER TABLE "(?!CancellationRequest" ADD COLUMN|CancellationExecution(?:Refund)?")/);
    expect(migration).not.toMatch(/CancellationRequest_final_once_decided|reject_decided_cancellation_request_change/);
  });

  it("limits refunds to the approved amount, requires an approved request, and fixes the snapshot", () => {
    expect(migration).toContain("The refunds of a cancellation execution cannot add up to more than the approved refund");
    expect(migration).toContain("request_row.\"status\" <> 'APPROVED'");
    expect(migration).toContain("The approved snapshot of a cancellation execution cannot be changed");
    expect(migration).toContain("A completed cancellation refund cannot be reopened");
    expect(migration).toContain('CREATE UNIQUE INDEX "CancellationExecutionRefund_idempotencyKey_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "CancellationExecution_requestId_key"');
  });

  it("is removed with its event, refund legs first", () => {
    const source = read("modules/events/deletion-repository.ts");
    const legs = source.indexOf("cancellationExecutionRefund.deleteMany");
    const executions = source.indexOf("cancellationExecution.deleteMany");
    const requests = source.indexOf("cancellationRequest.deleteMany");
    expect(legs).toBeGreaterThan(0);
    expect(legs).toBeLessThan(executions);
    expect(executions).toBeLessThan(requests);
  });
});
