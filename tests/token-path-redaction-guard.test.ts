import { describe, expect, it } from "vitest";
import { redactTokenPath } from "@/lib/token-path";
import { tokenRoutePrefixes } from "@/lib/token-routes";

/**
 * Log redaction reads the same private-link route list as copied event text, so every listed route has its token segment
 * replaced in a logged path (and `tests/private-link-token-routes.test.ts` keeps that list complete).
 */
describe("log redaction covers every private link route", () => {
  it.each(tokenRoutePrefixes.map((prefix) => prefix.join("/")))("redacts /%s/<token>", (route) => {
    expect(redactTokenPath(`/${route}/synthetic-token-1`)).toBe(`/${route}/[redacted]`);
    expect(redactTokenPath(`/${route}/synthetic-token-1/next`)).toBe(`/${route}/[redacted]/next`);
  });

  it("leaves ordinary paths, the bare route and look-alikes alone", () => {
    expect(redactTokenPath("/clubs/register")).toBe("/clubs/register");
    expect(redactTokenPath("/clubs/register/")).toBe("/clubs/register/");
    expect(redactTokenPath("/clubs/forms")).toBe("/clubs/forms");
    expect(redactTokenPath("/pay/square")).toBe("/pay/square");
    expect(redactTokenPath("/admin/clubs/register/x")).toBe("/admin/clubs/register/x");
    expect(redactTokenPath("/api/events/e1/payments")).toBe("/api/events/e1/payments");
    expect(redactTokenPath("")).toBe("");
  });

  it("keeps the older names redacted with and without /api/public/", () => {
    expect(redactTokenPath("/api/public/staff-invite/abc")).toBe("/api/public/staff-invite/[redacted]");
    expect(redactTokenPath("/staff-invitations/abc")).toBe("/staff-invitations/[redacted]");
  });
});
