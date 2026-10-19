import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * #1017: the alert recipients box ties its error message to the textarea, so a screen reader announces it with the
 * field. There is no DOM in this suite, so the component's state is forced: useState returns its initial value, except
 * the error (the third state, after the text and the saving flag), which the test sets.
 */
const forced = vi.hoisted(() => ({ error: "", calls: 0 }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      forced.calls += 1;
      // The component's useState calls in order: text, saving, error, notice. Render passes use 1..4.
      const position = ((forced.calls - 1) % 4) + 1;
      return [position === 3 ? forced.error : typeof initial === "function" ? (initial as () => unknown)() : initial, vi.fn()];
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ClubFormAlertRecipients } from "@/components/club-form-alert-recipients";

function render(error: string) {
  forced.error = error;
  forced.calls = 0;
  return renderToStaticMarkup(createElement(ClubFormAlertRecipients, { templateKey: "synthetic_form", initialEmails: ["office@imsda-events.test"] }));
}

describe("the alert recipients box announces its error with the field (#1017)", () => {
  it("with no error, the textarea is valid and points only at the help and status", () => {
    const html = render("");
    expect(html).toContain('aria-invalid="false"');
    expect(html).toContain('aria-describedby="club-form-alerts-help club-form-alerts-status"');
    expect(html).not.toContain("club-form-alerts-error");
  });

  it("with an error, the textarea is invalid and described by the message, which has that id", () => {
    const html = render('"nope" is not a valid email address.');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="club-form-alerts-help club-form-alerts-status club-form-alerts-error"');
    expect(html).toMatch(/id="club-form-alerts-error"[^>]*role="alert"|role="alert"[^>]*id="club-form-alerts-error"/);
    expect(html).toContain("is not a valid email address.");
  });
});
