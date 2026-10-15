import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addField, updateField } from "@/components/club-form-builder-state";
import { acknowledgmentTypePatch, acknowledgmentPolicyChoices, policyVersionLabel } from "@/components/acknowledgment-field-settings";
import { blankClubFormSpec, checkClubFormDraft, NO_PROTECTION_HISTORY } from "@/modules/club-forms/builder-domain";
import {
  ACKNOWLEDGMENT_TEXT_MAX,
  formFieldSchema,
  formFieldTypes,
  registrationFormDefinitionSchema,
  validateTestResponses,
} from "@/modules/forms/definition";
import { builderFieldModules, instantiateModuleFields } from "@/modules/forms/builder-modules";
import { createAttendeeRosterCsvTemplate, attendeeRosterExportColumns } from "@/modules/forms/attendee-roster-csv";
import { draftExcludedKeys, isDraftExcludedField } from "@/modules/forms/public-draft";
import { preparePublicRegistration } from "@/modules/forms/public-domain";
import { isTieredAttendeeFieldEditable } from "@/modules/attendee-accounts/registration-answer-policy";

// Obviously synthetic wording; no legal text.
const WORDING = "Synthetic acknowledgment wording for the field tests.";

const base = { helpText: "", required: false, options: [] as string[], scope: "REGISTRATION" as const };
const ack = (overrides: Record<string, unknown> = {}) => ({
  id: "f_ack", key: "ack_one", label: "Acknowledgment", type: "ACKNOWLEDGMENT", ...base,
  acknowledgment: { source: "TEXT", text: WORDING }, ...overrides,
});

function definition(fields: Array<Record<string, unknown>>, roster = true) {
  return registrationFormDefinitionSchema.parse({
    title: "Synthetic acknowledgment form",
    confirmationMessage: "Received.",
    ...(roster ? { attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 4 } } : {}),
    sections: [{
      id: "sec_one", title: "Everything", description: "", fields: [
        { id: "f_first", key: "first_name", label: "First name", type: "TEXT", scope: roster ? "ATTENDEE" : "REGISTRATION", required: true, options: [], helpText: "" },
        { id: "f_last", key: "last_name", label: "Last name", type: "TEXT", scope: roster ? "ATTENDEE" : "REGISTRATION", required: true, options: [], helpText: "" },
        { id: "f_email", key: "email", label: "Email", type: "EMAIL", scope: "REGISTRATION", required: true, options: [], helpText: "" },
        { id: "f_choice", key: "wants_program", label: "Program?", type: "RADIO", scope: "REGISTRATION", required: false, options: ["Yes", "No"], helpText: "" },
        ...fields,
      ],
    }],
  });
}

describe("the ACKNOWLEDGMENT field type is distinct from a checkbox (#150)", () => {
  it("is its own type in the shared list", () => {
    expect(formFieldTypes).toContain("ACKNOWLEDGMENT");
    expect(formFieldTypes).toContain("CHECKBOX");
  });

  it("carries the exact text, or a published policy version reference", () => {
    expect(formFieldSchema.parse(ack()).acknowledgment).toEqual({ source: "TEXT", text: WORDING });
    expect(formFieldSchema.parse(ack({ acknowledgment: { source: "POLICY_VERSION", policyVersionId: "version-1" } })).acknowledgment).toEqual({ source: "POLICY_VERSION", policyVersionId: "version-1" });
  });

  it("keeps the wording exactly as written, only trimming the ends", () => {
    const parsed = formFieldSchema.parse(ack({ acknowledgment: { source: "TEXT", text: `  Line one.\n\n  Line two  with spacing.  ` } }));
    expect(parsed.acknowledgment).toEqual({ source: "TEXT", text: "Line one.\n\n  Line two  with spacing." });
  });

  it.each([
    ["no wording or reference", { acknowledgment: undefined }, /wording or a policy version/],
    ["empty wording", { acknowledgment: { source: "TEXT", text: "   " } }, /wording/],
    ["wording that is too long", { acknowledgment: { source: "TEXT", text: "x".repeat(ACKNOWLEDGMENT_TEXT_MAX + 1) } }, /at most|<=/i],
    ["a blank policy version id", { acknowledgment: { source: "POLICY_VERSION", policyVersionId: "" } }, /.+/],
    ["a source that does not exist", { acknowledgment: { source: "SOMETHING", text: WORDING } }, /.+/],
    ["a price", { priceCents: 500 }, /carries no choices, price/],
    ["choices", { options: ["A", "B"] }, /carries no choices, price/],
    ["a credit", { creditCentsPerUnit: -100 }, /.+/],
  ])("refuses an acknowledgment with %s", (_label, overrides, message) => {
    const result = formFieldSchema.safeParse(ack(overrides));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(message);
  });

  it("refuses acknowledgment wording on any other field type", () => {
    const result = formFieldSchema.safeParse({ ...ack(), type: "CHECKBOX" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Only an acknowledgment field carries acknowledgment wording");
  });

  it("still reads every stored definition that has no acknowledgment field", () => {
    expect(formFieldSchema.parse({ id: "f_old", key: "old_box", label: "Old box", type: "CHECKBOX", ...base })).not.toHaveProperty("acknowledgment");
  });

  it("works at registration and attendee scope, with conditions, in a roster form", () => {
    const parsed = definition([
      ack({ id: "f_reg", key: "reg_ack", required: true }),
      ack({ id: "f_att", key: "att_ack", scope: "ATTENDEE" }),
      ack({ id: "f_cond", key: "cond_ack", conditional: { fieldKey: "wants_program", operator: "EQUALS", value: "Yes" } }),
    ]);
    expect(parsed.sections[0]!.fields.filter((field) => field.type === "ACKNOWLEDGMENT")).toHaveLength(3);
  });

  it("refuses a registration-level acknowledgment that depends on an attendee answer", () => {
    expect(() => definition([
      { id: "f_activity", key: "attending_activity", label: "Activity?", type: "RADIO", scope: "ATTENDEE", required: false, options: ["Yes", "No"], helpText: "" },
      ack({ id: "f_bad", key: "bad_ack", conditional: { fieldKey: "attending_activity", operator: "EQUALS", value: "Yes" } }),
    ])).toThrow(/cannot depend on an attendee answer/);
  });
});

describe("validating an acknowledgment answer", () => {
  const form = definition([
    ack({ id: "f_reg", key: "reg_ack", required: true }),
    ack({ id: "f_optional", key: "optional_ack" }),
    ack({ id: "f_cond", key: "cond_ack", required: true, conditional: { fieldKey: "wants_program", operator: "EQUALS", value: "Yes" } }),
  ], false);
  const answers = (extra: Record<string, unknown>) => ({ first_name: "Ann", last_name: "Sample", email: "ann@example.test", ...extra });
  const issueKeys = (responses: Record<string, unknown>) => validateTestResponses(form, responses).issues.map((issue) => issue.key);

  it("requires a required acknowledgment to be given", () => {
    expect(issueKeys(answers({}))).toContain("reg_ack");
    expect(issueKeys(answers({ reg_ack: false }))).toContain("reg_ack");
    expect(issueKeys(answers({ reg_ack: true }))).toEqual([]);
  });

  it("accepts only an acknowledgment that was actually given", () => {
    for (const bad of ["yes", "true", 1, ["true"]]) {
      expect(validateTestResponses(form, answers({ reg_ack: true, optional_ack: bad })).issues.map((issue) => issue.message)).toContain("Acknowledgment must be acknowledged.");
    }
    expect(issueKeys(answers({ reg_ack: true, optional_ack: true }))).toEqual([]);
    // An optional acknowledgment left unticked is no answer, not an error.
    expect(issueKeys(answers({ reg_ack: true, optional_ack: false }))).toEqual([]);
  });

  it("asks for a conditional acknowledgment only when its condition shows it", () => {
    expect(issueKeys(answers({ reg_ack: true, wants_program: "No" }))).toEqual([]);
    expect(issueKeys(answers({ reg_ack: true, wants_program: "Yes" }))).toEqual(["cond_ack"]);
    expect(issueKeys(answers({ reg_ack: true, wants_program: "Yes", cond_ack: true }))).toEqual([]);
  });

  it("prunes a hidden conditional acknowledgment from a public submission", () => {
    const prepared = preparePublicRegistration(form, {
      versionId: "v1", idempotencyKey: "00000000-0000-4000-8000-000000000001", website: "",
      responses: answers({ reg_ack: true, wants_program: "No", cond_ack: true }),
    }, { timeZone: "America/Chicago" });
    expect(prepared.issues).toEqual([]);
    expect(prepared.registrationResponses.cond_ack).toBeUndefined();
    expect(prepared.registrationResponses.reg_ack).toBe(true);
  });

  it("works per attendee in a repeating section", () => {
    const roster = definition([
      ack({ id: "f_att", key: "att_ack", scope: "ATTENDEE", required: true }),
    ]);
    const prepared = preparePublicRegistration(roster, {
      versionId: "v1", idempotencyKey: "00000000-0000-4000-8000-000000000002", website: "",
      responses: { email: "ann@example.test" },
      attendees: [
        { clientId: "a1", responses: { first_name: "Ann", last_name: "Sample", att_ack: true } },
        { clientId: "a2", responses: { first_name: "Bob", last_name: "Sample" } },
      ],
    }, { timeZone: "America/Chicago" });
    expect(prepared.issues.map((issue) => `${issue.attendeeIndex}:${issue.key}`)).toEqual(["1:att_ack"]);
  });
});

describe("drafts, previews, exports and self-service keep acknowledgments out", () => {
  const form = definition([
    ack({ id: "f_reg", key: "reg_ack", required: true }),
    ack({ id: "f_att", key: "att_ack", scope: "ATTENDEE" }),
    { id: "f_dep", key: "dependent_note", label: "Dependent note", type: "TEXT", scope: "REGISTRATION", required: false, options: [], helpText: "", conditional: { fieldKey: "reg_ack", operator: "NOT_EMPTY", value: "" } },
  ]);

  it("never saves an acknowledgment in a browser draft, nor an answer that depends on one", () => {
    const acknowledgment = form.sections[0]!.fields.find((field) => field.key === "reg_ack")!;
    expect(isDraftExcludedField(acknowledgment, form)).toBe(true);
    expect(isDraftExcludedField(form.sections[0]!.fields.find((field) => field.key === "att_ack")!, form)).toBe(true);
    expect(draftExcludedKeys(form).has("dependent_note")).toBe(true);
  });

  it("is not part of the attendee roster file, template or export", () => {
    expect(createAttendeeRosterCsvTemplate(form).trim().split(",")).not.toContain("att_ack");
    expect(attendeeRosterExportColumns(form)).not.toContain("Acknowledgment");
  });

  it("is never edited by an attendee from their own account", () => {
    expect(isTieredAttendeeFieldEditable(form.sections[0]!.fields.find((field) => field.key === "att_ack")!)).toBe(false);
  });

  it("is not offered on a club form", () => {
    const spec = addField(blankClubFormSpec("Synthetic Club Form"), "section_main");
    const field = spec.definition.sections[0]!.fields[spec.definition.sections[0]!.fields.length - 1]!;
    const withAck = updateField(spec, field.id, { type: "ACKNOWLEDGMENT", acknowledgment: { source: "TEXT", text: WORDING } } as never);
    const check = checkClubFormDraft(withAck, NO_PROTECTION_HISTORY);
    expect(check.ok).toBe(false);
    expect(check.issues.some((issue) => /recorded acknowledgments are not available on club forms/.test(issue.message))).toBe(true);
  });
});

describe("the builder module and settings", () => {
  it("offers a Recorded acknowledgment module that is a valid acknowledgment", () => {
    const recorded = builderFieldModules.find((candidate) => candidate.key === "recorded_acknowledgment")!;
    expect(recorded).toBeDefined();
    const [field] = instantiateModuleFields(recorded, new Set(), () => "field_new");
    expect(field).toMatchObject({ type: "ACKNOWLEDGMENT", required: true, acknowledgment: { source: "TEXT" } });
    expect(formFieldSchema.safeParse(field).success).toBe(true);
    // Each insert gets its own copy of the wording object.
    const [second] = instantiateModuleFields(recorded, new Set(), () => "field_two");
    expect(second!.acknowledgment).not.toBe(field!.acknowledgment);
  });

  it("starts a field changed to an acknowledgment with typed wording and none of what it cannot carry", () => {
    const patch = acknowledgmentTypePatch({ ...formFieldSchema.parse({ id: "f_x", key: "pick", label: "Pick", type: "RADIO", ...base, options: ["A", "B"], priceCents: undefined, choicePricesCents: { A: 100 } }) }, "ACKNOWLEDGMENT");
    expect(patch).toMatchObject({ acknowledgment: { source: "TEXT", text: "" }, options: [], choicePricesCents: undefined, priceCents: undefined, latePricing: undefined, placeholder: undefined });
    const back = acknowledgmentTypePatch(formFieldSchema.parse(ack()), "TEXT");
    expect(back).toEqual({ acknowledgment: undefined });
    expect(acknowledgmentTypePatch(formFieldSchema.parse({ id: "f_y", key: "plain", label: "Plain", type: "TEXT", ...base }), "NUMBER")).toEqual({});
  });

  it("keeps the wording the field already had when the type is set again", () => {
    expect(acknowledgmentTypePatch(formFieldSchema.parse(ack()), "ACKNOWLEDGMENT")).toMatchObject({ acknowledgment: { source: "TEXT", text: WORDING } });
  });

  it("lists acknowledgment-kind policy versions only, labelled by policy and version", () => {
    const version = (kind: string, id: string) => ({ id, versionNumber: 2, kind, title: "Synthetic title", effectiveFrom: null, effectiveTo: null, policy: { id: `p-${id}`, kind, scope: "EVENT", slug: id, name: "Synthetic policy" } });
    const versions = [version("ACKNOWLEDGMENT", "a"), version("WAIVER", "w"), version("CONSENT", "c")];
    expect(acknowledgmentPolicyChoices(versions).map((choice) => choice.id)).toEqual(["a"]);
    expect(policyVersionLabel(versions[0]!)).toBe("Synthetic policy — version 2: Synthetic title");
  });
});

describe("the screens (#150)", () => {
  const publicForm = readFileSync("components/public-registration-form.tsx", "utf8");
  const builder = readFileSync("components/registration-builder-workspace.tsx", "utf8");
  const settings = readFileSync("components/acknowledgment-field-settings.tsx", "utf8");
  const styles = readFileSync("app/globals.css", "utf8");

  it("shows the wording in full before the tick, and shows a policy version's text from the server", () => {
    expect(publicForm).toContain('field.type === "ACKNOWLEDGMENT"');
    expect(publicForm).toContain("form.acknowledgmentContent?.[field.id]");
    expect(publicForm).toContain("public-registration-acknowledgment-text");
    expect(publicForm).toContain("I acknowledge this.");
  });

  it("disables the box and says so when a policy version cannot be read, rather than recording nothing the person saw", () => {
    expect(publicForm).toContain("This acknowledgment is unavailable right now");
    expect(publicForm).toContain("disabled={!display}");
  });

  it("keeps the wording out of the review step's answer list", () => {
    expect(publicForm).toContain('|| field.type === "ACKNOWLEDGMENT"');
  });

  it("reads policy versions only through the slim builder read, and only acknowledgment-kind ones", () => {
    expect(settings).toContain("/api/events/${eventId}/consent-policy-versions");
    expect(settings).not.toContain("/consent-policies");
    expect(settings).toContain('version.kind === "ACKNOWLEDGMENT"');
    expect(builder).toContain("useAcknowledgmentPolicyVersions");
    expect(builder).toContain("AcknowledgmentFieldSettings");
  });

  it("labels the old checkbox as a checkbox so the two are never confused", () => {
    expect(builder).toContain('CHECKBOX: "Checkbox"');
    expect(builder).toContain('ACKNOWLEDGMENT: "Recorded acknowledgment"');
  });

  it("makes the wording region and the tick a comfortable touch target and keeps it inside the viewport", () => {
    expect(styles).toMatch(/\.public-registration-acknowledgment-text \{[^}]*overflow: auto/);
    expect(styles).toMatch(/\.public-registration-acknowledgment-text \{[^}]*max-height: 280px/);
    expect(styles).toMatch(/\.public-registration-acknowledgment-text p \{[^}]*overflow-wrap: anywhere/);
    expect(styles).toMatch(/\.public-registration-check \{[^}]*padding: 13px/);
  });
});
