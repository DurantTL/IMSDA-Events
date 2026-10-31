import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));

import { SystemReportTesters } from "@/app/(workspace)/admin/system-report/system-report-testers";
import { MESSAGE_TEMPLATE_KEYS } from "@/modules/communications/templates";

/** #1383: the testers' markup, the migration, and that the new key is not an event template. */

describe("the tester cards", () => {
  const markup = renderToStaticMarkup(createElement(SystemReportTesters, { defaultEmail: "admin@example.org" }));

  it("shows both cards with the address prefilled and the copy from the approved mockup", () => {
    expect(markup).toContain('data-testid="email-tester"');
    expect(markup).toContain('data-testid="square-tester"');
    expect(markup).toMatch(/<input[^>]*type="email"[^>]*value="admin@example.org"/);
    expect(markup).toContain("Send test email");
    expect(markup).toContain("Starts as your own address. One address per test, up to 3 tests an hour.");
    expect(markup).toContain("Never charges a card and never refunds.");
    expect(markup).toContain("Run Square checks");
    expect(markup).toContain("Up to 5 runs an hour.");
    for (const row of ["Account", "Location", "Notice setup", "Test notice", "Pay on Square link"]) expect(markup).toContain(`<strong>${row}</strong>`);
    expect(markup.match(/Not run yet/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("leaves the $1 link test off until it is ticked", () => {
    const checkbox = markup.match(/<input[^>]*id="square-tester-link"[^>]*>/)?.[0] ?? "";
    expect(checkbox).toContain('type="checkbox"');
    expect(checkbox).not.toContain("checked");
  });

  it("labels the controls and uses real headings", () => {
    expect(markup).toMatch(/<label[^>]*for="email-tester-to"[^>]*>Send to<\/label>/);
    expect(markup).toContain("<h3");
  });
});

describe("the new template key", () => {
  it("is added by one additive migration that sorts after the latest", () => {
    const sql = readFileSync(new URL("../prisma/migrations/20261222100000_system_test_email_template_key/migration.sql", import.meta.url), "utf8");
    const statements = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n").split(";").map((part) => part.trim()).filter(Boolean);
    expect(statements).toEqual(["ALTER TYPE \"MessageTemplateKey\" ADD VALUE 'SYSTEM_TEST_EMAIL'"]);
    expect("20261222100000_system_test_email_template_key" > "20261221100000_system_job_summary").toBe(true);
  });

  it("is never offered as an editable event template", () => {
    expect(MESSAGE_TEMPLATE_KEYS as readonly string[]).not.toContain("SYSTEM_TEST_EMAIL");
  });
});
