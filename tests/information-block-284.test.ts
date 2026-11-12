import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InformationBlock } from "@/components/information-block";
import { FormattedText } from "@/components/event-content-blocks";
import { paletteRegistry } from "@/components/registration-builder/palette-registry";
import { fieldTypeLabels } from "@/components/registration-builder/builder-types";
import { deriveFieldChips } from "@/components/registration-builder/field-chips";
import { informationTypePatch } from "@/components/registration-builder/builder-information-block";
import { ruleControllerChoices } from "@/components/registration-builder/rule-editor";
import { informationEntryAllowed } from "@/components/registration-builder/information-palette";
import {
  INFORMATION_NOTE_MAX,
  INFORMATION_PLACEHOLDER_TEXT,
  INFORMATION_TEXT_MAX,
  calculateFormTotal,
  calculateRosterTotal,
  formFieldSchema,
  isFieldVisible,
  registrationFormDefinitionSchema,
  validateTestResponses,
} from "@/modules/forms/definition";
import { attendeeRosterExportColumns } from "@/modules/forms/attendee-roster-csv";
import { isDraftExcludedField, sanitizeDraftContent } from "@/modules/forms/public-draft";
import { sanitizeAnswerDraft } from "@/modules/forms/answer-draft";
import { preparePublicRegistration } from "@/modules/forms/public-domain";
import { getPublicRegistrationStepPlan } from "@/modules/forms/public-registration-steps";
import { informationFormDefinitionIssues } from "@/modules/information-forms/definition";
import { questionLibraryFragmentSchema } from "@/modules/question-library/domain";
import { excludedFieldKeys } from "@/modules/registration-pdf/model";
import { conditionFieldChoices } from "@/modules/registration-form-notifications/domain";
import { visibilityRuleProblems } from "@/modules/forms/visibility-rule";

const base = { helpText: "", required: false, options: [] as string[], scope: "REGISTRATION" as const };
const info = (overrides: Record<string, unknown> = {}) => ({
  id: "f_info", key: "info_one", label: "Before you arrive", type: "INFORMATION", ...base,
  information: { text: "Synthetic text for the **information** block." }, ...overrides,
});

function definition(fields: Array<Record<string, unknown>>, roster = true) {
  return registrationFormDefinitionSchema.parse({
    title: "Synthetic information form",
    confirmationMessage: "Received.",
    ...(roster ? { attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 4 } } : {}),
    sections: [{
      id: "sec_one", title: "Everything", description: "", fields: [
        { id: "f_first", key: "first_name", label: "First name", type: "TEXT", scope: roster ? "ATTENDEE" : "REGISTRATION", required: true, options: [], helpText: "" },
        { id: "f_last", key: "last_name", label: "Last name", type: "TEXT", scope: roster ? "ATTENDEE" : "REGISTRATION", required: true, options: [], helpText: "" },
        { id: "f_email", key: "email", label: "Email", type: "EMAIL", scope: "REGISTRATION", required: true, options: [], helpText: "" },
        { id: "f_choice", key: "wants_program", label: "Program?", type: "RADIO", scope: "REGISTRATION", required: false, options: ["Yes", "No"], helpText: "" },
        { id: "f_fee", key: "registration_fee", label: "Registration fee", type: "CALCULATED", scope: roster ? "ATTENDEE" : "REGISTRATION", required: false, options: [], helpText: "", priceCents: 2500 },
        ...fields,
      ],
    }],
  });
}

describe("the Information block field (#284)", () => {
  it("is a field type with a builder label and carries text and an optional note", () => {
    expect(fieldTypeLabels.INFORMATION).toBe("Information");
    const parsed = formFieldSchema.parse(info({ information: { text: "  Hello  ", note: "  Bring a coat.  " } }));
    expect(parsed.information).toEqual({ text: "Hello", note: "Bring a coat." });
    expect(formFieldSchema.parse(info()).information).toEqual({ text: "Synthetic text for the **information** block." });
  });

  it("needs text and refuses text on any other type", () => {
    expect(formFieldSchema.safeParse(info({ information: undefined })).success).toBe(false);
    expect(formFieldSchema.safeParse(info({ information: { text: "   " } })).success).toBe(false);
    expect(formFieldSchema.safeParse(info({ information: { text: "a".repeat(INFORMATION_TEXT_MAX + 1) } })).success).toBe(false);
    expect(formFieldSchema.safeParse(info({ information: { text: "ok", note: "a".repeat(INFORMATION_NOTE_MAX + 1) } })).success).toBe(false);
    expect(formFieldSchema.safeParse({ id: "f_t", key: "tt", label: "TT", type: "TEXT", ...base, information: { text: "x" } }).success).toBe(false);
  });

  it("is never required, priced, per attendee or given choices", () => {
    expect(formFieldSchema.safeParse(info({ required: true })).success).toBe(false);
    expect(formFieldSchema.safeParse(info({ scope: "ATTENDEE" })).success).toBe(false);
    expect(formFieldSchema.safeParse(info({ priceCents: 500 })).success).toBe(false);
    expect(formFieldSchema.safeParse(info({ options: ["A", "B"] })).success).toBe(false);
  });

  it("is added from the builder palette as a valid block and hidden in information mode", () => {
    const entry = paletteRegistry.getSnapshot().entries.find((candidate) => candidate.id === "type:INFORMATION");
    expect(entry).toBeTruthy();
    const added = entry!.add({ existingFields: [], newId: () => "new_id" }).fields[0]!;
    expect(added).toMatchObject({ type: "INFORMATION", required: false, scope: "REGISTRATION", information: { text: INFORMATION_PLACEHOLDER_TEXT } });
    expect(formFieldSchema.safeParse(added).success).toBe(true);
    expect(informationEntryAllowed(entry!)).toBe(false);
    expect(informationFormDefinitionIssues(definition([info()], false) as never).length).toBeGreaterThan(0);
  });

  it("starts with text when a field becomes one, and drops it when it stops", () => {
    const text = { id: "f", key: "kk", label: "LL", helpText: "", type: "TEXT" as const, scope: "ATTENDEE" as const, required: true, options: [], placeholder: "x" };
    expect(informationTypePatch(text, "INFORMATION", INFORMATION_PLACEHOLDER_TEXT)).toMatchObject({ information: { text: INFORMATION_PLACEHOLDER_TEXT }, required: false, scope: "REGISTRATION", placeholder: undefined });
    expect(informationTypePatch({ ...text, type: "INFORMATION", information: { text: "x" } }, "TEXT", "")).toEqual({ information: undefined });
    expect(informationTypePatch(text, "TEXT", "")).toEqual({});
  });

  it("is not saved to the question library, and is shown without the usual chips", () => {
    expect(questionLibraryFragmentSchema.safeParse({ fields: [info()] }).success).toBe(false);
    expect(deriveFieldChips(formFieldSchema.parse(info()), "Section")).toEqual([]);
    expect(deriveFieldChips(formFieldSchema.parse(info({ conditional: { fieldKey: "wants_program", operator: "EQUALS", value: "Yes" } })), "Section")).toEqual([{ kind: "logic", label: "Has logic" }]);
  });
});

describe("the block is never an answer, price or count", () => {
  const form = definition([info()]);
  const infoField = form.sections[0]!.fields.find((field) => field.key === "info_one")!;

  it("is not validated or required, even if an answer is posted under its key", () => {
    const issues = validateTestResponses(form, { email: "a@example.test", info_one: "anything" }, {}, "REGISTRATION").issues;
    expect(issues.filter((issue) => issue.key === "info_one")).toEqual([]);
  });

  it("drops a posted answer under its key from a public submission", () => {
    const prepared = preparePublicRegistration(form, {
      versionId: "v1", idempotencyKey: "00000000-0000-4000-8000-000000000284", website: "",
      responses: { email: "ann@example.test", wants_program: "Yes", info_one: "tampered" },
      attendees: [{ clientId: "a1", responses: { first_name: "Ann", last_name: "Sample", info_one: "tampered" } }],
    }, { timeZone: "America/Chicago" });
    expect(prepared.registrationResponses).not.toHaveProperty("info_one");
    expect(JSON.stringify(prepared)).not.toContain("tampered");
  });

  it("adds nothing to prices", () => {
    const withBlock = calculateFormTotal(form, { wants_program: "Yes" });
    const without = calculateFormTotal(definition([]), { wants_program: "Yes" });
    expect(withBlock).toEqual(without);
    expect(calculateRosterTotal(form, {}, [{ first_name: "Ann" }]).lineItems.map((item) => item.key)).not.toContain("info_one");
  });

  it("stays out of exports, PDFs, notification conditions and drafts", () => {
    expect(attendeeRosterExportColumns(form)).not.toContain("Before you arrive");
    expect(excludedFieldKeys(form).has("info_one")).toBe(true);
    expect(conditionFieldChoices(form).map((choice) => choice.key)).not.toContain("info_one");
    expect(isDraftExcludedField(infoField, form)).toBe(true);
    expect(sanitizeDraftContent(form, { responses: { info_one: "x", email: "a@example.test" } }).responses).toEqual({ email: "a@example.test" });
    expect(sanitizeAnswerDraft(form, { info_one: "x", email: "a@example.test" })).toEqual({ email: "a@example.test" });
  });

  it("cannot be the question another question depends on", () => {
    const dependent = formFieldSchema.parse({ id: "f_dep", key: "dep_one", label: "Dependent", type: "TEXT", ...base, conditional: { fieldKey: "info_one", operator: "NOT_EMPTY", value: "" } });
    const problems = visibilityRuleProblems(dependent, [infoField, dependent], { strict: false });
    expect(problems.length).toBeGreaterThan(0);
    expect(ruleControllerChoices(dependent, [infoField, dependent])).toEqual([]);
    expect(registrationFormDefinitionSchema.safeParse({ ...form, sections: [{ ...form.sections[0]!, fields: [...form.sections[0]!.fields, dependent] }] }).success).toBe(false);
  });
});

describe("show and hide rules match questions", () => {
  const conditional = info({ conditional: { fieldKey: "wants_program", operator: "EQUALS", value: "Yes" } });
  const form = definition([conditional], false);
  const infoField = form.sections[0]!.fields.find((field) => field.key === "info_one")!;

  it("shows only when its rule matches", () => {
    expect(isFieldVisible(infoField, { wants_program: "Yes" })).toBe(true);
    expect(isFieldVisible(infoField, { wants_program: "No" })).toBe(false);
  });

  it("supports an All/Any group", () => {
    const grouped = formFieldSchema.parse(info({ conditionalGroup: { match: "ANY", conditions: [
      { fieldKey: "wants_program", operator: "EQUALS", value: "Yes" },
      { fieldKey: "email", operator: "NOT_EMPTY", value: "" },
    ] } }));
    expect(isFieldVisible(grouped, { wants_program: "No", email: "a@example.test" })).toBe(true);
    expect(isFieldVisible(grouped, { wants_program: "No" })).toBe(false);
  });

  it("makes a section with only a block a step, shown where placed", () => {
    const stepForm = registrationFormDefinitionSchema.parse({
      title: "Synthetic", confirmationMessage: "Received.",
      sections: [
        { id: "sec_a", title: "Contact", description: "", fields: [{ id: "f_e", key: "email", label: "Email", type: "EMAIL", scope: "REGISTRATION", required: true, options: [], helpText: "" }] },
        { id: "sec_b", title: "Good to know", description: "", fields: [info()] },
      ],
    });
    const plan = getPublicRegistrationStepPlan(stepForm, new Set(["email", "info_one"]));
    expect(plan.find((step) => step.sectionId === "sec_b")?.fieldKeys).toEqual(["info_one"]);
  });
});

describe("what people see", () => {
  const field = formFieldSchema.parse(info({ information: { text: "## Packing\n\nBring **a coat** and [a map](https://example.org/map).\n\n- Water\n- Snacks", note: "Doors open at *8 am*." } }));

  it("renders the heading, text and highlighted note", () => {
    const html = renderToStaticMarkup(createElement(InformationBlock, { field }));
    expect(html).toContain("Before you arrive");
    expect(html).toContain("<strong>a coat</strong>");
    expect(html).toContain("<li>Water</li>");
    expect(html).toContain("<em>8 am</em>");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("never renders raw HTML, images or video", () => {
    const hostile = formFieldSchema.parse(info({ information: { text: '<script>alert(1)</script> <img src="https://example.org/x.png"> ![pic](https://example.org/x.png) <video src="x"></video> [bad](javascript:alert(1))', note: "<iframe src=\"https://example.org\"></iframe>" } }));
    const html = renderToStaticMarkup(createElement(InformationBlock, { field: hostile }));
    expect(html).not.toMatch(/<(script|img|video|iframe)\b/i);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps the event page's formatted text as it was", () => {
    const html = renderToStaticMarkup(createElement(FormattedText, { source: "## Title\n\nSome *text*." }));
    expect(html).toBe('<div class="event-block-body event-formatted-text"><h3>Title</h3><p>Some <em>text</em>.</p></div>');
  });
});

describe("existing forms are unchanged", () => {
  it("parses a form without the block to exactly what it was, with no information key", () => {
    const form = definition([], true);
    const reparsed = registrationFormDefinitionSchema.parse(JSON.parse(JSON.stringify(form)));
    expect(JSON.stringify(reparsed)).toBe(JSON.stringify(form));
    for (const field of form.sections.flatMap((section) => section.fields)) expect(field).not.toHaveProperty("information");
    expect(JSON.stringify(form)).not.toContain('"information":');
  });
});
