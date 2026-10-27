import { describe, expect, it } from "vitest";
import {
  answerDraftExcludedKeys,
  answerDraftKey,
  loadAnswerDraft,
  saveAnswerDraft,
  type AnswerDraftIdentity,
} from "@/modules/forms/answer-draft";
import { clearEditDraft, editDraftKey, loadEditDraft, saveEditDraft } from "@/lib/local-edit-draft";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";

/** Local drafts for club and information forms and staff editors (#1263). Synthetic data only. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  };
}

const field = (key: string, label: string, type = "TEXT", extra: Record<string, unknown> = {}) => ({
  id: `f-${key}`, key, label, type, required: false, scope: "REGISTRATION", options: [], ...extra,
});
const definition = {
  title: "Synthetic club form", description: "",
  sections: [{ id: "s1", title: "About", fields: [
    field("club_name", "Club name"),
    field("director_email", "Director email", "EMAIL"),
    field("favorite_color", "Favorite color", "SELECT", { options: ["Red", "Blue"] }),
    field("notes", "Notes for staff", "LONG_TEXT"),
    field("medical_conditions", "Medical conditions"),
    field("insurance_policy", "Insurance policy number"),
    field("date_of_birth", "Date of birth", "DATE"),
    field("sealed_answer", "Something private"),
    field("flagged_answer", "Plain looking", "TEXT", { sensitive: true }),
    field("photo_consent", "Photo consent", "CHECKBOX", { required: true }),
    field("mailing_address", "Mailing address", "ADDRESS"),
    field("members", "Member list", "MEMBER_LIST"),
  ] }],
} as unknown as RegistrationFormDefinition;

const identity: AnswerDraftIdentity = { scope: "club-link", formId: "abc123" };
const sealed = ["sealed_answer"];
const now = new Date("2026-10-27T12:00:00Z");
const everything = {
  club_name: "Synthetic Pathfinders", director_email: "director@example.test", favorite_color: "Blue",
  notes: "long text", medical_conditions: "none", insurance_policy: "X1", date_of_birth: "2010-01-01",
  sealed_answer: "secret", flagged_answer: "flagged", photo_consent: true, mailing_address: "1 Main St",
  members: [{ name: "A" }], not_a_field: "x", idempotencyKey: "k",
};

describe("answer drafts (#1263)", () => {
  it("never writes excluded, sealed, sensitive or unknown fields, and never an idempotency key", () => {
    const storage = memoryStorage();
    saveAnswerDraft(storage, identity, definition, { answers: everything, extras: { clubChoice: "club-1" } }, { sealedKeys: sealed, now });
    const raw = storage.getItem(answerDraftKey(identity))!;
    const stored = JSON.parse(raw);
    expect(Object.keys(stored.answers).sort()).toEqual(["club_name", "director_email", "favorite_color"]);
    for (const banned of ["secret", "flagged", "none", "X1", "2010-01-01", "long text", "1 Main St", "idempotency", "not_a_field", "Member"]) {
      expect(raw).not.toContain(banned);
    }
    expect(stored.extras).toEqual({ clubChoice: "club-1" });
    expect(answerDraftExcludedKeys(definition, sealed).has("sealed_answer")).toBe(true);
  });

  it("restores after a reload and cuts a tampered draft down by the same rules", () => {
    const storage = memoryStorage();
    saveAnswerDraft(storage, identity, definition, { answers: { club_name: "Synthetic Pathfinders" } }, { sealedKeys: sealed, now });
    const loaded = loadAnswerDraft(storage, identity, definition, { sealedKeys: sealed, now });
    expect(loaded).toEqual({ status: "restored", draft: { answers: { club_name: "Synthetic Pathfinders" }, extras: {} } });

    const tampered = JSON.parse(storage.getItem(answerDraftKey(identity))!);
    tampered.answers.sealed_answer = "injected";
    tampered.answers.medical_conditions = "injected";
    storage.setItem(answerDraftKey(identity), JSON.stringify(tampered));
    const again = loadAnswerDraft(storage, identity, definition, { sealedKeys: sealed, now });
    expect(JSON.stringify(again)).not.toContain("injected");
  });

  it("writes nothing when only excluded answers were typed, and removes an old copy", () => {
    const storage = memoryStorage();
    saveAnswerDraft(storage, identity, definition, { answers: { club_name: "A" } }, { sealedKeys: sealed, now });
    saveAnswerDraft(storage, identity, definition, { answers: { medical_conditions: "x", club_name: "  " } }, { sealedKeys: sealed, now });
    expect(storage.map.size).toBe(0);
  });

  it("expires after 14 days and flags a form that changed since", () => {
    const storage = memoryStorage();
    saveAnswerDraft(storage, identity, definition, { answers: { club_name: "A" } }, { now });
    const later = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    expect(loadAnswerDraft(storage, identity, definition, { now: later })).toEqual({ status: "none" });
    expect(storage.map.size).toBe(0);

    saveAnswerDraft(storage, identity, definition, { answers: { club_name: "A" } }, { now });
    const changed = { ...definition, sections: [{ ...definition.sections[0]!, fields: definition.sections[0]!.fields.slice(0, 2) }] } as RegistrationFormDefinition;
    expect(loadAnswerDraft(storage, identity, changed, { now })).toEqual({ status: "version-changed" });
    expect(storage.map.size).toBe(0);
  });

  it("works with storage missing or throwing", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); }, key: () => null, length: 0 };
    expect(() => saveAnswerDraft(broken, identity, definition, { answers: { club_name: "A" } })).not.toThrow();
    expect(loadAnswerDraft(broken, identity, definition)).toEqual({ status: "none" });
    expect(loadAnswerDraft(null, identity, definition)).toEqual({ status: "none" });
  });
});

describe("staff editor backups (#1263)", () => {
  it("restores only for the same version, expires, and clears", () => {
    const storage = memoryStorage();
    const key = editDraftKey("club-form-builder", "camp");
    saveEditDraft(storage, key, "3", { name: "Draft name" }, now);
    expect(loadEditDraft(storage, key, "3", now)).toEqual({ name: "Draft name" });
    expect(loadEditDraft(storage, key, "4", now)).toBeNull();
    expect(storage.map.size).toBe(0);
    saveEditDraft(storage, key, "3", { name: "Draft name" }, now);
    expect(loadEditDraft(storage, key, "3", new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000))).toBeNull();
    saveEditDraft(storage, key, "3", { name: "x" }, now);
    clearEditDraft(storage, key);
    expect(storage.map.size).toBe(0);
  });

  it("never throws when storage is blocked", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
    const key = editDraftKey("event-content", "e1");
    expect(() => saveEditDraft(broken, key, "1", {})).not.toThrow();
    expect(() => clearEditDraft(broken, key)).not.toThrow();
    expect(loadEditDraft(broken, key, "1")).toBeNull();
  });
});
