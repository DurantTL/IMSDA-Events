import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddToCalendarLink, addToCalendarLabel } from "@/components/add-to-calendar-link";

const css = readFileSync("app/globals.css", "utf8");
const read = (path: string) => readFileSync(path, "utf8");

describe("small confirmations (#1211)", () => {
  it("renders the same download link, with an empty polite status until it is used", () => {
    const markup = renderToStaticMarkup(createElement(AddToCalendarLink, { href: "/events/synthetic/event.ics", label: "Add to my calendar" }));
    expect(markup).toContain('href="/events/synthetic/event.ics"');
    expect(markup).toContain("Add to my calendar");
    expect(markup).not.toContain("Added");
    expect(markup).toMatch(/<span aria-live="polite" class="sr-only" role="status"><\/span>/);
  });

  it("changes the label to Added after use", () => {
    expect(addToCalendarLabel(false, "Add to my calendar")).toBe("Add to my calendar");
    expect(addToCalendarLabel(true, "Add to my calendar")).toBe("Added");
    const source = read("components/add-to-calendar-link.tsx");
    expect(source).toContain('onClick={() => setAdded(true)}');
    expect(source).not.toContain("preventDefault");
    expect(source).toContain('aria-hidden="true"> ✓');
  });

  it("says Copied ✓ and Added ✓ in the calendar subscribe menu", () => {
    const source = read("components/calendar-subscribe.tsx");
    expect(source).toContain('"Copied"');
    expect(source).toContain('"Added"');
  });

  it("draws the check only when motion is allowed, briefly and once", () => {
    const start = css.indexOf("/* Small confirmations (#1211)");
    const end = css.indexOf("/* Registration form builder editor shell (#1132)");
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(end);
    const block = css.slice(start, end);
    expect(block).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*confirm-check-pop 0\.4s ease-out 1/);
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none/);
    expect(block).not.toContain("infinite");
    // Every animation rule sits inside the no-preference block.
    const outside = block.slice(0, block.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(outside).not.toMatch(/animation:/);
  });

  it("moves focus to the confirmation heading and animates the confirmed icons", () => {
    expect(read("components/public-registration-form.tsx")).toContain("ref={focusConfirmationHeading} tabIndex={-1}");
    expect(read("components/square-return-status.tsx")).toContain("confirm-check-icon");
    expect(read("components/public-square-payment.tsx")).toContain("confirm-check-icon");
  });
});
