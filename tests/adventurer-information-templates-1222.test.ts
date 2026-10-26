import { describe, expect, it } from "vitest";
import { codeFormTemplates } from "@/modules/forms/form-template-library-domain";
import { formTemplates, memberListProblems, registrationFormDefinitionSchema, templatesForPicker, validateTestResponses, type RegistrationFormField } from "@/modules/forms/definition";
import { isInformationTemplateAudience } from "@/modules/forms/information-audience";
import { adventurerInformationTemplates, ADVENTURER_LEVELS } from "@/modules/information-forms/adventurer-templates";
import { ADVENTURER_ANNUAL_INTRO, ADVENTURER_PARENT_GUARDIAN_NAME_LABEL, ADVENTURER_PHOTO_RELEASE_TEXT, ADVENTURER_PURPOSE_STATEMENT, informationFormDefinitionIssues, informationFormDefinitionSchema, informationFormFields } from "@/modules/information-forms/definition";

/** #1222: the four Adventurer club forms as information form templates, and the one narrow member list exception. */

const byKey = (key: string) => adventurerInformationTemplates.find((template) => template.key === key)!;
const annual = () => structuredClone(byKey("adventurer_annual_registration").definition);

function memberField(definition: ReturnType<typeof annual>) {
  return definition.sections.flatMap((section) => section.fields).find((field) => field.type === "MEMBER_LIST")!;
}

describe("the four Adventurer templates (#1222)", () => {
  it("are four information-audience code templates that pass the information form check", () => {
    expect(adventurerInformationTemplates.map((template) => template.name)).toEqual([
      "Adventurer Program Club Application",
      "Adventurer Monthly Report",
      "Adventurer Club Photo and Video Release",
      "Annual Adventurer Club Registration",
    ]);
    for (const template of adventurerInformationTemplates) {
      expect(isInformationTemplateAudience(template.audience), template.key).toBe(true);
      expect(formTemplates.some((candidate) => candidate.key === template.key), template.key).toBe(true);
      expect(codeFormTemplates().some((candidate) => candidate.key === template.key), template.key).toBe(true);
      expect(informationFormDefinitionIssues(registrationFormDefinitionSchema.parse(template.definition)), template.key).toEqual([]);
      expect(informationFormDefinitionSchema.safeParse(template.definition).success, template.key).toBe(true);
    }
  });

  it("carry no payment, attendee roster, attendee-scope or calculated fields", () => {
    for (const template of adventurerInformationTemplates) {
      const definition = registrationFormDefinitionSchema.parse(template.definition);
      expect(definition.payment).toBeUndefined();
      expect(definition.attendeeRoster).toBeUndefined();
      for (const field of informationFormFields(definition)) {
        expect(field.scope, field.key).toBe("REGISTRATION");
        expect(field.type, field.key).not.toBe("CALCULATED");
        expect(field.sensitive, field.key).not.toBe(true);
      }
    }
  });

  it("never show in a registration form's template picker", () => {
    const picked = templatesForPicker(codeFormTemplates(), "Individual").map((template) => template.key);
    for (const template of adventurerInformationTemplates) expect(picked).not.toContain(template.key);
  });

  it("keep the application's fields and the youth contact line", () => {
    const definition = byKey("adventurer_club_application").definition;
    expect(definition.description).toBe("To be completed one time only by the Adventurer Leader of a NEW CLUB, signed by the church board of the sponsoring church, and submitted to the conference office.");
    const fields = informationFormFields(definition);
    expect(fields.map((field) => field.type)).toContain("ADDRESS");
    expect(fields.find((field) => field.key === "signature_club_director")?.required).toBe(true);
    expect(fields.find((field) => field.key === "signature_board_member_4")?.required).toBe(false);
    expect(JSON.stringify(definition)).toContain("(515) 223-1197");
  });

  it("monthly report: points are typed numbers, nothing is calculated, and the online event list is used", () => {
    const fields = informationFormFields(byKey("adventurer_monthly_report").definition);
    expect(fields.find((field) => field.key === "total_points")).toMatchObject({ type: "NUMBER", required: true });
    expect(fields.find((field) => field.key === "events_held_or_attended")?.options).toEqual([
      "Induction Blessing Service", "Investiture", "Fun Day", "Adventurer Family Campout at Sunnydale", "Adventurer Sabbath", "Leadership Summit at Camp Heritage", "Awards Day",
    ]);
    for (const level of ADVENTURER_LEVELS) expect(fields.some((field) => field.label === level && field.type === "NUMBER")).toBe(true);
  });

  it("release form asks for the signer, minor, club and the director's email, all required", () => {
    const fields = informationFormFields(byKey("adventurer_photo_video_release").definition);
    expect(fields.every((field) => field.required)).toBe(true);
    expect(fields.find((field) => field.key === "director_email")?.type).toBe("EMAIL");
  });
});

describe("the member list exception (#1222)", () => {
  it("is accepted on the annual registration, with exactly name, age, level and working on", () => {
    const field = memberField(annual());
    expect(field.memberColumns?.map((column) => column.key)).toEqual(["name", "age", "level", "working_on"]);
    expect(field.options).toEqual([...ADVENTURER_LEVELS]);
    expect(informationFormDefinitionSchema.safeParse(annual()).success).toBe(true);
  });

  it("refuses a member list with an extra column such as a birth date", () => {
    const definition = annual();
    memberField(definition).memberColumns!.push({ key: "birthdate", label: "Birth date", type: "TEXT", required: false });
    const messages = informationFormDefinitionIssues(registrationFormDefinitionSchema.parse(definition)).map((issue) => issue.message);
    expect(messages.join(" ")).toContain("a member list may collect only name, age, level and what they are working on");
    expect(informationFormDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  it("refuses an extra column of any other kind, a changed column type, and a missing column", () => {
    const extra = annual();
    memberField(extra).memberColumns!.push({ key: "school", label: "School", type: "TEXT", required: false });
    expect(informationFormDefinitionSchema.safeParse(extra).success).toBe(false);
    const retyped = annual();
    memberField(retyped).memberColumns![1] = { key: "age", label: "Age", type: "TEXT", required: true };
    expect(informationFormDefinitionSchema.safeParse(retyped).success).toBe(false);
    const missing = annual();
    memberField(missing).memberColumns = memberField(missing).memberColumns!.slice(0, 3);
    expect(informationFormDefinitionSchema.safeParse(missing).success).toBe(false);
  });

  it("refuses a sensitive label on an allowed column, inside the member list", () => {
    for (const label of ["Date of birth", "Health notes", "Parent name"]) {
      const definition = annual();
      memberField(definition).memberColumns![3] = { key: "working_on", label, type: "TEXT", required: false };
      expect(informationFormDefinitionSchema.safeParse(definition).success, label).toBe(false);
    }
  });

  it("still refuses birth-date and health fields next to the member list", () => {
    for (const label of ["Birth date", "Allergies", "Medications"]) {
      const definition = annual();
      definition.sections[0]!.fields.push({ id: "field_extra", key: "extra_question", label, helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] });
      expect(informationFormDefinitionSchema.safeParse(definition).success, label).toBe(false);
    }
  });

  it("keeps the roster and attendee-scope refusals, and allows only one member list", () => {
    const attendeeScoped = annual();
    memberField(attendeeScoped).scope = "ATTENDEE";
    expect(informationFormDefinitionSchema.safeParse(attendeeScoped).success).toBe(false);
    const roster = annual();
    (roster as { attendeeRoster?: unknown }).attendeeRoster = { enabled: true, minAttendees: 1, maxAttendees: 4, attendeeLabel: "Attendee", addButtonLabel: "Add" };
    expect(informationFormDefinitionSchema.safeParse(roster).success).toBe(false);
    const two = annual();
    two.sections[0]!.fields.push({ ...memberField(two), id: "field_members_two", key: "members_two" });
    expect(informationFormDefinitionSchema.safeParse(two).success).toBe(false);
  });

  it("only a member list can carry columns", () => {
    const definition = annual();
    definition.sections[0]!.fields[0]!.memberColumns = [{ key: "name", label: "Name", type: "TEXT", required: true }];
    expect(registrationFormDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  it("checks each row: columns, ages, levels and blank rows", () => {
    const field = memberField(annual()) as RegistrationFormField;
    expect(memberListProblems(field, [{ name: "Sample Member", age: 6, level: "Busy Bee", working_on: "Pets honor" }, { name: "Another Sample", age: "4", level: "Eager Beaver" }])).toEqual([]);
    expect(memberListProblems(field, [{ name: "Sample Member", age: 6, level: "Busy Bee", birthdate: "2020-01-01" }]).join(" ")).toContain("a column this form does not ask for");
    expect(memberListProblems(field, [{ name: "Sample Member", age: 200, level: "Busy Bee" }])).not.toEqual([]);
    expect(memberListProblems(field, [{ name: "Sample Member", age: 6, level: "Pathfinder" }])).not.toEqual([]);
    expect(memberListProblems(field, [{ name: "", age: "", level: "" }])).not.toEqual([]);
    expect(memberListProblems(field, "not rows")).not.toEqual([]);
    expect(memberListProblems(field, Array.from({ length: 61 }, () => ({ name: "A Name", age: 5, level: "Sunbeam" })))).not.toEqual([]);
  });

  it("validates the whole answer, and a required member list needs a row", () => {
    const definition = registrationFormDefinitionSchema.parse(annual());
    const answers = { club_name: "Sample Club", sponsoring_church: "Sample Church", leader_first_name: "Sample", leader_last_name: "Leader", leader_email: "leader@example.test" };
    expect(validateTestResponses(definition, { ...answers, members: [{ name: "Sample Member", age: 6, level: "Busy Bee" }] }).isValid).toBe(true);
    expect(validateTestResponses(definition, { ...answers, members: [{ name: "Sample Member", age: 6, level: "Busy Bee", birthdate: "x" }] }).isValid).toBe(false);
    definition.sections.flatMap((section) => section.fields).find((field) => field.key === "members")!.required = true;
    expect(validateTestResponses(definition, answers).isValid).toBe(false);
  });
});

describe("the word-for-word exception (#1222)", () => {
  const field = (extra: Record<string, unknown>) => ({ id: "field_extra", key: "extra_question", label: "Extra question", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], ...extra });
  const refused = (definition: unknown) => !informationFormDefinitionSchema.safeParse(definition).success;

  it("puts each exact text on the templates and accepts them", () => {
    const text = (key: string) => JSON.stringify(byKey(key).definition);
    expect(text("adventurer_club_application")).toContain(JSON.stringify(ADVENTURER_PURPOSE_STATEMENT));
    expect(text("adventurer_annual_registration")).toContain(JSON.stringify(ADVENTURER_ANNUAL_INTRO));
    expect(text("adventurer_photo_video_release")).toContain(JSON.stringify(ADVENTURER_PHOTO_RELEASE_TEXT));
    expect(ADVENTURER_PHOTO_RELEASE_TEXT.endsWith("heirs, assigns and personal representatives.")).toBe(true);
    expect(ADVENTURER_ANNUAL_INTRO).toContain("added to the conference insurance.");
    expect(text("adventurer_photo_video_release")).toContain("Parent/Guardian Name");
    expect(text("adventurer_photo_video_release")).toContain("Parent/Guardian Signature");
    expect(text("adventurer_monthly_report")).toContain("Held a Child/Parent activity?");
    for (const template of adventurerInformationTemplates) expect(informationFormDefinitionSchema.safeParse(template.definition).success, template.key).toBe(true);
  });

  it("accepts an allowlisted text with extra whitespace, as a description, a section text, a label or a help text", () => {
    const base = annual();
    expect(informationFormDefinitionSchema.safeParse({ ...base, description: ADVENTURER_ANNUAL_INTRO.replace(". ", ".\n") }).success).toBe(true);
    const withText = (extra: Record<string, unknown>) => ({ ...base, sections: [{ id: "section_x", title: "Section", description: "", fields: [field(extra)] }] });
    expect(informationFormDefinitionSchema.safeParse(withText({ label: ADVENTURER_PARENT_GUARDIAN_NAME_LABEL })).success).toBe(true);
    expect(informationFormDefinitionSchema.safeParse(withText({ helpText: ADVENTURER_PARENT_GUARDIAN_NAME_LABEL })).success).toBe(true);
  });

  it("refuses an edited copy again, even by one word, anywhere the text sits", () => {
    const base = annual();
    const edited = (text: string) => `${text.slice(0, -1)} and medications.`;
    expect(refused({ ...base, description: edited(ADVENTURER_ANNUAL_INTRO) })).toBe(true);
    expect(refused({ ...base, description: `${ADVENTURER_ANNUAL_INTRO} Thanks.` })).toBe(true);
    const section = (description: string) => ({ ...base, description: "", sections: [{ id: "section_x", title: "Section", description, fields: [field({})] }] });
    expect(refused(section(ADVENTURER_PHOTO_RELEASE_TEXT.replace("and/or", "or")))).toBe(true);
    expect(refused(section(ADVENTURER_PURPOSE_STATEMENT.replace("pre-school", "preschool")))).toBe(true);
    expect(refused(section(`${ADVENTURER_PURPOSE_STATEMENT} Please list your parents.`))).toBe(true);
    const labelled = (label: string) => ({ ...base, sections: [{ id: "section_x", title: "Section", description: "", fields: [field({ label })] }] });
    expect(refused(labelled("Parent/Guardian Names"))).toBe(true);
    expect(refused(labelled("Parent/Guardian Name or birth date"))).toBe(true);
    expect(refused(labelled("Held a Child/Parent activity"))).toBe(true);
  });

  it("does not exempt keys: an allowlisted label on a sensitive key is still refused", () => {
    const base = annual();
    const keyed = (key: string, label: string) => ({ ...base, sections: [{ id: "section_x", title: "Section", description: "", fields: [field({ key, label })] }] });
    expect(refused(keyed("parent_guardian_name", ADVENTURER_PARENT_GUARDIAN_NAME_LABEL))).toBe(true);
    expect(refused(keyed("signer_name", ADVENTURER_PARENT_GUARDIAN_NAME_LABEL))).toBe(false);
  });

  it("still refuses medical, birth-date and health fields on the same form", () => {
    for (const label of ["Medications", "Date of birth", "Health conditions", "Allergies"]) {
      const definition = byKey("adventurer_photo_video_release").definition;
      const withField = { ...structuredClone(definition), sections: [...structuredClone(definition.sections), { id: "section_more", title: "More", description: "", fields: [field({ label })] }] };
      expect(refused(withField), label).toBe(true);
    }
    const sensitiveFlag = structuredClone(byKey("adventurer_photo_video_release").definition);
    sensitiveFlag.sections[0]!.fields[0]!.sensitive = true;
    expect(refused(sensitiveFlag)).toBe(true);
  });
});
