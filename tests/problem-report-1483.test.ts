// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildProblemReportDetails,
  problemReportDetailsSchema,
  problemReportInputSchema,
  problemReportReference,
  problemReportStatusLabel,
  sanitizePagePath,
  PROBLEM_REPORT_MESSAGE_MAX,
  type BrowserFacts,
} from "@/modules/support/problem-report-domain";
import { EMAIL_FIELD_MESSAGE } from "@/lib/field-validation";
import { openProblemReportFields } from "@/modules/system-admin/system-report/problem-report-signal";
import { ProblemReportSection } from "@/components/problem-report-form";
import { FormsHelpSections } from "@/components/forms-help";

/** #1483: what a problem report may carry. Synthetic data only. */

const facts: BrowserFacts = {
  href: "/events/camp-meeting/register?name=Sam+Example&email=sam%40example.test&code=ABC123#step-2",
  userAgent: "Mozilla/5.0 (Synthetic Test Browser)",
  language: "en-US",
  htmlClassName: "translated-ltr",
  innerWidth: 390,
  innerHeight: 844,
  securityCheckLoadFailed: true,
  squareLoadFailed: false,
  now: new Date("2026-11-08T15:00:00Z"),
};

describe("page path", () => {
  it("drops the origin, the query values and the hash", () => {
    expect(sanitizePagePath("https://events.example.test/events/camp-meeting/register?name=Sam&email=sam%40example.test#x")).toBe("/events/camp-meeting/register");
    expect(sanitizePagePath(facts.href)).toBe("/events/camp-meeting/register");
  });
  it("replaces a private link token and any long token-like segment", () => {
    expect(sanitizePagePath("/manage/abcDEF123")).toBe("/manage/[redacted]");
    expect(sanitizePagePath("/club-forms/short/next")).toBe("/club-forms/[redacted]");
    expect(sanitizePagePath("/reset-password/aaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe("/reset-password/[redacted]");
  });
  it("cuts everything after health-records, pass, pay and clubs/register", () => {
    expect(sanitizePagePath("/health-records/abc/def")).toBe("/health-records/[redacted]");
    expect(sanitizePagePath("/pass/ticket-1/qr")).toBe("/pass/[redacted]");
    expect(sanitizePagePath("/pay/inv-77/card")).toBe("/pay/[redacted]");
    expect(sanitizePagePath("/clubs/register/some-token/next")).toBe("/clubs/register/[redacted]");
    expect(sanitizePagePath("/clubs/forms")).toBe("/clubs/forms");
    expect(sanitizePagePath("/register/womens-retreat-2026")).toBe("/register/womens-retreat-2026");
  });
  it("redacts a UUID segment and any segment with an email address", () => {
    expect(sanitizePagePath("/people/3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b/edit")).toBe("/people/[redacted]/edit");
    expect(sanitizePagePath("/lookup/sam@example.test")).toBe("/lookup/[redacted]");
    expect(sanitizePagePath("/lookup/sam%40example.test/x")).toBe("/lookup/[redacted]/x");
  });
  it("keeps a long readable form slug", () => {
    expect(sanitizePagePath("/register/womens-retreat-2026/womens-retreat-registration")).toBe("/register/womens-retreat-2026/womens-retreat-registration");
  });
  it("redacts a real 43-character base64url token and a mixed-case run", () => {
    const token = "Zk3_8vQpL0aXr-N2tYw9bHc4dEf7GhJiKmOpQrStUvW".slice(0, 43);
    expect(token).toHaveLength(43);
    expect(sanitizePagePath(`/some/page/${token}`)).toBe("/some/page/[redacted]");
    expect(sanitizePagePath("/some/page/AbCdEfGhIjKlMnOpQrStUv")).toBe("/some/page/[redacted]");
    expect(sanitizePagePath("/some/page/abcdefghijklmnopqrstuvwx")).toBe("/some/page/[redacted]");
  });
});

describe("technical details never carry private content", () => {
  it("is built only from the listed browser facts", () => {
    const details = buildProblemReportDetails(facts);
    expect(details).toEqual({
      path: "/events/camp-meeting/register",
      clientTime: "2026-11-08T15:00:00.000Z",
      userAgent: "Mozilla/5.0 (Synthetic Test Browser)",
      language: "en-US",
      translation: "on",
      viewport: "390x844",
      securityCheckBlocked: true,
      squareBlocked: false,
    });
    const json = JSON.stringify(details);
    for (const secret of ["Sam", "example.test", "ABC123", "step-2"]) expect(json).not.toContain(secret);
  });

  it("never reads form fields, cookies, storage or tokens from the page", () => {
    document.cookie = "session=SECRET-COOKIE-VALUE";
    window.localStorage.setItem("token", "SECRET-STORAGE-TOKEN");
    document.body.innerHTML = '<form><input name="allergies" value="SECRET-MEDICAL-ANSWER"><input name="card" value="4111111111111111"><input type="password" value="SECRET-PASSWORD"></form>';
    // The collector is a pure function of BrowserFacts; the one reader of the page is `readBrowserFacts`.
    const source = [
      buildProblemReportDetails(facts),
      buildProblemReportDetails({ ...facts, href: "/sign-in?password=SECRET-PASSWORD&token=SECRET-QUERY-TOKEN" }),
    ];
    const json = JSON.stringify(source);
    for (const secret of ["SECRET-COOKIE-VALUE", "SECRET-STORAGE-TOKEN", "SECRET-MEDICAL-ANSWER", "4111111111111111", "SECRET-PASSWORD", "SECRET-QUERY-TOKEN"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("the page reader touches only the fixed list of properties", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/problem-report-form.tsx", "utf8");
    const reader = source.slice(source.indexOf("export function readBrowserFacts"), source.indexOf("type Config"));
    for (const forbidden of ["document.cookie", "localStorage", "sessionStorage", "FormData", "querySelectorAll", "value", "headers", "Authorization", "location.search", "location.hash", "location.href"]) {
      expect(reader, forbidden).not.toContain(forbidden);
    }
  });

  it("the server schema drops every field that is not on the list", () => {
    const parsed = problemReportDetailsSchema.parse({
      ...buildProblemReportDetails(facts),
      cookie: "session=SECRET-COOKIE-VALUE",
      formData: { allergies: "SECRET-MEDICAL-ANSWER" },
      authorization: "Bearer SECRET-TOKEN",
      password: "SECRET-PASSWORD",
      path: "/a/b?secret=SECRET-QUERY#hash",
    });
    const json = JSON.stringify(parsed);
    for (const secret of ["SECRET-COOKIE-VALUE", "SECRET-MEDICAL-ANSWER", "SECRET-TOKEN", "SECRET-PASSWORD", "SECRET-QUERY", "hash"]) expect(json).not.toContain(secret);
    expect(parsed.path).toBe("/a/b");
    expect(Object.keys(parsed).sort()).toEqual(["clientTime", "language", "path", "securityCheckBlocked", "squareBlocked", "translation", "userAgent", "viewport"]);
  });
});

describe("a bad detail field never costs the person their report", () => {
  it("drops only the invalid fields and keeps the rest", () => {
    const parsed = problemReportDetailsSchema.parse({ viewport: "390x0", clientTime: "not a time", language: "en-US", translation: "maybe", securityCheckBlocked: "yes", path: "/a?b=c" });
    expect(parsed).toEqual({ language: "en-US", path: "/a" });
  });
  it("accepts a report whose details are garbage, saving it without them", () => {
    const parsed = problemReportInputSchema.parse({ message: "The page froze.", details: "garbage", website: "" });
    expect(parsed.details).toBeNull();
    const partial = problemReportInputSchema.parse({ message: "The page froze.", details: { viewport: "390x0", language: "en" }, website: "" });
    expect(partial.details).toEqual({ language: "en" });
  });
});

describe("the report itself", () => {
  const ok = { message: "The Submit button did nothing.", website: "" };
  it("needs a message and limits its length", () => {
    expect(problemReportInputSchema.safeParse(ok).success).toBe(true);
    expect(problemReportInputSchema.safeParse({ ...ok, message: "   " }).success).toBe(false);
    expect(problemReportInputSchema.safeParse({ ...ok, message: "x".repeat(PROBLEM_REPORT_MESSAGE_MAX + 1) }).success).toBe(false);
    expect(problemReportInputSchema.safeParse({ ...ok, message: "x".repeat(PROBLEM_REPORT_MESSAGE_MAX) }).success).toBe(true);
  });
  it("takes an email or none, and refuses a bad one", () => {
    expect(problemReportInputSchema.parse({ ...ok, email: "" }).email).toBeUndefined();
    expect(problemReportInputSchema.parse({ ...ok, email: " sam@example.test " }).email).toBe("sam@example.test");
    const bad = problemReportInputSchema.safeParse({ ...ok, email: "not-an-email" });
    expect(bad.success).toBe(false);
    expect(!bad.success && bad.error.issues[0]?.message).toBe(EMAIL_FIELD_MESSAGE);
    expect(!bad.success && bad.error.issues[0]?.path[0]).toBe("email");
  });
  it("accepts no details when the box is off, and refuses a filled honeypot", () => {
    expect(problemReportInputSchema.parse({ ...ok, details: null }).details).toBeNull();
    expect(problemReportInputSchema.safeParse({ ...ok, website: "http://spam.example" }).success).toBe(false);
  });
  it("gives the reference and the shared status words", () => {
    expect(problemReportReference(1234)).toBe("P-1234");
    expect(problemReportStatusLabel).toEqual({ OPEN: "Submitted", RESOLVED: "Completed" });
  });
});

describe("the System report row", () => {
  const now = new Date("2026-11-08T15:00:00Z");
  it("is OK with none open and a watch with some, as a count only", () => {
    expect(openProblemReportFields({ openCount: 0, now })).toMatchObject({ key: "open-problem-reports", state: "ok" });
    const some = openProblemReportFields({ openCount: 2, now });
    expect(some.state).toBe("watch");
    expect(some.resultText).toBe("2 problem reports are open.");
    expect(openProblemReportFields({ openCount: 1, now }).resultText).toBe("1 problem report is open.");
  });
});

describe("the popup section", () => {
  const html = renderToStaticMarkup(createElement(ProblemReportSection));
  it("asks what happened, for an optional email and for the details, on by default", () => {
    expect(html).toContain("Report a problem");
    expect(html).toContain("What happened?");
    expect(html).toMatch(/<textarea[^>]*required/);
    expect(html).toMatch(/<input[^>]*type="email"/);
    expect(html).toContain('for="problem-report-message"');
    expect(html).toMatch(/<input[^>]*checked=""[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(html).toContain("Include technical details");
  });
  it("is collapsed and is the fourth section of Forms help", () => {
    expect(html).not.toMatch(/<details[^>]* open/);
    const sections = renderToStaticMarkup(createElement(FormsHelpSections, { contact: { email: "help@example.test", phone: "(515) 555-0100" } }));
    expect(sections.match(/<details/g)).toHaveLength(4);
  });
});
