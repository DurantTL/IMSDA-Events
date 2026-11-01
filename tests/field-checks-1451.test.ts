import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateGuardianForm } from "@/modules/club-rosters/guardians-domain";
import { newClubApplicationInputSchema } from "@/modules/club-applications/domain";
import { inlineFieldProblem, inlinePhoneProblem, phoneToStore, emailToStore, PHONE_FIELD_MESSAGE, EMAIL_FIELD_MESSAGE } from "@/lib/field-validation";
import { registrationFormDefinitionSchema, typedAnswerProblem, validateTestResponses } from "@/modules/forms/definition";
import { healthRecordInputSchemaFor } from "@/modules/health-records/domain";
import { syntheticRecord } from "./health-records-fixtures";

/**
 * Rule 8 (#1451, site rule B8): one check and one message for phone, email and dates. Synthetic values only.
 */

const root = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((entry) => {
    const relative = path.join(dir, entry);
    if (statSync(path.join(root, relative)).isDirectory()) return sourceFiles(relative);
    return /\.tsx$/.test(entry) ? [relative] : [];
  });
}

const files = [...sourceFiles("app"), ...sourceFiles("components")];

describe("every phone field is a PhoneInput", () => {
  /** A file that may keep a literal `type="tel"`, with the reason. None today. */
  const telAllowList: Record<string, string> = {
    "components/registration-builder/builder-preview.tsx": "A non-interactive preview of a form field in the builder; nothing is saved from it.",
    "components/search-as-you-type.tsx": "A list of input types the search box treats as typed text, not an input.",
    "components/registration-amendment-editor.tsx": "One generic input whose type, keypad and autofill follow the form field's type (email, phone, date, number); its message is the shared one.",
    "components/public-registration-form.tsx": "One generic input whose type, keypad and autofill follow the form field's type (email, phone, date, number); its message is the shared one.",
    "components/phone-input.tsx": "PhoneInput itself is the one place the tel input is made (through inputAttributesFor).",
  };

  it("finds no tel type, keypad or autofill outside PhoneInput in app and components", () => {
    const offenders = files.filter((file) => !(file.replace(/\\/g, "/") in telAllowList) && /["']tel["']/.test(readFileSync(path.join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("email inputs", () => {
  /**
   * Files that still make a raw type="email" input, with why. The converted forms (club application, club profile,
   * roster emergency contacts, sign-in, invite a person, pastor contact, event content blocks, year-end report,
   * registration contact forms) use EmailInput.
   * A new raw email input fails this test: use EmailInput, or add the file here with the reason.
   */
  const NOT_YET = "Not yet on EmailInput: still a raw email input with the browser's own check. Follow-up for B8.";
  const rawEmailAllowList: Record<string, string> = {
    "app/(workspace)/admin/system-report/email-tester-card.tsx": NOT_YET,
    "components/attendee-password-reset-form.tsx": NOT_YET,
    "components/password-reset-request-form.tsx": NOT_YET,
    "components/attendee-verify-by-address-form.tsx": NOT_YET,
    "components/attendee-sign-in-form.tsx": NOT_YET,
    "components/attendee-sign-up-form.tsx": NOT_YET,
    "components/public-registration-recovery-form.tsx": NOT_YET,
    "components/club-directors-workspace.tsx": NOT_YET,
    "components/club-team-workspace.tsx": NOT_YET,
    "components/club-forms-actions.tsx": NOT_YET,
    "components/club-import-workspace.tsx": NOT_YET,
    "components/club-registration-editor.tsx": NOT_YET,
    "components/club-registration-workspace.tsx": NOT_YET,
    "components/communications-workspace.tsx": NOT_YET,
    "components/email-delivery-section.tsx": NOT_YET,
    "components/event-settings-workspace.tsx": NOT_YET,
    "components/health-record-actions.tsx": NOT_YET,
    "components/honors-instructors-workspace.tsx": NOT_YET,
    "components/new-club-applications-queue.tsx": NOT_YET,
    "components/notifications-workspace.tsx": NOT_YET,
    "components/organization-billing-contact.tsx": NOT_YET,
    "components/people-workspace.tsx": NOT_YET,
    "components/person-access-controls.tsx": NOT_YET,
    "components/platform-settings-workspace.tsx": NOT_YET,
    "components/staff-workspace.tsx": NOT_YET,
    "components/staff-invitation-registration.tsx": "A read-only, disabled display of the invited address; nothing is typed.",
  };

  it("finds no unlisted raw type=\"email\" input", () => {
    const raw = files.filter((file) => file !== "components/email-input.tsx" && file.endsWith(".tsx") && /type=["']email["']/.test(readFileSync(path.join(root, file), "utf8")));
    const normalised = raw.map((file) => file.replace(/\\/g, "/"));
    expect(normalised.filter((file) => !(file in rawEmailAllowList))).toEqual([]);
    // A listed file that no longer has one should leave the list.
    expect(Object.keys(rawEmailAllowList).filter((file) => !normalised.includes(file))).toEqual([]);
  });

  it("uses EmailInput on the forms the issue names", () => {
    for (const file of ["components/club-year-end-report-form.tsx", "components/attendee-registration-contact-form.tsx", "components/public-registration-contact-form.tsx", "components/new-club-application-form.tsx", "components/club-profile-form.tsx", "components/roster-guardian-fields.tsx", "components/club-form-roster-add.tsx", "components/login-form.tsx", "components/invite-person.tsx"]) {
      expect(readFileSync(path.join(root, file), "utf8"), file).toContain("<EmailInput");
    }
  });

  it("keeps the browser's own bubble off sign-in", () => {
    expect(readFileSync(path.join(root, "components/login-form.tsx"), "utf8")).toContain("noValidate");
  });
});

describe("one phone message and one email message", () => {
  const bad = "idk 911";

  it("gives the profile path and the roster path the same message for the same bad phone", () => {
    let profile = "";
    try {
      phoneToStore(["contactPhone"], bad, undefined);
    } catch (error) {
      profile = (error as { issues: Array<{ message: string }> }).issues[0].message;
    }
    const roster = validateGuardianForm([{ email: "", phone: bad }], []).g1Phone;
    expect(profile).toBe(PHONE_FIELD_MESSAGE);
    expect(roster).toBe(PHONE_FIELD_MESSAGE);
    expect(inlinePhoneProblem("Phone", bad, undefined, true).message).toBe(PHONE_FIELD_MESSAGE);
    expect(inlineFieldProblem("Phone", "phone", bad, undefined, true).message).toBe(PHONE_FIELD_MESSAGE);
  });

  it("gives every email path the same message", () => {
    let profile = "";
    try {
      emailToStore(["contactEmail"], "not an email", undefined);
    } catch (error) {
      profile = (error as { issues: Array<{ message: string }> }).issues[0].message;
    }
    expect(profile).toBe(EMAIL_FIELD_MESSAGE);
    expect(validateGuardianForm([{ email: "not an email", phone: "" }], []).g1Email).toBe(EMAIL_FIELD_MESSAGE);
    expect(inlineFieldProblem("Email", "email", "not an email", undefined, true).message).toBe(EMAIL_FIELD_MESSAGE);
    expect(newClubApplicationInputSchema.safeParse({ directorEmail: "not an email" }).error?.issues.find((issue) => issue.path[0] === "directorEmail")?.message).toBe(EMAIL_FIELD_MESSAGE);
  });

  it("uses the same wording for form answers and health records", () => {
    const field = { type: "PHONE", key: "phone", label: "Phone" } as never;
    expect(typedAnswerProblem(field, bad)).toBe(PHONE_FIELD_MESSAGE);
    expect(typedAnswerProblem({ type: "EMAIL", key: "email", label: "Email" } as never, "nope")).toBe(EMAIL_FIELD_MESSAGE);
    const health = healthRecordInputSchemaFor({}).safeParse({ ...syntheticRecord, phone: bad });
    const messages = health.error?.issues.filter((issue) => issue.path[0] === "phone").map((issue) => issue.message) ?? [];
    expect(messages).toContain(PHONE_FIELD_MESSAGE);
  });

  it("keeps one date wording", () => {
    expect(typedAnswerProblem({ type: "DATE", key: "when", label: "When" } as never, "2026-02-30")).toBe("When must be a valid date.");
  });
});

describe("club application phones (#1451)", () => {
  const application = (overrides: Record<string, unknown>) => ({
    clubName: "Synthetic Trailblazers",
    sponsoringChurchId: "church-1",
    pastorName: "Pat Pastor",
    directorName: "Dana Director",
    directorAddress: "100 Example Road, Sampletown, ZZ 00000",
    directorEmail: "dana.director@example.test",
    directorHomePhone: "(515) 555-0100",
    directorWorkPhone: "",
    philosophyAgreed: true,
    pastorSignature: "Pat Pastor",
    headElderSignature: "Hal Elder",
    clerkSignature: "Cleo Clerk",
    directorSignature: "Dana Director",
    formOpenedAt: 1_700_000_000_000,
    ...overrides,
  });

  it("rejects numbers that fail the shared check, with the one message, and stores nothing", () => {
    for (const phone of ["(555) 010-0100", "555-0100"]) {
      for (const key of ["directorHomePhone", "directorWorkPhone"]) {
        const result = newClubApplicationInputSchema.safeParse(application({ [key]: phone }));
        expect(result.success, `${key} ${phone}`).toBe(false);
        const issue = result.error?.issues.find((entry) => entry.path[0] === key);
        expect(issue?.message).toBe(PHONE_FIELD_MESSAGE);
        expect(JSON.stringify(result.error?.issues)).not.toContain(phone);
      }
    }
  });

  it("accepts a valid number and stores it normalised", () => {
    expect(newClubApplicationInputSchema.parse(application({ directorHomePhone: "(515) 555-0100" })).directorHomePhone).toBe("(515) 555-0100");
    expect(newClubApplicationInputSchema.parse(application({ directorHomePhone: "", directorWorkPhone: "5155550134" })).directorWorkPhone).toBe("(515) 555-0134");
  });

  it("still needs one phone and a real director email", () => {
    expect(newClubApplicationInputSchema.safeParse(application({ directorHomePhone: "" })).success).toBe(false);
    expect(newClubApplicationInputSchema.safeParse(application({ directorEmail: "" })).success).toBe(false);
  });
});

describe("server issues name the field (#1451)", () => {
  const field = (key: string, label: string, type: string) => ({ id: `f_${key}`, key, label, type, helpText: "", scope: "REGISTRATION", required: false, options: [] });
  const definition = registrationFormDefinitionSchema.parse({
    title: "Fixture",
    description: "Fictitious.",
    confirmationMessage: "Done.",
    sections: [{ id: "details_section", title: "Details", description: "", fields: [field("cell", "Cell phone", "PHONE"), field("backup", "Backup email", "EMAIL")] }],
  });

  it("labels the shared phone and email message with the field it is about", () => {
    const result = validateTestResponses(definition, { cell: "idk 911", backup: "not an email" });
    expect(result.issues.map((issue) => issue.message)).toEqual([
      `Cell phone: ${PHONE_FIELD_MESSAGE}`,
      `Backup email: ${EMAIL_FIELD_MESSAGE}`,
    ]);
  });
});

describe("the error variant of the field message lays out like every other field error", () => {
  it("is a flex row, so the icon sits beside the text", () => {
    const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
    const rule = /\.field-error-message\.phone-input-message[^{]*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/display:\s*flex/);
    expect(css.indexOf(".field-error-message.phone-input-message")).toBeLessThan(css.indexOf("Registration form builder editor shell (#1132"));
  });
});
