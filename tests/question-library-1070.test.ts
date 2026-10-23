import { describe, expect, it } from "vitest";
import { instantiateLibraryFragment, libraryFieldsFromForm } from "@/components/registration-builder/library-insert";
import { createLibraryRegistry, libraryPaletteEntry } from "@/components/registration-builder/library-registry";
import { filterPaletteRegistry, informationEntryAllowed } from "@/components/registration-builder/information-palette";
import { planPaletteInsert } from "@/components/registration-builder/palette-insert";
import { createPaletteRegistry, searchPalette } from "@/components/registration-builder/palette-registry";
import type { RegistrationFormDefinition, RegistrationFormField } from "@/modules/forms/definition";
import { prepareLibraryFragment, protectedFieldReason, QuestionLibraryError, type QuestionLibraryItemView } from "@/modules/question-library/domain";

/** The question library (#1070): saved questions are configuration-only, independent copies. Synthetic data only. */

function field(patch: Partial<RegistrationFormField> = {}): RegistrationFormField {
  return { id: "synthetic_id", key: "synthetic_note", label: "Synthetic note", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], ...patch };
}

function item(fields: RegistrationFormField[], patch: Partial<QuestionLibraryItemView> = {}): QuestionLibraryItemView {
  return { id: "lib-1", name: "Saved item", description: "", fields, createdAt: "2026-10-23T00:00:00.000Z", updatedAt: "2026-10-23T00:00:00.000Z", createdBy: "Synthetic Staff", ...patch };
}

function counter() {
  let n = 0;
  return () => `new_${++n}`;
}

function definitionWith(fields: RegistrationFormField[]): RegistrationFormDefinition {
  return { title: "Synthetic", description: "", sections: [{ id: "s1", title: "Step one", description: "", fields }] } as RegistrationFormDefinition;
}

describe("saving a question: what is stored", () => {
  it("accepts valid fields and stores a deep copy", () => {
    const source = field({ type: "SELECT", options: ["Small", "Large"] });
    const { fragment } = prepareLibraryFragment([source]);
    expect(fragment.fields).toHaveLength(1);
    expect(fragment.fields[0]).not.toBe(source);
    expect(fragment.fields[0]!.options).not.toBe(source.options);
  });

  it("refuses fields the form definition's own schema refuses", () => {
    expect(() => prepareLibraryFragment([field({ type: "SELECT", options: ["Only one"] })])).toThrow(QuestionLibraryError);
    expect(() => prepareLibraryFragment([])).toThrow(QuestionLibraryError);
    expect(() => prepareLibraryFragment([{ nonsense: true }])).toThrow(QuestionLibraryError);
  });

  it("refuses protected module and canonical keys, and meal tickets", () => {
    for (const key of ["promo_code", "attendee_age", "gender"]) {
      expect(protectedFieldReason(field({ key, label: "Protected" }))).toBeTruthy();
      expect(() => prepareLibraryFragment([field({ key })])).toThrow(QuestionLibraryError);
    }
    expect(protectedFieldReason(field({ key: "lunch_adult_qty", type: "NUMBER" }))).toBeTruthy();
    expect(protectedFieldReason(field({ key: "shirt_size" }))).toBeNull();
  });

  it("refuses duplicate keys inside one item", () => {
    expect(() => prepareLibraryFragment([field({ id: "a" }), field({ id: "b" })])).toThrow(QuestionLibraryError);
  });

  it("never lets a save launder a health-type question into a non-sensitive one", () => {
    const { fragment } = prepareLibraryFragment([field({ key: "food_allergies", label: "Food allergies", sensitive: false })]);
    expect(fragment.fields[0]!.sensitive).toBe(true);
  });

  it("replaces an event's policy-version acknowledgment with placeholder wording", () => {
    const { fragment, replacedAcknowledgments } = prepareLibraryFragment([
      field({ key: "waiver", label: "Waiver", type: "ACKNOWLEDGMENT", acknowledgment: { source: "POLICY_VERSION", policyVersionId: "pv-1" } as never }),
    ]);
    expect(replacedAcknowledgments).toEqual(["Waiver"]);
    expect(fragment.fields[0]!.acknowledgment).toMatchObject({ source: "TEXT" });
  });
});

describe("the sensitive flag follows a question into the library", () => {
  it("saves a question wired to a sensitive question as sensitive and not a filter", () => {
    const controller = field({ id: "c", key: "medical_conditions", label: "Medical conditions", type: "RADIO", options: ["Yes", "No"] });
    const dependent = field({ id: "d", key: "shirt_note", label: "Shirt note", type: "SELECT", options: ["A", "B"], conditional: { fieldKey: "medical_conditions", operator: "EQUALS", value: "Yes" } });
    const [saved] = libraryFieldsFromForm(definitionWith([controller, dependent]), ["d"]);
    expect(saved!.sensitive).toBe(true);
    expect(saved!.filterable).toBe(false);
  });

  it("does not change a plain question's flags", () => {
    const plain = field({ id: "p", key: "t_shirt", label: "T-shirt size", type: "SELECT", options: ["S", "M"] });
    const [saved] = libraryFieldsFromForm(definitionWith([plain]), ["p"]);
    expect(saved!.sensitive).toBeUndefined();
    expect(saved).toEqual(plain);
  });
});

describe("adding a question: an independent copy", () => {
  it("gives fresh ids and keys free on the form, and never changes the saved item", () => {
    const saved = item([field({ id: "saved_id", key: "shirt_size", label: "Shirt size", type: "SELECT", options: ["S", "M"] })]);
    const snapshot = structuredClone(saved);
    const copy = instantiateLibraryFragment(saved, [{ key: "shirt_size" }, { key: "shirt_size_2" }], counter());
    expect(copy.fields[0]!.id).toBe("new_1");
    expect(copy.fields[0]!.key).toBe("shirt_size_3");
    expect(saved).toEqual(snapshot);
  });

  it("copies share nothing with the saved item or with each other", () => {
    const saved = item([field({ type: "SELECT", options: ["S", "M"], choicePricesCents: { S: 100 } })]);
    const a = instantiateLibraryFragment(saved, [], counter()).fields[0]!;
    const b = instantiateLibraryFragment(saved, [], counter()).fields[0]!;
    a.options.push("XL");
    a.choicePricesCents!.S = 999;
    expect(saved.fields[0]!.options).toEqual(["S", "M"]);
    expect(saved.fields[0]!.choicePricesCents).toEqual({ S: 100 });
    expect(b.options).toEqual(["S", "M"]);
  });

  it("a later library edit does not reach a question already on the form", () => {
    const saved = item([field({ label: "Original wording" })]);
    const onForm = instantiateLibraryFragment(saved, [], counter()).fields[0]!;
    saved.fields[0]!.label = "Edited in the library";
    saved.fields.length = 0;
    expect(onForm.label).toBe("Original wording");
  });

  it("keeps type, scope, required, price, capacity and sensitivity", () => {
    const saved = item([field({ type: "SELECT", scope: "ATTENDEE", required: true, options: ["A", "B"], choicePricesCents: { A: 500 }, choiceLimits: { A: 10 }, sensitive: true, filterable: false })]);
    const copy = instantiateLibraryFragment(saved, [], counter()).fields[0]!;
    expect(copy).toMatchObject({ type: "SELECT", scope: "ATTENDEE", required: true, choicePricesCents: { A: 500 }, choiceLimits: { A: 10 }, sensitive: true, filterable: false });
  });

  it("never lands on a key another module reads by name", () => {
    const saved = item([field({ key: "gender", type: "TEXT" })]);
    // Even a legacy item that carries a reserved key gets a fresh one on the form when the key is reserved for that type.
    const copy = instantiateLibraryFragment(saved, [], counter()).fields[0]!;
    expect(copy.key).not.toBe("gender");
  });
});

describe("references between copied questions", () => {
  const controller = field({ id: "c", key: "bringing_guest", label: "Bringing a guest", type: "RADIO", options: ["Yes", "No"] });
  const dependent = field({ id: "d", key: "guest_name", label: "Guest name", conditional: { fieldKey: "bringing_guest", operator: "EQUALS", value: "Yes" }, optionalWhen: { fieldKey: "bringing_guest", operator: "EQUALS", value: "No" }, required: true });

  it("remaps references to the copied keys when keys are renamed", () => {
    const copy = instantiateLibraryFragment(item([controller, dependent]), [{ key: "bringing_guest" }], counter());
    expect(copy.fields[0]!.key).toBe("bringing_guest_2");
    expect(copy.fields[1]!.conditional?.fieldKey).toBe("bringing_guest_2");
    expect(copy.fields[1]!.optionalWhen?.fieldKey).toBe("bringing_guest_2");
    expect(copy.repairs).toEqual([]);
  });

  it("does not retarget a reference to an unrelated question on the form that happens to share the key", () => {
    const lonely = item([dependent]);
    const copy = instantiateLibraryFragment(lonely, [{ key: "bringing_guest" }], counter());
    expect(copy.fields[0]!.conditional).toBeUndefined();
    expect(copy.fields[0]!.optionalWhen).toBeUndefined();
  });

  it("marks a question with a missing reference as needing repair instead of dropping it silently", () => {
    const copy = instantiateLibraryFragment(item([dependent]), [], counter());
    expect(copy.fields).toHaveLength(1);
    expect(copy.repairs).toHaveLength(1);
    expect(copy.repairs[0]!.fieldId).toBe(copy.fields[0]!.id);
    expect(copy.repairs[0]!.message).toContain("bringing_guest");
    expect(copy.repairs[0]!.message).toContain("not part of this saved question");
    // The copy is a valid definition field again: no dangling reference.
    expect(copy.fields[0]!.conditional).toBeUndefined();
  });

  it("carries the repair through the palette insert, keyed by the inserted field's id", () => {
    const entry = libraryPaletteEntry(item([dependent]));
    const definition = definitionWith([field({ id: "existing", key: "existing" })]);
    const plan = planPaletteInsert(definition, entry, 0, undefined, counter());
    expect(plan.kind).toBe("inserted");
    if (plan.kind !== "inserted") return;
    expect(plan.repairs).toHaveLength(1);
    expect(plan.sections[0]!.fields.map((candidate) => candidate.id)).toContain(plan.repairs[0]!.fieldId);
  });
});

describe("the library in the palette", () => {
  const tshirt = item([field({ key: "tshirt", label: "T-shirt size", type: "SELECT", options: ["S", "M"] })], { id: "a", name: "T-shirt size" });
  const dupe = item([field({ key: "tshirt", label: "Youth T-shirt", type: "SELECT", options: ["YS", "YM"] })], { id: "b", name: "T-shirt size", description: "Youth sizes" });

  it("lists saved questions in their own group after the shared entries, and the shared registry is untouched", () => {
    const base = createPaletteRegistry();
    const view = createLibraryRegistry(base, [tshirt]);
    expect(view.getSnapshot().entries.map((entry) => entry.id)).toEqual(["saved:a"]);
    expect(view.getSnapshot().entries[0]!.group).toBe("saved");
    expect(base.getSnapshot().entries).toEqual([]);
    expect(view.getSnapshot()).toBe(view.getSnapshot());
  });

  it("searches by name and by the labels inside, and tells duplicate names apart", () => {
    const snapshot = createLibraryRegistry(createPaletteRegistry(), [tshirt, dupe]).getSnapshot();
    expect(searchPalette(snapshot, "youth").map((entry) => entry.id)).toEqual(["saved:b"]);
    expect(searchPalette(snapshot, "t-shirt").map((entry) => entry.id)).toEqual(["saved:a", "saved:b"]);
    const [first, second] = snapshot.entries;
    expect(first!.description).not.toBe(second!.description);
  });

  it("in information mode offers only items that pass the information-form check", () => {
    const fee = item([field({ key: "extra_fee", label: "Extra fee", type: "CALCULATED", priceCents: 500 })], { id: "fee", name: "Extra fee" });
    const medical = item([field({ key: "medical_notes", label: "Medical notes" })], { id: "med", name: "Medical notes" });
    const ok = item([field({ key: "favorite_song", label: "Favorite song" })], { id: "ok", name: "Favorite song" });
    const registry = createLibraryRegistry(createPaletteRegistry(), [fee, medical, ok]);
    expect(registry.getSnapshot().entries).toHaveLength(3);
    const shown = filterPaletteRegistry(registry).getSnapshot().entries.map((entry) => entry.id);
    expect(shown).toEqual(["saved:ok"]);
    expect(informationEntryAllowed(libraryPaletteEntry(fee))).toBe(false);
  });
});
