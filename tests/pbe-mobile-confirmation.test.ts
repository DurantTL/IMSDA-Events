import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegistrationAccountPrompt } from "@/components/registration-account-prompt";
import { confirmationDetailRows, isTeamConfirmation } from "@/modules/forms/confirmation-details";
import { pendingTeamButtons } from "@/modules/general-link-registrations/review-actions";

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
  const base = { waitlisted: false, eventName: "Synthetic Bible Experience", email: "director@example.test", roster: { count: 3 }, pricingDate: "October 15, 2026" };

  it("names the team, club and location, says team members, and has no pricing date", () => {
    const rows = confirmationDetailRows({ ...base, team: { teamName: "Bible Bees", club: "Synthetic Club", location: "Iowa" } });
    expect(rows.map((row) => row.label)).toEqual(["Event", "Team", "Club", "Location", "Email", "Team members"]);
    expect(rows.find((row) => row.label === "Team members")?.value).toBe("3 registered");
    expect(rows.some((row) => /pricing|estimate/i.test(row.label))).toBe(false);
    expect(rows.find((row) => row.label === "Team")?.translate).toBe(false);
  });

  it("leaves out a club or location the director did not give", () => {
    const rows = confirmationDetailRows({ ...base, team: { teamName: "Bible Bees", club: "", location: null } });
    expect(rows.map((row) => row.label)).toEqual(["Event", "Team", "Email", "Team members"]);
  });

  it("keeps the ordinary confirmation as it was: Attendees and the pricing date, or the estimate date on a waitlist", () => {
    const ordinary = confirmationDetailRows({ ...base, team: null });
    expect(ordinary.map((row) => row.label)).toEqual(["Event", "Email", "Attendees", "Pricing date"]);
    expect(ordinary.at(-1)?.value).toBe("October 15, 2026");
    const waitlisted = confirmationDetailRows({ ...base, team: null, waitlisted: true });
    expect(waitlisted.map((row) => row.label)).toEqual(["Event", "Email", "Attendees", "Estimate date"]);
    expect(waitlisted.find((row) => row.label === "Attendees")?.value).toBe("3 on the waitlist");
    expect(confirmationDetailRows({ ...base, team: null, email: "", roster: null }).map((row) => `${row.label}: ${row.value}`)).toEqual(["Event: Synthetic Bible Experience", "Email: Not provided", "Pricing date: October 15, 2026"]);
  });

  it("is a team confirmation only for a free, named team", () => {
    expect(isTeamConfirmation({ noCost: true, teamName: "Bible Bees" })).toBe(true);
    expect(isTeamConfirmation({ noCost: true, teamName: null })).toBe(false);
    expect(isTeamConfirmation({ noCost: false, teamName: "Bible Bees" })).toBe(false);
    expect(isTeamConfirmation(undefined)).toBe(false);
  });

  it("drops the pricing notice and the second no-fee band for a team, keeps them otherwise, and stacks on a phone", () => {
    expect(form).toContain("deferredOrganizationBilling && !teamConfirmation && (");
    expect(form).toContain("group && !waitlisted && !teamConfirmation &&");
    expect(css).toMatch(/\.public-registration-confirmation-actions \{ flex-direction: column; \}/);
    expect(css).toContain(".public-registration-confirmation-details.is-compact { grid-template-columns: max-content minmax(0, 1fr)");
  });
});

describe("the waiting team card's buttons", () => {
  it("shows one primary button when the picked club is the club the director named, or nothing is picked", () => {
    for (const choiceId of ["club-1", ""]) {
      expect(pendingTeamButtons({ suggestedId: "club-1", choiceId })).toEqual({ confirmNamed: { style: "primary", organizationId: "club-1" }, attachChosen: null });
    }
  });

  it("shows the named club's confirm as secondary and an attach to the picked club as primary when they differ", () => {
    expect(pendingTeamButtons({ suggestedId: "club-1", choiceId: "club-2" })).toEqual({
      confirmNamed: { style: "secondary", organizationId: "club-1" },
      attachChosen: { style: "primary", action: "REASSIGN", organizationId: "club-2" },
    });
  });

  it("offers only an attach to the picked club when the named club is not in the directory", () => {
    expect(pendingTeamButtons({ suggestedId: null, choiceId: "club-2" })).toEqual({ confirmNamed: null, attachChosen: { style: "primary", action: "REASSIGN", organizationId: "club-2" } });
    expect(pendingTeamButtons({ suggestedId: null, choiceId: "" }).attachChosen?.organizationId).toBe("");
  });
});

describe("the phone audit's self-test", () => {
  const script = readFileSync("scripts/verify-mobile-layout.ts", "utf8");
  it("injects a heading with its icon above it, a label touching its field and text cut off sideways", () => {
    expect(script).toContain("self-test icon heading");
    expect(script).toContain("self-test stacked label");
    expect(script).toContain("self-test text that is cut off sideways");
  });
  it("can be rerun on a database that kept the PBE event", () => {
    expect(script).toContain('teamName: { startsWith: "Mobilecheck Walkthrough Team" }');
    expect(script).toContain("registrationClosesOn: addDays(today, 60)");
    expect(script).toContain("Could not remove the synthetic PBE event");
  });
});

describe("the waiting teams page", () => {
  it("never uses the raw UTC stamp", () => {
    const review = readFileSync("components/pending-teams-review.tsx", "utf8");
    expect(review).not.toContain("UTC by");
    expect(review).toContain("timeZoneName: \"short\"");
  });
});
