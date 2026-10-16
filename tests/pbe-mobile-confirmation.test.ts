import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegistrationAccountPrompt } from "@/components/registration-account-prompt";

const css = readFileSync("app/globals.css", "utf8");
const form = readFileSync("components/public-registration-form.tsx", "utf8");

describe("the optional account card", () => {
  const props = { email: "director@example.test", embedded: false };

  it("keeps its ordinary wording and every button for the ordinary confirmation", () => {
    const html = renderToStaticMarkup(createElement(RegistrationAccountPrompt, props));
    expect(html).toContain("Create an optional account to manage future registrations");
    expect(html).toContain("The registration holder is the contact person");
    expect(html).toContain("Create account");
    expect(html).toContain("Sign in to an existing account");
    expect(html).toContain("Email me a private registration link");
    expect(html).not.toContain("is-brief");
  });

  it("is short for a team registered without an account: one sentence, the same three buttons, one short line", () => {
    const html = renderToStaticMarkup(createElement(RegistrationAccountPrompt, { ...props, brief: true }));
    expect(html).toContain("is-brief");
    expect(html).toContain("Create an optional account</h2>");
    expect(html).not.toContain("The registration holder is the contact person");
    expect(html).toContain("Create account");
    expect(html).toContain("Sign in to an existing account");
    expect(html).toContain("Email me a private registration link");
    expect(html).toContain("No account is required. Your confirmation code still works.");
    expect(html.length).toBeLessThan(renderToStaticMarkup(createElement(RegistrationAccountPrompt, props)).length - 400);
  });

  it("stacks on a phone, so the text and the buttons use the full width", () => {
    expect(css).toMatch(/@media \(max-width: 580px\) \{\s*\.public-registration-account-prompt \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });
});

describe("the confirmation of a team registered through the general link", () => {
  it("names the team, club and location, says team members, and drops the pricing date and the second no-fee line", () => {
    expect(form).toContain('const teamConfirmation = Boolean(group?.noCost && group.teamName);');
    expect(form).toContain("{teamConfirmation && <div><dt>Team</dt>");
    expect(form).toContain("{teamConfirmation && enteredClub && <div><dt>Club</dt>");
    expect(form).toContain('teamConfirmation ? "Team members" : "Attendees"');
    expect(form).toContain("{!teamConfirmation && <div><dt>{waitlisted ? \"Estimate date\" : \"Pricing date\"}");
    expect(form).toContain("deferredOrganizationBilling && !teamConfirmation && (");
    expect(form).toContain("group && !waitlisted && !teamConfirmation &&");
  });

  it("stacks the bottom buttons on a phone and lays the details out as a compact list", () => {
    expect(css).toMatch(/\.public-registration-confirmation-actions \{ flex-direction: column; \}/);
    expect(css).toContain(".public-registration-confirmation-details.is-compact { grid-template-columns: max-content minmax(0, 1fr)");
  });
});

describe("the waiting teams page", () => {
  it("never uses the raw UTC stamp", () => {
    const review = readFileSync("components/pending-teams-review.tsx", "utf8");
    expect(review).not.toContain("UTC by");
    expect(review).toContain("timeZoneName: \"short\"");
  });
});
