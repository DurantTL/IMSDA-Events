import { describe, expect, it } from "vitest";
import {
  enteredProfileValues,
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
