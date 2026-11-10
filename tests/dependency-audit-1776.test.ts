import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyExceptions, isAuditReport, seriousAdvisories } from "../scripts/audit-production-dependencies.mjs";

/** #1776: the weekly dependency check fails on a new high or critical advisory and only accepts listed ones. */

const report = {
  vulnerabilities: {
    alpha: { name: "alpha", via: [{ name: "alpha", severity: "high", title: "Alpha problem", url: "https://github.com/advisories/GHSA-aaaa-aaaa-aaaa" }] },
    beta: { name: "beta", via: ["alpha", { name: "beta", severity: "moderate", title: "Beta problem", url: "https://github.com/advisories/GHSA-bbbb-bbbb-bbbb" }] },
    gamma: { name: "gamma", via: [{ name: "gamma", severity: "critical", title: "Gamma problem", url: "https://github.com/advisories/GHSA-cccc-cccc-cccc" }] },
    delta: { name: "delta", via: [{ name: "alpha", severity: "high", title: "Alpha problem", url: "https://github.com/advisories/GHSA-aaaa-aaaa-aaaa" }] },
  },
};

describe("weekly dependency audit (#1776)", () => {
  it("lists each high or critical advisory once and ignores lower ones", () => {
    expect(seriousAdvisories(report).map((advisory: { id: string }) => advisory.id)).toEqual(["GHSA-aaaa-aaaa-aaaa", "GHSA-cccc-cccc-cccc"]);
    expect(seriousAdvisories({})).toEqual([]);
  });

  it("fails on an advisory that is not listed, and reports an exception that matches nothing", () => {
    const result = applyExceptions(seriousAdvisories(report), [{ id: "GHSA-aaaa-aaaa-aaaa" }, { id: "GHSA-zzzz-zzzz-zzzz" }]);
    expect(result.failing.map((advisory: { id: string }) => advisory.id)).toEqual(["GHSA-cccc-cccc-cccc"]);
    expect(result.excepted.map((advisory: { id: string }) => advisory.id)).toEqual(["GHSA-aaaa-aaaa-aaaa"]);
    expect(result.unused).toEqual([{ id: "GHSA-zzzz-zzzz-zzzz" }]);
  });

  it("only accepts a report it understands, so a changed or failed audit never passes as clean", () => {
    expect(isAuditReport({ auditReportVersion: 2, ...report })).toBe(true);
    expect(isAuditReport({ auditReportVersion: 2, vulnerabilities: {} })).toBe(true);
    for (const bad of [null, {}, { vulnerabilities: {} }, { auditReportVersion: 3, vulnerabilities: {} }, { auditReportVersion: 2 }, { auditReportVersion: 2, vulnerabilities: {}, error: { code: "ENOTFOUND" } }]) {
      expect(isAuditReport(bad)).toBe(false);
    }
  });

  it("gives every exception an advisory id, a reason and a date", () => {
    const { exceptions } = JSON.parse(readFileSync(path.join(process.cwd(), ".github/dependency-audit-exceptions.json"), "utf8"));
    for (const exception of exceptions) {
      expect(exception.id).toMatch(/^GHSA(-[a-z0-9]{4}){3}$/);
      expect(exception.reason.length).toBeGreaterThan(20);
      expect(exception.added).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("runs weekly and by hand, never on pull requests", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/dependency-audit.yml"), "utf8");
    expect(workflow).toMatch(/schedule:\s+- cron:/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/pull_request|push:/);
    expect(workflow).toContain("npm run audit:production");
  });
});
