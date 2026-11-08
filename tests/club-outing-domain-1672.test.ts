import { describe, expect, it } from "vitest";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import { definitionForLink } from "@/modules/club-forms/domain";
import {
  OUTING_PERMISSION_SECTION_ID,
  OUTING_QUESTIONS_SECTION_ID,
  definitionForOutingFill,
  outingDetailRows,
  outingLinkState,
  outingPresetAnswers,
  outingQuestionProblem,
  outingTimeLabel,
  parseOutingInput,
  withOutingQuestions,
} from "@/modules/club-forms/outing-domain";
import { ClubFormError } from "@/modules/club-forms/errors";

/** Outing permission slips (#1672): the pure rules. Synthetic data only. */

const slip = clubFormTemplateSeeds.find((seed) => seed.key === "off_premises_permission_slip")!;

const details = {
  activity: "Canoe trip",
  startDate: "2026-11-21",
  endDate: "",
  departureTime: "08:30",
  returnTime: "16:45",
  transportation: "Church van with Pat Sample",
  cost: "$15",
  whatToBring: "Lunch and a water bottle",
  note: "Meet at the church lot.",
};

const text = (label: string) => ({ label, type: "TEXT" as const, required: false, options: [] });

function refusal(raw: unknown) {
  try {
    parseOutingInput(raw);
  } catch (error) {
    if (error instanceof ClubFormError) return error;
    throw error;
  }
  return null;
}

describe("parseOutingInput", () => {
  it("accepts the details and up to five questions of the three allowed types", () => {
    const input = parseOutingInput({
      details,
      questions: [
        text("T-shirt size"),
        { label: "Can your child swim?", type: "YES_NO", required: true, options: ["ignored"] },
        { label: "Lunch choice", type: "CHOICE", required: false, options: ["Turkey", "Veggie"] },
      ],
    });
    expect(input.questions).toHaveLength(3);
    // Only a choice keeps its choices.
    expect(input.questions[1].options).toEqual([]);
    expect(input.questions[2].options).toEqual(["Turkey", "Veggie"]);
  });

  it("refuses a sixth question and an unknown question type", () => {
    expect(refusal({ details, questions: Array.from({ length: 6 }, (_, index) => text(`Question ${index}`)) })?.code).toBe("VALIDATION_FAILED");
    expect(refusal({ details, questions: [{ label: "Birthday?", type: "DATE", required: false, options: [] }] })?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a birth-date question by wording, whatever its type", () => {
    for (const label of ["Child's birth date", "Date of birth", "DOB", "How old is your child?", "What is your child's age?"]) {
      const error = refusal({ details, questions: [text(label)] });
      expect(error?.code, label).toBe("VALIDATION_FAILED");
      expect(error?.issues[0].key).toBe("question:1");
      expect(error?.message).toMatch(/Question 1 can't ask for a birth date/);
    }
  });

  it("refuses medical, health and dietary questions, even as yes or no, and in a choice's wording", () => {
    for (const label of ["Does your child take medication?", "Any health conditions?", "Food allergies", "Does your child have asthma?", "Dietary needs", "Insurance company"]) {
      const error = refusal({ details, questions: [{ label, type: "YES_NO", required: false, options: [] }] });
      expect(error?.code, label).toBe("VALIDATION_FAILED");
      expect(error?.message, label).toMatch(/can't ask for medical/);
    }
    const viaChoice = refusal({ details, questions: [{ label: "Anything we should know?", type: "CHOICE", required: false, options: ["Allergy", "Nothing"] }] });
    expect(viaChoice?.message).toMatch(/can't ask for medical/);
  });

  it("allows the examples the club needs, and ordinary uses of words that can be medical", () => {
    for (const label of ["T-shirt size", "Can your child swim?", "Who will pick your child up?", "Pick-up time", "Do you agree to the conditions?", "Is your child bringing sunglasses?", "Which weekend works best?"]) {
      expect(outingQuestionProblem({ label, options: [] }), label).toBeNull();
    }
  });

  it("refuses the other ways a club could ask for medical details", () => {
    for (const label of ["Does your child wear glasses?", "Any food restrictions?", "Does your child eat meat?", "Takes pills?", "Uses a wheelchair", "Child's weight", "Does your child have ADHD?", "Any conditions we should know about?", "Diagnosed with anything?", "Nurse on call?", "Last hospital visit"]) {
      expect(outingQuestionProblem({ label, options: [] }), label).toMatch(/medical|birth/);
    }
  });

  it("checks the details: a real date, a last date not before the first, times, and required text", () => {
    expect(refusal({ details: { ...details, startDate: "2026-02-30" }, questions: [] })?.message).toMatch(/real date/);
    expect(refusal({ details: { ...details, endDate: "2026-11-20" }, questions: [] })?.message).toMatch(/before the first date/);
    expect(refusal({ details: { ...details, departureTime: "8am" }, questions: [] })?.message).toMatch(/time like 08:30/);
    expect(refusal({ details: { ...details, activity: "  " }, questions: [] })?.message).toMatch(/Enter the activity/);
    expect(refusal({ details: { ...details, transportation: "" }, questions: [] })?.message).toMatch(/Enter how/);
  });

  it("reports every missing detail at once, each by its own field", () => {
    const error = refusal({ details: { ...details, activity: "", transportation: "" }, questions: [] });
    expect(error?.issues.map((issue) => issue.key)).toEqual(["activity", "transportation"]);
  });

  it("needs at least two different choices on a choice question", () => {
    expect(refusal({ details, questions: [{ label: "Lunch", type: "CHOICE", required: false, options: ["Turkey"] }] })?.message).toMatch(/at least 2 choices/);
    expect(refusal({ details, questions: [{ label: "Lunch", type: "CHOICE", required: false, options: ["Turkey", "turkey"] }] })?.message).toMatch(/must be different/);
  });
});

describe("the slip's definition for an outing", () => {
  const questions = [text("T-shirt size")];
  const base = definitionForLink(slip);

  it("leaves every required section of the conference slip exactly as the template has it", () => {
    const filled = definitionForOutingFill(base, questions, "Alpha Pathfinders");
    for (const id of ["sec_child", "sec_parent", "sec_medical"]) {
      expect(filled.sections.find((section) => section.id === id), id).toEqual(base.sections.find((section) => section.id === id));
    }
    // The permission section keeps its title and its wording note; only the three typed fields stand aside.
    const permission = filled.sections.find((section) => section.id === OUTING_PERMISSION_SECTION_ID)!;
    expect(permission.title).toBe(base.sections.find((section) => section.id === OUTING_PERMISSION_SECTION_ID)!.title);
    expect(permission.fields).toEqual([]);
    expect(slip.sectionNotes[OUTING_PERMISSION_SECTION_ID][0]).toMatch(/I hereby give my permission/);
    // Medical and signature wording lives in the template's own section notes, untouched.
    expect(Object.keys(slip.sectionNotes)).toContain("sec_medical");
    expect(filled.sections.map((section) => section.id)).toEqual(["sec_child", "sec_permission", OUTING_QUESTIONS_SECTION_ID, "sec_parent", "sec_medical"]);
  });

  it("makes the club's questions slip fields, never sensitive and never required unless the club says so", () => {
    const section = withOutingQuestions(base, [{ label: "Can your child swim?", type: "YES_NO", required: true, options: [] }, { label: "Lunch", type: "CHOICE", required: false, options: ["A", "B"] }]).sections.find((candidate) => candidate.id === OUTING_QUESTIONS_SECTION_ID)!;
    expect(section.fields.map((field) => [field.key, field.type, field.required, field.options])).toEqual([
      ["outing_q_1", "RADIO", true, ["Yes", "No"]],
      ["outing_q_2", "RADIO", false, ["A", "B"]],
    ]);
    expect(slip.sensitiveFieldKeys).toEqual([]);
  });

  it("adds no section when there are no questions", () => {
    expect(withOutingQuestions(base, [])).toBe(base);
  });

  it("presets the three typed answers from the outing", () => {
    expect(outingPresetAnswers(parseOutingInput({ details, questions: [] }).details)).toEqual({
      activity: "Canoe trip",
      activity_date: "2026-11-21",
      ride_with: "Church van with Pat Sample",
    });
  });
});

describe("how an outing reads to a parent and the director", () => {
  it("lists the details read-only, leaving out what is empty, with times unshifted", () => {
    const rows = outingDetailRows(parseOutingInput({ details: { ...details, cost: "", note: "" }, questions: [] }).details, slip.definition);
    // The slip's own wording for its three typed fields, read from the template.
    expect(rows.map((row) => row.label)).toEqual([
      "I hereby give my permission for my child to participate in the pre-planned activity of",
      "On the date of",
      "Leaving",
      "Back",
      "I give my child permission to ride with",
      "What to bring",
    ]);
    expect(rows.find((row) => row.label === "On the date of")?.value).toBe("November 21, 2026");
    expect(rows.find((row) => row.label === "Leaving")?.value).toBe("8:30 AM");
    expect(rows.find((row) => row.label === "Back")?.value).toBe("4:45 PM");
    expect(outingTimeLabel("")).toBe("");
  });

  it("names several dates as a range", () => {
    const rows = outingDetailRows(parseOutingInput({ details: { ...details, endDate: "2026-11-23" }, questions: [] }).details, slip.definition);
    expect(rows.find((row) => row.label === "On the date of")?.value).toBe("November 21–23, 2026");
  });

  it("takes the labels from the template, so an edited label follows and a removed field leaves its row out", () => {
    const edited = {
      ...slip.definition,
      sections: slip.definition.sections.map((section) => ({
        ...section,
        fields: section.fields.flatMap((field) => (field.key === "ride_with" ? [] : [field.key === "activity" ? { ...field, label: "Edited activity wording" } : field])),
      })),
    };
    const rows = outingDetailRows(parseOutingInput({ details, questions: [] }).details, edited);
    expect(rows[0]).toEqual({ label: "Edited activity wording", value: "Canoe trip" });
    expect(rows.some((row) => row.value === details.transportation)).toBe(false);
  });

  it("reads each link as signed, not yet or link expired", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const later = new Date("2026-11-20T12:00:00Z");
    const earlier = new Date("2026-11-01T12:00:00Z");
    expect(outingLinkState({ status: "USED", expiresAt: earlier }, now)).toBe("SIGNED");
    expect(outingLinkState({ status: "OPEN", expiresAt: later }, now)).toBe("NOT_YET");
    expect(outingLinkState({ status: "OPEN", expiresAt: earlier }, now)).toBe("EXPIRED");
    expect(outingLinkState({ status: "REVOKED", expiresAt: later }, now)).toBe("EXPIRED");
  });
});
