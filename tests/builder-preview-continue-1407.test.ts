import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { continueBlockedMessage, fieldlessIssues, lastFailedTestReasons, nextContinueBlock, previewStepIssues } from "@/components/registration-builder/preview-continue";
import type { TestSubmissionView } from "@/components/registration-builder/builder-types";
import { formTemplates, getAttendeeRosterConfig, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";
import { getPublicRegistrationStepPlan } from "@/modules/forms/public-registration-steps";
import { validateRosterResponses } from "@/modules/forms/roster-validation";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

function template(key: string) {
  const match = formTemplates.find((candidate) => candidate.key === key);
  if (!match) throw new Error(`Missing form template: ${key}`);
  return structuredClone(match.definition) as RegistrationFormDefinition;
}

function plan(definition: RegistrationFormDefinition) {
  return getPublicRegistrationStepPlan(
    definition,
    new Set(definition.sections.flatMap((section) => section.fields.map((field) => field.key))),
  );
}

function issuesFor(definition: RegistrationFormDefinition, stepIndex: number, responses: Record<string, string> = {}, attendees: Array<{ clientId: string; responses: Record<string, string> }> = []) {
  const steps = plan(definition);
  return previewStepIssues({ definition, roster: getAttendeeRosterConfig(definition), responses, attendees, choiceUsage: {}, step: steps[stepIndex]! });
}

describe("preview Continue validation (#1407)", () => {
  it("blocks Continue when a required question is empty, with the public form's wording", () => {
    const definition = template("simple_rsvp");
    const step = plan(definition)[0]!;
    const issues = issuesFor(definition, 0);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => step.fieldKeys.includes(issue.key) || issue.key === "attendees")).toBe(true);
    expect(continueBlockedMessage(step)).toBe("Complete your information before continuing.");
  });

  it("allows Continue once the step's required questions are answered", () => {
    const definition = template("simple_rsvp");
    const roster = getAttendeeRosterConfig(definition);
    const step = plan(definition)[0]!;
    const answers = Object.fromEntries(step.fieldKeys.map((key) => [key, key === "email" ? "pat@example.org" : "Sample"]));
    const attendees = roster.enabled ? [{ clientId: "a1", responses: answers }] : [];
    expect(issuesFor(definition, 0, roster.enabled ? {} : answers, attendees)).toEqual([]);
  });

  it("only reports issues that belong to the current step", () => {
    const definition = template("womens_retreat_export");
    const steps = plan(definition);
    const issues = issuesFor(definition, 0);
    for (const issue of issues) expect(steps[0]!.fieldKeys.includes(issue.key) || issue.key === "attendees").toBe(true);
    expect(issues.some((issue) => steps[1]!.fieldKeys.includes(issue.key) && !steps[0]!.fieldKeys.includes(issue.key))).toBe(false);
  });

  it("is wired to Continue only; Back and step buttons stay free", () => {
    const source = read("components/registration-builder/builder-preview.tsx");
    expect(source).toContain("onClick={continuePreview}");
    expect(source).toContain('role="alert"');
    expect(source).toMatch(/\.focus\(\)/);
  });
});

describe("roster validation helper (#1407)", () => {
  const definition = template("womens_retreat_export");
  const roster = { enabled: true, minAttendees: 1, maxAttendees: 2, attendeeLabel: "Guest", addButtonLabel: "Add guest" };

  it("reports a wrong attendee count with the attendee label", () => {
    const issues = validateRosterResponses({ definition, roster, registrationResponses: {}, attendees: [], choiceUsage: {} });
    expect(issues[0]).toMatchObject({ key: "attendees", path: "attendees", attendeeIndex: null, message: "Add between 1 and 2 guests." });
  });

  it("scopes issues to registration or the attendee index", () => {
    const issues = validateRosterResponses({ definition, roster, registrationResponses: {}, attendees: [{ clientId: "a1", responses: {} }], choiceUsage: {} });
    expect(issues.some((issue) => issue.attendeeIndex === null && issue.path === `responses.${issue.key}`)).toBe(true);
    expect(issues.some((issue) => issue.attendeeIndex === 0 && issue.path === `attendees.0.responses.${issue.key}`)).toBe(true);
  });

  it("ignores the named fields", () => {
    const base = validateRosterResponses({ definition, roster, registrationResponses: {}, attendees: [{ clientId: "a1", responses: {} }], choiceUsage: {} });
    const key = base.find((issue) => issue.key !== "attendees")!.key;
    const ignored = validateRosterResponses({ definition, roster, registrationResponses: {}, attendees: [{ clientId: "a1", responses: {} }], choiceUsage: {}, ignoredFieldKeys: [key] });
    expect(ignored.some((issue) => issue.key === key)).toBe(false);
  });

  it("is the one implementation the public form uses", () => {
    const source = read("components/public-registration-form.tsx");
    expect(source).toContain("@/modules/forms/roster-validation");
    expect(source).not.toContain("function cloneChoiceUsage");
  });
});

describe("test panel failure reasons (#1407)", () => {
  const test = (isValid: boolean, issues: unknown[]): TestSubmissionView => ({ id: "t", isValid, submittedBy: "staff", createdAt: "2026-10-31T12:00:00.000Z", validation: { issues }, responses: {} });

  it("lists the newest failed test's reasons, naming the attendee", () => {
    const reasons = lastFailedTestReasons([
      test(false, [{ key: "church", message: "Church is required." }, { key: "shirt", message: "Shirt size is required.", attendeeIndex: 1 }]),
      test(false, [{ key: "old", message: "Old problem." }]),
    ], "Camper");
    expect(reasons).toEqual(["Church is required.", "Camper 2: Shirt size is required."]);
  });

  it("lists nothing when the newest test passed or any test passed", () => {
    expect(lastFailedTestReasons([test(true, [])], null)).toEqual([]);
    expect(lastFailedTestReasons([test(false, [{ key: "a", message: "A is required." }]), test(true, [])], null)).toEqual([]);
    expect(lastFailedTestReasons([], null)).toEqual([]);
  });

  it("falls back to Attendee when the form has no roster label", () => {
    expect(lastFailedTestReasons([test(false, [{ key: "a", message: "Meal is required.", attendeeIndex: 0 }])], null)).toEqual(["Attendee 1: Meal is required."]);
  });
});

describe("denial cases on a synthetic roster form (#1407)", () => {
  const f = (patch: Partial<RegistrationFormField>): RegistrationFormField => ({ id: `f_${patch.key}`, key: "x", label: "X", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [], ...patch });
  const definition = {
    ...template("simple_rsvp"),
    attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 3, attendeeLabel: "Camper", addButtonLabel: "Add camper" },
    sections: [{
      id: "sec_one", title: "Details", description: "",
      fields: [
        f({ key: "church", label: "Church", type: "SELECT", options: ["North", "South"] }),
        f({ key: "mailing", label: "Mailing address", type: "ADDRESS" }),
        f({ key: "shirt", label: "Shirt size", type: "SELECT", scope: "ATTENDEE", options: ["S", "M"] }),
      ],
    }],
  } as unknown as RegistrationFormDefinition;
  const step = plan(definition)[0]!;
  const run = (responses: Record<string, never | string>, attendees: Array<{ clientId: string; responses: Record<string, string> }>) =>
    previewStepIssues({ definition, roster: getAttendeeRosterConfig(definition), responses: responses as never, attendees, choiceUsage: {}, step });

  it("blocks an empty required SELECT and ADDRESS", () => {
    const keys = run({}, [{ clientId: "a1", responses: { shirt: "S" } }]).map((issue) => issue.key);
    expect(keys).toEqual(expect.arrayContaining(["church", "mailing"]));
  });

  it("blocks an empty required attendee field with the attendee index", () => {
    const issues = run({ church: "North", mailing: { line1: "1 Main St", city: "Ames", region: "IA", postalCode: "50010" } as never }, [{ clientId: "a1", responses: { shirt: "S" } }, { clientId: "a2", responses: {} }]);
    expect(issues.filter((issue) => issue.key === "shirt")).toEqual([expect.objectContaining({ attendeeIndex: 1, path: "attendees.1.responses.shirt" })]);
  });

  it("reports only the attendee count as a fieldless issue", () => {
    const issues = run({ church: "North", mailing: { line1: "1 Main St", city: "Ames", region: "IA", postalCode: "50010" } as never }, []);
    expect(fieldlessIssues(issues).map((issue) => issue.key)).toEqual(["attendees"]);
  });

  it("starts a new attempt each time Continue is blocked, so the alert is announced again", () => {
    const first = nextContinueBlock(null, step);
    const second = nextContinueBlock(first, step);
    expect(second.message).toBe(first.message);
    expect(second.attempt).toBe(first.attempt + 1);
  });

  it("ends the Continue block on every ordinary test-issue reset", () => {
    const source = read("components/registration-builder/use-builder-state.ts");
    expect(source).toMatch(/setTestIssues = useCallback\(\(next: PreviewIssue\[\]\) => \{ setTestIssuesRaw\(next\); setContinueBlock\(null\); \}/);
  });
});

describe("failed test reasons with odd stored data (#1407)", () => {
  const odd = (validation: unknown) => [{ id: "t", isValid: false, submittedBy: "staff", createdAt: "2026-10-31T12:00:00.000Z", validation, responses: {} } as unknown as TestSubmissionView];
  it("returns nothing for null, missing or malformed validation", () => {
    expect(lastFailedTestReasons(odd(null), null)).toEqual([]);
    expect(lastFailedTestReasons(odd({}), null)).toEqual([]);
    expect(lastFailedTestReasons(odd({ issues: "nope" }), null)).toEqual([]);
    expect(lastFailedTestReasons(odd({ issues: [null, {}, { message: 5 }, { message: "" }] }), null)).toEqual([]);
  });
});
