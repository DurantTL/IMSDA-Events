import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicRegistrationForm } from "@/components/public-registration-form";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import {
  clickableSteps,
  errorMarkedStepIds,
  furthestReachedIndex,
  getPublicRegistrationStepPlan,
  issueBelongsToPlanStep,
  withVisitedStep,
  withoutServerIssuesForStep,
} from "@/modules/forms/public-registration-steps";

const field = {
  scope: "REGISTRATION", required: false, helpText: "", options: [], type: "TEXT",
} as const;

const definition = registrationFormDefinitionSchema.parse({
  title: "Synthetic clickable steps", description: "Synthetic form.", confirmationMessage: "Received.",
  sections: [
    { id: "s_one", title: "Team members", description: "", fields: [{ ...field, id: "field_one", key: "team_name", label: "Team name", required: true }] },
    { id: "s_two", title: "Contact", description: "", fields: [{ ...field, id: "field_two", key: "contact_name", label: "Contact name" }] },
    { id: "s_three", title: "Extras", description: "", fields: [{ ...field, id: "field_three", key: "extra_note", label: "Extra note" }] },
  ],
});
const allKeys = definition.sections.flatMap((section) => section.fields.map((item) => item.key));
const plan = (keys: string[]) => getPublicRegistrationStepPlan(definition, new Set(keys));
const steps = plan(allKeys);
const [one, two, , review] = steps;
const issueFor = (key: string) => ({ key, message: "Synthetic problem." });

describe("step plan used below", () => {
  it("has three section steps and a review", () => {
    expect(steps.map((step) => step.id)).toEqual(["s_one", "s_two", "s_three", "__review"]);
    expect(issueBelongsToPlanStep(issueFor("contact_name"), two!)).toBe(true);
    expect(issueBelongsToPlanStep(issueFor("contact_name"), one!)).toBe(false);
  });
});

describe("clickableSteps (#1042)", () => {
  it("makes reached steps clickable and leaves the current and later steps plain", () => {
    const items = clickableSteps(steps, ["s_one", "s_two", "s_three"], 1);
    expect(items.map((item) => item.clickable)).toEqual([true, false, true, false]);
    expect(items[1]!.isCurrent).toBe(true);
    expect(items[0]!.isComplete).toBe(true);
  });

  it("keeps later steps plain until reached", () => {
    expect(clickableSteps(steps, ["s_one"], 0).some((item) => item.clickable)).toBe(false);
  });

  it("never lets the furthest step trail the current one", () => {
    const items = clickableSteps(steps, [], 2);
    expect(items.map((item) => item.clickable)).toEqual([true, true, false, false]);
  });

  it("names the button for its step, with has errors only on steps with errors", () => {
    const items = clickableSteps(steps, ["s_one", "s_two", "s_three"], 2, ["s_one"]);
    expect(items[0]!.label).toBe(`Go to step 1: ${one!.shortLabel}, has errors`);
    expect(items[1]!.label).toBe(`Go to step 2: ${two!.shortLabel}`);
  });

  it("tracks reached steps by id, so a section disappearing or appearing does not shift them", () => {
    const visited = ["s_one", "s_two"];
    const without = plan(["team_name", "extra_note"]);
    expect(without.map((step) => step.id)).toEqual(["s_one", "s_three", "__review"]);
    // Step 3 ("Extras") was never visited, so it stays plain when "Contact" goes away.
    expect(clickableSteps(without, visited, 0).map((item) => item.clickable)).toEqual([false, false, false]);
    expect(furthestReachedIndex(without, visited, 0)).toBe(0);
    // When "Contact" comes back, it is reachable again and Extras still is not.
    expect(clickableSteps(steps, visited, 0).map((item) => item.clickable)).toEqual([false, true, false, false]);
    // A visited step that is now at a different position is still the one that is clickable.
    const shifted = plan(["contact_name", "extra_note"]);
    expect(clickableSteps(shifted, ["s_two", "s_three"], 1).map((item) => [item.step.id, item.clickable]))
      .toEqual([["s_two", true], ["s_three", false], ["__review", false]]);
    // Visiting "Contact" earlier does not make a different step reachable once positions shift.
    expect(clickableSteps(shifted, ["s_one", "s_two"], 0).map((item) => item.clickable)).toEqual([false, false, false]);
  });

  it("adds each visited step once", () => {
    expect(withVisitedStep(withVisitedStep([], "s_one"), "s_one")).toEqual(["s_one"]);
    expect(withVisitedStep(["s_one"], "s_two")).toEqual(["s_one", "s_two"]);
  });
});

describe("errorMarkedStepIds (#1042)", () => {
  const base = { attempted: true, serverIssues: [], furthestIndex: 3 };

  it("marks every reached step that has an issue, from the full list", () => {
    expect(errorMarkedStepIds(steps, { ...base, clientIssues: [issueFor("team_name"), issueFor("extra_note")] }))
      .toEqual(["s_one", "s_three"]);
  });

  it("marks nothing before a submit or continue was attempted", () => {
    expect(errorMarkedStepIds(steps, { ...base, attempted: false, clientIssues: [issueFor("team_name")] })).toEqual([]);
  });

  it("does not mark steps beyond the furthest reached from client issues", () => {
    expect(errorMarkedStepIds(steps, { ...base, furthestIndex: 1, clientIssues: [issueFor("team_name"), issueFor("extra_note")] }))
      .toEqual(["s_one"]);
  });

  it("a successful Continue clears that step's marker; the others keep theirs", () => {
    const before = errorMarkedStepIds(steps, { ...base, clientIssues: [issueFor("team_name"), issueFor("extra_note")] });
    expect(before).toEqual(["s_one", "s_three"]);
    // The person fixed step one: the live client issues no longer include it.
    const after = errorMarkedStepIds(steps, { ...base, clientIssues: [issueFor("extra_note")] });
    expect(after).toEqual(["s_three"]);
  });

  it("a scoped Continue on one step does not drop another step's marker", () => {
    // Continue shows only the current step's issues, but markers come from every reached step's live issues.
    const live = [issueFor("contact_name"), issueFor("extra_note")];
    expect(errorMarkedStepIds(steps, { ...base, clientIssues: live })).toEqual(["s_two", "s_three"]);
  });

  it("keeps a server issue's marker until the person gets past that step", () => {
    const server = [issueFor("contact_name")];
    expect(errorMarkedStepIds(steps, { ...base, clientIssues: [], serverIssues: server })).toEqual(["s_two"]);
    expect(withoutServerIssuesForStep(server, one!)).toEqual(server);
    const cleared = withoutServerIssuesForStep(server, two!);
    expect(cleared).toEqual([]);
    expect(errorMarkedStepIds(steps, { ...base, clientIssues: [], serverIssues: cleared })).toEqual([]);
  });

  it("a reset (nothing attempted, no server issues) clears everything", () => {
    expect(errorMarkedStepIds(steps, { attempted: false, clientIssues: [], serverIssues: [], furthestIndex: 0 })).toEqual([]);
  });

  it("follows conditional steps appearing and disappearing", () => {
    const issues = [issueFor("contact_name"), issueFor("extra_note")];
    const without = plan(["team_name", "extra_note"]);
    // The Contact section is hidden, so its issue maps to no step; Extras still shows.
    expect(errorMarkedStepIds(without, { ...base, furthestIndex: 2, clientIssues: issues })).toEqual(["s_three"]);
    expect(errorMarkedStepIds(steps, { ...base, clientIssues: issues })).toEqual(["s_two", "s_three"]);
    expect(review!.id).toBe("__review");
  });
});

describe("public form step list render (#1042)", () => {
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
    expect(list).not.toContain("has errors");
  });
});
