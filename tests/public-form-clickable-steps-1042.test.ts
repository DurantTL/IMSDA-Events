import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicRegistrationForm } from "@/components/public-registration-form";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import {
  clickableSteps,
  getPublicRegistrationStepPlan,
} from "@/modules/forms/public-registration-steps";

const field = {
  scope: "REGISTRATION", required: false, helpText: "", options: [], type: "TEXT",
} as const;

const definition = registrationFormDefinitionSchema.parse({
  title: "Synthetic clickable steps", description: "Synthetic form.", confirmationMessage: "Received.",
  sections: [
    { id: "s_one", title: "Team members", description: "", fields: [{ ...field, id: "field_one", key: "team_name", label: "Team name", required: true }] },
    { id: "s_two", title: "Contact", description: "", fields: [{ ...field, id: "field_two", key: "contact_name", label: "Contact name" }] },
  ],
});
const steps = getPublicRegistrationStepPlan(
  definition,
  new Set(definition.sections.flatMap((section) => section.fields.map((item) => item.key))),
);

describe("clickableSteps (#1042)", () => {
  it("has at least three steps to exercise (two sections plus review)", () => {
    expect(steps.length).toBeGreaterThanOrEqual(3);
  });

  it("makes reached steps clickable and leaves the current and later steps plain", () => {
    const items = clickableSteps(steps, 2, 1);
    expect(items.map((item) => item.clickable)).toEqual(steps.map((_, index) => index === 0 || index === 2));
    expect(items[1]!.isCurrent).toBe(true);
    expect(items[0]!.isComplete).toBe(true);
  });

  it("never lets the furthest step trail the current one", () => {
    const items = clickableSteps(steps, 0, 1);
    expect(items[0]!.clickable).toBe(true);
    expect(items[2]!.clickable).toBe(false);
  });

  it("keeps a later step plain until it is reached", () => {
    const items = clickableSteps(steps, 0, 0);
    expect(items.some((item) => item.clickable)).toBe(false);
  });

  it("names the button for its step and adds has errors only to steps with errors", () => {
    const items = clickableSteps(steps, 2, 2, [steps[0]!.id]);
    expect(items[0]!.label).toBe(`Go to step 1: ${steps[0]!.shortLabel}, has errors`);
    expect(items[0]!.hasErrors).toBe(true);
    expect(items[1]!.label).toBe(`Go to step 2: ${steps[1]!.shortLabel}`);
    expect(items[1]!.hasErrors).toBe(false);
  });
});

describe("public form step list (#1042)", () => {
  const html = renderToStaticMarkup(createElement(PublicRegistrationForm, {
    event: { name: "Synthetic Event", slug: "synthetic-event", startsAt: "2026-10-09T00:00:00.000Z", endsAt: "2026-10-11T00:00:00.000Z", timezone: "America/Chicago", location: null, capacity: null, billingMode: "ATTENDEE_PAY" },
    form: { slug: "main", versionId: "version-1", versionNumber: 1, definition },
    choiceUsage: {},
    pricingDate: "2026-09-29",
    lifecycle: { phase: "OPEN", capacityDecision: "REGISTER", remainingSpots: null, waitingRegistrations: 0 },
  }));
  const list = html.slice(html.indexOf("<ol>"), html.indexOf("</ol>"));

  it("starts with the first step current and no step buttons yet", () => {
    expect(list).toContain('aria-current="step"');
    expect(list).not.toContain("<button");
    expect(list.match(/<li/g)).toHaveLength(steps.length);
  });
});

describe("form wiring (#1042)", () => {
  const source = readFileSync("components/public-registration-form.tsx", "utf8");

  it("renders reached steps as buttons that call goToStep", () => {
    expect(source).toContain('<button type="button" aria-label={item.label} onClick={() => goToStep(item.step)}>');
  });

  it("switches to the issue's step before focusing, without clearing the issues", () => {
    const start = source.indexOf("function followIssueLink");
    const body = source.slice(start, source.indexOf("// The summary names whose field", start));
    expect(body).toContain("stepForIssue(issue)");
    expect(body).toContain("setCurrentStepId(issueStep.id)");
    expect(body).not.toContain("setIssues");
    expect(body.indexOf("setCurrentStepId")).toBeLessThan(body.indexOf("requestAnimationFrame"));
  });

  it("flags steps from the full issue list, not the scoped one", () => {
    const start = source.indexOf("function showIssues");
    const body = source.slice(start, source.indexOf("function goToStep", start));
    expect(body).toContain("setErrorStepIds(registrationSteps");
    expect(body).toContain("nextIssues.some");
  });

  it("scopes the button styles under the step list and keeps a 44px target with focus", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain(".public-registration-progress li > button {");
    expect(css).toMatch(/\.public-registration-progress li > button \{[^}]*min-height: 44px/);
    expect(css).toContain(".public-registration-progress li > button:focus-visible");
  });
});
