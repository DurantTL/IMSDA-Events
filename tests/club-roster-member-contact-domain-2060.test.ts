import { describe, expect, it } from "vitest";
import {
  CONTACT_MAX_LENGTHS,
  contactFieldLabels,
  contactInputSchema,
  contactIsBlank,
  contactPostalCodeProblem,
  contactProblem,
  contactStateProblem,
  contactToStore,
  contactUpdateInputSchema,
  validateContactForm,
} from "@/modules/club-rosters/guardians-domain";
import { rosterMemberInputSchema, rosterMemberUpdateSchema } from "@/modules/club-rosters/schemas";
import { rosterFormSnapshots, rosterDiscardPrompt } from "@/components/roster-dialog-dirty";

/** Member contact details (#2060). Synthetic data only. */
const full = { email: "member@example.test", phone: "(515) 555-0100", addressLine1: "100 Sample St", addressLine2: "Apt 2", city: "Des Moines", state: "IA", postalCode: "50309" };

describe("the contact details rules", () => {
  it("labels the fields the way the dialog and export do", () => {
    expect(Object.values(contactFieldLabels)).toEqual(["Email", "Phone", "Street address", "Address line 2", "City", "State", "ZIP code"]);
  });

  it("accepts an empty state or ZIP, a two-letter US state or territory in either case, and 5-digit or ZIP+4", () => {
    expect(contactStateProblem("")).toBeNull();
    expect(contactStateProblem("ia")).toBeNull();
    expect(contactStateProblem("MO")).toBeNull();
    expect(contactStateProblem("DC")).toBeNull();
    expect(contactStateProblem("PR")).toBeNull();
    expect(contactStateProblem("Iowa")).not.toBeNull();
    expect(contactStateProblem("ZZ")).not.toBeNull();
    expect(contactStateProblem("I")).not.toBeNull();
    expect(contactPostalCodeProblem("")).toBeNull();
    expect(contactPostalCodeProblem("50309")).toBeNull();
    expect(contactPostalCodeProblem("50309-1234")).toBeNull();
    for (const bad of ["5030", "503091", "50309-12", "5030a", "50309 1234", "50309-"]) expect(contactPostalCodeProblem(bad)).not.toBeNull();
  });

  it("trims every field, uppercases the state and normalizes the phone when it is stored", () => {
    expect(contactToStore({ ...full, email: "  member@example.test ", state: " ia ", phone: "515-555-0134", city: " Des Moines " })).toEqual({
      ...full, phone: "(515) 555-0134",
    });
  });

  it("treats an all-empty (or all-space) contact as blank, so no row is stored", () => {
    expect(contactIsBlank({})).toBe(true);
    expect(contactIsBlank({ email: "  ", city: "" })).toBe(true);
    expect(contactToStore({ email: "  ", city: "" })).toBeNull();
    expect(contactIsBlank({ city: "Ames" })).toBe(false);
  });

  it("reports the first problem as the code the repository throws, and lets an unchanged saved email or phone through", () => {
    expect(contactProblem(full)).toBeNull();
    expect(contactProblem({ ...full, email: "not an email" })).toMatchObject({ code: "CONTACT_EMAIL_INVALID" });
    expect(contactProblem({ ...full, phone: "call me" })).toMatchObject({ code: "CONTACT_PHONE_INVALID" });
    expect(contactProblem({ ...full, state: "Iowa" })).toMatchObject({ code: "CONTACT_STATE_INVALID" });
    expect(contactProblem({ ...full, postalCode: "123" })).toMatchObject({ code: "CONTACT_POSTAL_CODE_INVALID" });
    const legacy = "legacy..mail@example.test";
    expect(contactProblem({ ...full, email: legacy }, { email: legacy })).toBeNull();
    expect(contactProblem({ ...full, email: legacy })).toMatchObject({ code: "CONTACT_EMAIL_INVALID" });
  });

  it("keys the dialog errors by field", () => {
    expect(validateContactForm(full)).toEqual({});
    expect(validateContactForm({ ...full, email: "bad", phone: "nope", state: "XX", postalCode: "1" })).toEqual({
      email: expect.any(String), phone: expect.any(String), state: expect.any(String), postalCode: expect.any(String),
    });
  });
});

describe("the contact schemas", () => {
  it("trims, defaults every field to empty, and refuses a bad value or an unknown key", () => {
    expect(contactInputSchema.parse({})).toEqual({ email: "", phone: "", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "" });
    expect(contactInputSchema.parse({ city: "  Ames  " }).city).toBe("Ames");
    expect(contactInputSchema.safeParse({ email: "not an email" }).success).toBe(false);
    expect(contactInputSchema.safeParse({ phone: "call me" }).success).toBe(false);
    expect(contactInputSchema.safeParse({ state: "Iowa" }).success).toBe(false);
    expect(contactInputSchema.safeParse({ postalCode: "5030" }).success).toBe(false);
    expect(contactInputSchema.safeParse({ nickname: "x" }).success).toBe(false);
    expect(contactInputSchema.safeParse({ addressLine1: "x".repeat(CONTACT_MAX_LENGTHS.addressLine1 + 1) }).success).toBe(false);
  });

  it("leaves an old saved email and phone to the stored-value check on an edit, but still checks the state and ZIP", () => {
    expect(contactUpdateInputSchema.safeParse({ email: "legacy..mail@example.test", phone: "555-010-0202" }).success).toBe(true);
    expect(contactUpdateInputSchema.safeParse({ state: "Iowa" }).success).toBe(false);
  });

  it("is accepted by the roster add and edit schemas, and absent when not sent", () => {
    const base = { firstName: "Test", lastName: "Youth", birthDate: "2014-12-06", attendeeType: "YOUTH", gender: "FEMALE" };
    expect(rosterMemberInputSchema.parse({ ...base, contact: full }).contact).toEqual(full);
    expect(rosterMemberInputSchema.parse(base).contact).toBeUndefined();
    expect(rosterMemberUpdateSchema.parse({ contact: full }).contact).toEqual(full);
    expect(rosterMemberUpdateSchema.parse({ role: "TLT" })).not.toHaveProperty("contact");
    expect(rosterMemberUpdateSchema.safeParse({ contact: { ...full, postalCode: "1" } }).success).toBe(false);
  });
});

describe("the roster dialog's dirty tracking", () => {
  it("counts the contact detail fields with the contact part, and the discard message mentions them", () => {
    const entries: Array<[string, string]> = [["firstName", "Ana"], ["contactCity", "Ames"], ["g1Name", "Pat"]];
    const snapshots = rosterFormSnapshots(entries);
    expect(snapshots.person).toBe(JSON.stringify([["firstName", "Ana"]]));
    expect(snapshots.contacts).toBe(JSON.stringify([["contactCity", "Ames"], ["g1Name", "Pat"]]));
    expect(rosterDiscardPrompt.body).toContain("contact details");
  });
});
