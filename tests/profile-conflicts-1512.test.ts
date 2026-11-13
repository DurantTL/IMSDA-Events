import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountHolderAttendeeIndex,
  enteredProfileValues,
  isStaffPersonalValueField,
  staffPersonalValueFields,
  historyEntriesFor,
  isValueKeptField,
  profileConflicts,
  profileReviewVersion,
  reviewableFields,
  type ReviewableProfile,
} from "@/modules/attendee-accounts/profile-conflicts";

const profile: ReviewableProfile = {
  firstName: "Avery",
  lastName: "Person",
  phone: "(515) 555-0100",
  shirtSize: "M",
  mailingLine1: "1 Example Way",
  mailingLine2: "",
  mailingCity: "Sampletown",
  mailingRegion: "MI",
  mailingPostalCode: "49000",
  mailingCountry: "United States",
  emergencyContactName: "Casey Contact",
  emergencyContactPhone: "(515) 555-0101",
};

const fieldsOf = (responses: Record<string, unknown>, includePersonal = true) =>
  profileConflicts(profile, responses, includePersonal).map((conflict) => conflict.field);

describe("profile conflicts (#1512)", () => {
  it("finds no conflict when the answers match, ignoring case, spacing and phone punctuation", () => {
    expect(fieldsOf({
      first_name: "  avery ",
      last_name: "PERSON",
      phone: "515.555.0100",
      shirt_size: "m",
    })).toEqual([]);
    expect(fieldsOf({ phone: "+1 515 555 0100" })).toEqual([]);
  });

  it("reports a differing value with the saved and entered values", () => {
    const [conflict] = profileConflicts(profile, { last_name: "Persona", shirt_size: "M" }, true);
    expect(conflict).toEqual({
      field: "lastName",
      label: "Last name",
      savedValue: "Person",
      enteredValue: "Persona",
      kind: "different",
    });
  });

  it("never treats an empty entered value as a conflict", () => {
    expect(fieldsOf({ first_name: "", last_name: "   ", phone: "", shirt_size: undefined, mailing_address: {} })).toEqual([]);
  });

  it("offers an entered value as an addition when the profile has none", () => {
    const [conflict] = profileConflicts({ ...profile, shirtSize: "" }, { shirt_size: "L" }, true);
    expect(conflict).toMatchObject({ field: "shirtSize", savedValue: "", enteredValue: "L", kind: "addition" });
  });

  it("uses the first plain key that has a value and compares phones by digits", () => {
    expect(fieldsOf({ phone: "", phone_number: "515-555-0199" })).toEqual(["phone"]);
    expect(fieldsOf({ attendee_phone: "(515) 555-0100" })).toEqual([]);
  });

  it("reads the mailing address from the ADDRESS answer or from plain keys", () => {
    expect(fieldsOf({ mailing_address: { line1: "2 Other Road", locality: "sampletown", region: "MI" } })).toEqual(["mailingLine1"]);
    expect(fieldsOf({ address_line_1: "2 Other Road", city: "Elsewhere", zip: "49000" })).toEqual(["mailingLine1", "mailingCity"]);
  });

  it("compares the emergency contact", () => {
    expect(fieldsOf({ emergency_contact_name: "Pat Contact", emergency_contact_phone: "515-555-0101" })).toEqual(["emergencyContactName"]);
  });

  it("leaves the address and emergency contact out unless personal details are included", () => {
    const responses = { address_line_1: "2 Other Road", emergency_contact_name: "Pat Contact", first_name: "Avery B" };
    expect(fieldsOf(responses, false)).toEqual(["firstName"]);
    expect(Object.keys(enteredProfileValues(responses, false))).not.toContain("mailingLine1");
  });

  it("never compares dietary or accessibility answers, nor email", () => {
    const withHealth = {
      dietary_needs: "Peanut allergy",
      dietary_restrictions: "Vegan",
      accessibility_needs: "Wheelchair access",
      accommodations: "Ramp",
      email: "someone-else@example.test",
      contact_email: "other@example.test",
    };
    expect(fieldsOf(withHealth)).toEqual([]);
    expect(reviewableFields).not.toContain("dietaryNeeds");
    expect(JSON.stringify(enteredProfileValues(withHealth, true))).not.toMatch(/allergy|vegan|wheelchair|ramp|example\.test/i);
    // The version cannot move with a health answer either.
    expect(profileReviewVersion(profile, withHealth, true)).toBe(profileReviewVersion(profile, {}, true));
  });

  it("ignores keys it does not map, such as an attendee-scope answer under another key", () => {
    expect(fieldsOf({ child_first_name: "Riley", guardian_name: "Someone" })).toEqual([]);
  });
});

describe("profile review version", () => {
  const responses = { first_name: "Avery B", phone: "515-555-0100" };

  it("is a stable sha256 hex", () => {
    const version = profileReviewVersion(profile, responses, true);
    expect(version).toMatch(/^[0-9a-f]{64}$/);
    expect(profileReviewVersion(profile, { ...responses }, true)).toBe(version);
  });

  it("moves when the saved profile changes", () => {
    expect(profileReviewVersion({ ...profile, firstName: "Avery B" }, responses, true))
      .not.toBe(profileReviewVersion(profile, responses, true));
  });

  it("moves when an entered value changes", () => {
    expect(profileReviewVersion(profile, { ...responses, first_name: "Avery C" }, true))
      .not.toBe(profileReviewVersion(profile, responses, true));
  });

  it("does not move with a personal value when personal details are excluded", () => {
    expect(profileReviewVersion({ ...profile, mailingCity: "Elsewhere" }, responses, false))
      .toBe(profileReviewVersion(profile, responses, false));
    expect(profileReviewVersion({ ...profile, mailingCity: "Elsewhere" }, responses, true))
      .not.toBe(profileReviewVersion(profile, responses, true));
  });
});

describe("history entries", () => {
  it("keeps values only for name, phone and shirt size", () => {
    expect(["firstName", "lastName", "phone", "shirtSize"].every(isValueKeptField)).toBe(true);
    expect(historyEntriesFor([
      { field: "firstName", oldValue: "Avery", newValue: "Avery B" },
      { field: "shirtSize", oldValue: "", newValue: "L" },
      { field: "mailingLine1", oldValue: "1 Example Way", newValue: "2 Other Road" },
      { field: "emergencyContactPhone", oldValue: "(515) 555-0101", newValue: "(515) 555-0102" },
    ])).toEqual([
      { field: "firstName", oldValue: "Avery", newValue: "Avery B" },
      { field: "shirtSize", oldValue: null, newValue: "L" },
      { field: "mailingLine1", oldValue: null, newValue: null },
      { field: "emergencyContactPhone", oldValue: null, newValue: null },
    ]);
  });

  it("drops health fields completely", () => {
    expect(historyEntriesFor([
      { field: "dietaryNeeds", oldValue: "A", newValue: "B" },
      { field: "accessibilityNeeds", oldValue: "C", newValue: "D" },
    ])).toEqual([]);
  });
});

describe("Camp Meeting primary contact names", () => {
  it("maps primary_first_name and primary_last_name to the first and last name", () => {
    expect(profileConflicts(profile, { primary_first_name: "Averi", primary_last_name: "Persona" }, false)
      .map((conflict) => [conflict.field, conflict.enteredValue])).toEqual([["firstName", "Averi"], ["lastName", "Persona"]]);
  });
});

describe("holder answers fill blanks only", () => {
  it("lets registration answers win and fills the rest from the holder", () => {
    const entered = enteredProfileValues({ shirt_size: "L", mailing_address: { line1: "2 Other Road" } }, true, {
      shirt_size: "XL",
      attendee_phone: "515-555-0177",
      mailing_address: { line1: "3 Third St", locality: "Elsewhere" },
    });
    expect(entered.shirtSize).toBe("L");
    expect(entered.phone).toBe("515-555-0177");
    expect(entered.mailingLine1).toBe("2 Other Road");
    expect(entered.mailingCity).toBe("Elsewhere");
  });

  it("moves the version when only the holder's answer changes", () => {
    expect(profileReviewVersion(profile, {}, true, { shirt_size: "XL" }))
      .not.toBe(profileReviewVersion(profile, {}, true, { shirt_size: "L" }));
    expect(profileReviewVersion(profile, {}, true, {})).toBe(profileReviewVersion(profile, {}, true));
  });
});

describe("accountHolderAttendeeIndex", () => {
  const today = "2027-03-01";
  const find = (attendeeAnswers: Array<Record<string, unknown>>, registrationAnswers: Record<string, unknown> = {}, verifiedEmail = "avery@example.test") =>
    accountHolderAttendeeIndex({ verifiedEmail, registrationAnswers, attendeeAnswers, today });
  const adult = { birth_date: "1990-05-05" };

  it("matches an adult whose email is the verified email, ignoring case and spaces", () => {
    expect(find([{ email: "someone@example.test", ...adult }, { attendee_email: "  AVERY@example.test ", ...adult }])).toBe(1);
  });

  it("matches the main contact by name, ignoring case and extra spaces", () => {
    const contact = { primary_contact_first_name: "Avery", primary_contact_last_name: "Person" };
    expect(find([{ first_name: "Riley", last_name: "Person", ...adult }, { first_name: " avery ", last_name: "PERSON", ...adult }], contact)).toBe(1);
    expect(find([{ first_name: "Avery", last_name: "Person", ...adult }], { primary_first_name: "Avery", primary_last_name: "Person" })).toBe(0);
    expect(find([{ first_name: "Avery", last_name: "Person", ...adult }], { registrant_first_name: "Avery", registrant_last_name: "Person" })).toBe(0);
  });

  it("needs both contact names, so a first name alone is not a match", () => {
    expect(find([{ first_name: "Avery", last_name: "", ...adult }], { contact_first_name: "Avery", contact_last_name: "" })).toBeNull();
  });

  it("never counts a child, even with the matching email or name", () => {
    expect(find([{ email: "avery@example.test", birth_date: "2015-05-05" }])).toBeNull();
    expect(find([{ first_name: "Avery", last_name: "Person", birth_date: "2015-05-05" }], { contact_first_name: "Avery", contact_last_name: "Person" })).toBeNull();
  });

  it("does not compare without a birth date or with an unreadable one", () => {
    expect(find([{ email: "avery@example.test" }])).toBeNull();
    expect(find([{ email: "avery@example.test", birth_date: "" }])).toBeNull();
    expect(find([{ email: "avery@example.test", birth_date: "1990-02-31" }])).toBeNull();
    expect(find([{ email: "avery@example.test", birth_date: "05/05/1990" }])).toBeNull();
    expect(find([{ email: "avery@example.test", birth_date: "2099-01-01" }])).toBeNull();
  });

  it("does not use an age number, the attendee type or a minor flag as evidence", () => {
    expect(find([{ email: "avery@example.test", attendee_age: 40, age: "40", attendee_type: "ADULT", is_minor: false }])).toBeNull();
  });

  it("uses the 18th birthday as the boundary", () => {
    expect(find([{ email: "avery@example.test", birth_date: "2009-03-01" }])).toBe(0);
    expect(find([{ email: "avery@example.test", birth_date: "2009-03-02" }])).toBeNull();
  });

  it("reads other birth-date keys", () => {
    expect(find([{ email: "avery@example.test", date_of_birth: "1990-05-05" }])).toBe(0);
  });

  it("is nobody when more than one attendee qualifies, by either path", () => {
    expect(find([{ email: "avery@example.test", ...adult }, { attendee_email: "avery@example.test", ...adult }])).toBeNull();
    expect(find(
      [{ email: "avery@example.test", ...adult }, { first_name: "Avery", last_name: "Person", ...adult }],
      { primary_contact_first_name: "Avery", primary_contact_last_name: "Person" },
    )).toBeNull();
  });

  it("is nobody for an empty roster or a blank verified email", () => {
    expect(find([])).toBeNull();
    expect(find([{ email: "", ...adult }], {}, "  ")).toBeNull();
  });

  it("defaults to today's Chicago date", () => {
    expect(accountHolderAttendeeIndex({ verifiedEmail: "a@example.test", registrationAnswers: {}, attendeeAnswers: [{ email: "a@example.test", birth_date: "1990-01-01" }] })).toBe(0);
  });
});

describe("staff personal value fields", () => {
  const migration = readFileSync(join(process.cwd(), "prisma/migrations/20270178100000_profile_change_staff_personal_values/migration.sql"), "utf8");

  it("keeps values for address and emergency contact only on a staff correction", () => {
    const change = [{ field: "mailingLine1", oldValue: "1 Example Way", newValue: "2 Other Road" }, { field: "emergencyContactRelationship", oldValue: "", newValue: "Friend" }];
    expect(historyEntriesFor(change, "STAFF_CORRECTION")).toEqual([
      { field: "mailingLine1", oldValue: "1 Example Way", newValue: "2 Other Road" },
      { field: "emergencyContactRelationship", oldValue: null, newValue: "Friend" },
    ]);
    for (const source of ["SELF_EDIT", "REGISTRATION_REVIEW", undefined] as const) {
      expect(historyEntriesFor(change, source).every((entry) => entry.oldValue === null && entry.newValue === null)).toBe(true);
    }
    expect(historyEntriesFor([{ field: "dietaryNeeds", oldValue: "a", newValue: "b" }], "STAFF_CORRECTION")).toEqual([]);
  });

  it("lists the same fields in TypeScript and in the database check", () => {
    const check = /AttendeeProfileChange_value_retention_check" CHECK \(([\s\S]*?)\n\);/.exec(migration)![1]!;
    const personal = /'STAFF_CORRECTION'\s+AND "field" IN \(([^)]*)\)/.exec(check)![1]!;
    const sqlPersonal = [...personal.matchAll(/'(\w+)'/g)].map((match) => match[1]).sort();
    expect(sqlPersonal).toEqual([...staffPersonalValueFields].sort());
    const kept = /^\s*"field" IN \(([^)]*)\)/m.exec(check)![1]!;
    expect([...kept.matchAll(/'(\w+)'/g)].map((match) => match[1])).toEqual(["firstName", "lastName", "phone", "shirtSize"]);
    expect(staffPersonalValueFields.every(isStaffPersonalValueField)).toBe(true);
    expect(isStaffPersonalValueField("dietaryNeeds")).toBe(false);
    expect(migration).toContain('DROP CONSTRAINT "AttendeeProfileChange_value_retention_check"');
    expect(migration).toMatch(/^-- .*ADDITIVE/m);
  });
});
