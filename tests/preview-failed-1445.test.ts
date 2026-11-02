import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { PREVIEW_UNAVAILABLE_TEXT, PublicRegistrationForm } from "@/components/public-registration-form";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";

/**
 * #1445 (rule P1): the page's total is only a preview. When the shared price function throws in the browser, the form
 * says the total is calculated on submit and shows no number of its own; a CALCULATED line never shows an amount.
 */
const definition = registrationFormDefinitionSchema.parse({
  title: "Synthetic preview failure", description: "Synthetic form.", confirmationMessage: "Received.",
  sections: [{ id: "s_one", title: "Fees", description: "", fields: [
    { id: "f_fee", key: "registration_fee", label: "Registration fee", helpText: "", type: "CALCULATED", scope: "REGISTRATION", required: false, options: [], priceCents: 5000 },
    { id: "f_name", key: "team_name", label: "Team name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] },
  ] }],
});

const originalReduce = Array.prototype.reduce;
afterEach(() => { Array.prototype.reduce = originalReduce; });

function render() {
  return renderToStaticMarkup(createElement(PublicRegistrationForm, {
    event: { name: "Synthetic Event", slug: "synthetic-event", startsAt: "2026-10-09T00:00:00.000Z", endsAt: "2026-10-11T00:00:00.000Z", timezone: "America/Chicago", location: null, capacity: null, billingMode: "ATTENDEE_PAY" },
    form: { slug: "main", versionId: "version-1", versionNumber: 1, definition },
    choiceUsage: {},
    pricingDate: "2026-09-29",
    lifecycle: { phase: "OPEN", capacityDecision: "REGISTER", remainingSpots: null, waitingRegistrations: 0 },
  }));
}

describe("a price preview that throws", () => {
  it("control: the preview shows the fee as an amount", () => {
    const html = render();
    expect(html).toContain("$50.00");
    expect(html).not.toContain(PREVIEW_UNAVAILABLE_TEXT.replace("'", "&#x27;"));
  });

  it("says the total is calculated on submit, and the calculated line shows no amount", () => {
    Array.prototype.reduce = function patched(this: unknown[], callback: never, ...rest: never[]) {
      if (typeof callback === "function" && /Math\.max\([^)]*amountCents/.test(Function.prototype.toString.call(callback))) throw new Error("preview failed (test)");
      return (originalReduce as (...args: unknown[]) => unknown).call(this, callback, ...rest);
    } as typeof Array.prototype.reduce;
    const html = render();
    expect(html).toContain("calculated when you submit");
    expect(html).toContain("Calculated on submit");
    expect(html).not.toContain("$50.00");
  });
});
