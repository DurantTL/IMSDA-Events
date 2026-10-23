import { describe, expect, it } from "vitest";
import { calculateFormTotal, isFieldVisible, registrationFormDefinitionSchema, validateTestResponses, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";
import { instantiateModuleFields, planModuleInsert } from "@/modules/forms/builder-modules";
import { isLinkedToBlockedField } from "@/modules/forms/field-dependency-walk";
import { resolveFieldOffer, sectionTitleLookup } from "@/modules/forms/field-flags";
import { fieldVisibilityRule, mapVisibilityConditions, visibilityControllerKeys, visibilityRulePatch, type RuleCondition } from "@/modules/forms/visibility-rule";
import { avoidCollisions } from "@/components/registration-builder/palette-insert";
import { instantiateLibraryFragment } from "@/components/registration-builder/library-insert";
import { newOrderInversion, showWhenSummary } from "@/components/registration-builder/phone-move";
import { ruleEditPatch, ruleSummary, readsAs, withAddedCondition, withoutCondition } from "@/components/registration-builder/rule-editor";
import { removeField, renameFieldKey } from "@/components/club-form-builder-state";
import { staffEventQuestions } from "@/modules/staff-invitations/event-questions";
import { draftExcludedKeys } from "@/modules/forms/public-draft";
import { groupFormDefinition } from "@/modules/group-registrations/domain";
import type { ClubFormDraftSpec } from "@/modules/club-forms/builder-domain";

const yes = (fieldKey: string): RuleCondition => ({ fieldKey, operator: "EQUALS", value: "Yes" });

function field(key: string, patch: Partial<RegistrationFormField> = {}): RegistrationFormField {
  return { id: `id_${key}`, key, label: key.replaceAll("_", " "), helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], ...patch };
}
const yesNo = (key: string, patch: Partial<RegistrationFormField> = {}) => field(key, { type: "RADIO", options: ["Yes", "No"], ...patch });

function definition(fields: RegistrationFormField[], extra: Record<string, unknown> = {}) {
  return { title: "Synthetic", description: "", confirmationMessage: "Thanks", sections: [{ id: "sec1", title: "Step", description: "", fields }], ...extra };
}
const parse = (fields: RegistrationFormField[], extra: Record<string, unknown> = {}) => registrationFormDefinitionSchema.safeParse(definition(fields, extra));
const messages = (result: ReturnType<typeof parse>) => (result.success ? [] : result.error.issues.map((issue) => issue.message));

describe("legacy single rules (#1072)", () => {
  const legacy = field("seats", { conditional: yes("bus") });

  it("read as an All group of one and evaluate as they always did", () => {
    expect(fieldVisibilityRule(legacy)).toEqual({ match: "ALL", conditions: [yes("bus")] });
    expect(isFieldVisible(legacy, { bus: "Yes" })).toBe(true);
    expect(isFieldVisible(legacy, { bus: "No" })).toBe(false);
    expect(isFieldVisible(legacy, {})).toBe(false);
    expect(isFieldVisible(field("always"), {})).toBe(true);
  });

  it("parse unchanged: no group is invented and the stored shape is kept", () => {
    const result = parse([yesNo("bus"), legacy]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const stored = result.data.sections[0]!.fields[1]!;
    expect(stored.conditional).toEqual(yes("bus"));
    expect(stored.conditionalGroup).toBeUndefined();
  });

  it("keep the original checks only (a legacy rule pointing later in the form still parses)", () => {
    expect(parse([legacy, yesNo("bus")]).success).toBe(true);
    expect(messages(parse([legacy]))).toContain("Conditional logic must reference another configured field.");
  });

  it("the editor stores one condition as a single rule and two as a group", () => {
    expect(visibilityRulePatch({ match: "ANY", conditions: [yes("a")] })).toEqual({ conditional: yes("a"), conditionalGroup: undefined });
    expect(visibilityRulePatch({ match: "ANY", conditions: [yes("a"), yes("b")] })).toEqual({ conditional: undefined, conditionalGroup: { match: "ANY", conditions: [yes("a"), yes("b")] } });
    expect(visibilityRulePatch(null)).toEqual({ conditional: undefined, conditionalGroup: undefined });
  });
});

describe("All / Any truth tables (#1072)", () => {
  const rule = (match: "ALL" | "ANY", conditions: RuleCondition[]) => field("target", { conditionalGroup: { match, conditions } });
  const three = [yes("a"), yes("b"), { fieldKey: "c", operator: "NOT_EMPTY" as const, value: "" }];

  it("All needs every member", () => {
    const f = rule("ALL", [yes("a"), yes("b")]);
    expect([{ a: "Yes", b: "Yes" }, { a: "Yes", b: "No" }, { a: "No", b: "Yes" }, { a: "No", b: "No" }, {}].map((answers) => isFieldVisible(f, answers))).toEqual([true, false, false, false, false]);
  });

  it("Any needs one member", () => {
    const f = rule("ANY", [yes("a"), yes("b")]);
    expect([{ a: "Yes", b: "Yes" }, { a: "Yes", b: "No" }, { a: "No", b: "Yes" }, { a: "No", b: "No" }, {}].map((answers) => isFieldVisible(f, answers))).toEqual([true, true, true, false, false]);
  });

  it("mixes operators across three members", () => {
    expect(isFieldVisible(rule("ALL", three), { a: "Yes", b: "Yes", c: "x" })).toBe(true);
    expect(isFieldVisible(rule("ALL", three), { a: "Yes", b: "Yes", c: "" })).toBe(false);
    expect(isFieldVisible(rule("ANY", three), { c: "x" })).toBe(true);
    expect(isFieldVisible(rule("ANY", three), { a: "No", b: "No" })).toBe(false);
    expect(isFieldVisible(rule("ANY", [{ fieldKey: "t", operator: "INCLUDES", value: "Tent" }, { fieldKey: "t", operator: "NOT_EQUALS", value: "Tent" }]), { t: ["Tent"] })).toBe(true);
  });
});

describe("validation of every member (#1072)", () => {
  const base = [yesNo("a"), yesNo("b")];
  const group = (conditions: RuleCondition[], patch: Partial<RegistrationFormField> = {}) => field("target", { conditionalGroup: { match: "ALL", conditions }, ...patch });

  it("accepts a valid group", () => {
    expect(parse([...base, group([yes("a"), yes("b")])]).success).toBe(true);
  });

  it("refuses both shapes on one question and an empty group", () => {
    expect(messages(parse([...base, group([yes("a"), yes("b")], { conditional: yes("a") })]))).toContain("A question has one show-when rule: a single condition or a group, not both.");
    expect(parse([...base, group([])]).success).toBe(false);
  });

  it("refuses a missing or deleted reference in the second member", () => {
    expect(messages(parse([...base, group([yes("a"), yes("gone")])]))).toContain("Conditional logic must reference another configured field.");
  });

  it("refuses self reference in any member", () => {
    expect(messages(parse([...base, group([yes("a"), yes("target")])]))).toContain("Conditional logic must reference another configured field.");
  });

  it("refuses a registration-level question depending on an attendee answer through a later member", () => {
    const attendee = yesNo("rider", { scope: "ATTENDEE" });
    const result = parse([...base, attendee, group([yes("a"), yes("rider")])], { attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 5, attendeeLabel: "Attendee", addButtonLabel: "Add" } });
    expect(messages(result)).toContain("A registration-level field cannot depend on an attendee answer.");
  });

  it("refuses a controller that comes later in the form, and a loop", () => {
    expect(messages(parse([group([yes("a"), yes("b")]), ...base]))).toContain("A question that is shown only when another is answered has to stay after that question.");
    const loop = [yesNo("a"), field("x", { conditionalGroup: { match: "ANY", conditions: [yes("a"), yes("y")] } }), field("y", { conditional: yes("x") })];
    expect(messages(parse(loop))).toContain("This rule depends on itself through other questions' rules.");
  });

  it("refuses an address checked for a value, and an empty answer to match", () => {
    const address = field("home", { type: "ADDRESS" });
    expect(messages(parse([...base, address, group([yes("a"), yes("home")])]))).toContain("An address can only be checked as answered.");
    expect(messages(parse([...base, group([yes("a"), { fieldKey: "b", operator: "EQUALS", value: "" }])]))).toContain("Choose or enter the answer this condition looks for.");
    expect(parse([...base, address, group([yes("a"), { fieldKey: "home", operator: "NOT_EMPTY", value: "" }])]).success).toBe(true);
  });

  it("refuses an unknown operator at the schema", () => {
    const bad = { ...group([yes("a"), yes("b")]), conditionalGroup: { match: "ALL", conditions: [yes("a"), { fieldKey: "b", operator: "GREATER", value: "1" }] } };
    expect(parse([...base, bad as unknown as RegistrationFormField]).success).toBe(false);
  });
});

describe("hidden answers stay out of validation, price and capacity (#1072)", () => {
  const fields = [
    yesNo("bus"),
    yesNo("big_club"),
    field("bus_seats", { type: "NUMBER", required: true, priceCents: 1000, conditionalGroup: { match: "ALL", conditions: [yes("bus"), yes("big_club")] } }),
    field("bus_stop", { type: "RADIO", options: ["North", "South"], availabilityMode: "CAPACITY", choiceLimits: { North: 1 }, conditionalGroup: { match: "ANY", conditions: [yes("bus"), yes("big_club")] } }),
  ];
  const def = registrationFormDefinitionSchema.parse(definition(fields)) as RegistrationFormDefinition;

  it("prices the question only while the group shows it", () => {
    expect(calculateFormTotal(def, { bus: "Yes", big_club: "No", bus_seats: 3 }, "2026-01-01").lineItems).toEqual([]);
    expect(calculateFormTotal(def, { bus: "Yes", big_club: "Yes", bus_seats: 3 }, "2026-01-01").totalCents).toBe(3000);
  });

  it("does not require or validate a hidden question", () => {
    expect(validateTestResponses(def, { bus: "Yes", big_club: "No", bus_seats: "not a number" }).isValid).toBe(true);
    expect(validateTestResponses(def, { bus: "Yes", big_club: "Yes" }).issues.map((issue) => issue.key)).toEqual(["bus_seats"]);
  });

  it("does not count a hidden choice against capacity, and does once it shows", () => {
    const full = { bus_stop: { North: { total: 1, first: 0, second: 0 } } };
    expect(validateTestResponses(def, { bus: "No", big_club: "No", bus_stop: "North" }, full).isValid).toBe(true);
    expect(validateTestResponses(def, { bus: "No", big_club: "Yes", bus_stop: "North", bus_seats: 1 }, full).issues.map((issue) => issue.message)).toEqual(["North has reached its limit of 1."]);
  });
});

describe("copy and remap (#1072)", () => {
  it("maps every member of a module field to the copy's keys", () => {
    const module = { fields: [
      { ...field("kind", { type: "RADIO", options: ["A", "B"] }), id: undefined as never },
      { ...field("note", { conditionalGroup: { match: "ANY", conditions: [{ fieldKey: "kind", operator: "EQUALS", value: "A" }, { fieldKey: "extra", operator: "NOT_EMPTY", value: "" }] } }), id: undefined as never },
      { ...field("extra"), id: undefined as never },
    ] };
    let n = 0;
    const copies = instantiateModuleFields(module, new Set(["kind", "extra"]), () => `new_${n++}`);
    const note = copies.find((copy) => copy.label === "note")!;
    expect(visibilityControllerKeys(note)).toEqual([copies[0]!.key, copies[2]!.key]);
    expect(copies[0]!.key).not.toBe("kind");
    expect(note.conditional).toBeUndefined();
  });

  it("warns for an unsatisfiable member of an inserted module field", () => {
    const plan = planModuleInsert({ fields: [{ ...field("detail", { conditionalGroup: { match: "ALL", conditions: [yes("a"), { fieldKey: "role", operator: "EQUALS", value: "Cook" }] } }), id: undefined as never }] } as never, [{ key: "role", label: "Role", options: ["Lead"] }], () => "x");
    expect(plan.kind === "insert" && plan.conditionWarnings).toEqual([{ controllerLabel: "Role", value: "Cook", dependentLabels: ["detail"] }]);
  });

  it("follows renamed keys when a palette entry collides", () => {
    const existing = [field("kind"), field("note")];
    const fields = avoidCollisions([field("kind"), field("note", { conditionalGroup: { match: "ALL", conditions: [yes("kind"), yes("other")] } }), field("other")], existing, () => "fresh");
    expect(visibilityControllerKeys(fields[1]!)).toEqual([fields[0]!.key, fields[2]!.key]);
    expect(fields[0]!.key).not.toBe("kind");
  });

  const saved = (fields: RegistrationFormField[]) => ({ fields }) as never;
  const counter = () => { let n = 0; return () => `copy_${n++}`; };

  it("a library question keeps a group whose members were all copied", () => {
    const copy = instantiateLibraryFragment(saved([yesNo("a"), yesNo("b"), field("t", { required: true, conditionalGroup: { match: "ANY", conditions: [yes("a"), yes("b")] } })]), [{ key: "a" }], counter());
    expect(copy.repairs).toEqual([]);
    const t = copy.fields[2]!;
    expect(t.required).toBe(true);
    expect(visibilityControllerKeys(t)).toEqual([copy.fields[0]!.key, copy.fields[1]!.key]);
    expect(fieldVisibilityRule(t)?.match).toBe("ANY");
  });

  it("drops the whole rule and makes the question optional when any member was not copied", () => {
    const copy = instantiateLibraryFragment(saved([yesNo("a"), field("t", { required: true, conditionalGroup: { match: "ALL", conditions: [yes("a"), yes("outside")] } })]), [], counter());
    const t = copy.fields[1]!;
    expect(t.conditional).toBeUndefined();
    expect(t.conditionalGroup).toBeUndefined();
    expect(t.required).toBe(false);
    expect(copy.repairs).toHaveLength(1);
    expect(copy.repairs[0]!.message).toContain("outside");
  });

  it("a club form rename and delete reach every member", () => {
    const f = field("t", { conditionalGroup: { match: "ALL", conditions: [yes("a"), yes("b")] } });
    const spec = { definition: { title: "T", description: "", confirmationMessage: "", sections: [{ id: "sec", title: "S", description: "", fields: [yesNo("a"), yesNo("b"), f] }] }, sensitiveFieldKeys: [], birthDateFieldKeys: [], staffOnlyFieldKeys: [], hiddenFieldKeys: [], sectionNotes: {}, rosterMapping: null } as unknown as ClubFormDraftSpec;
    const renamed = renameFieldKey(spec, "id_b", "b2").definition.sections[0]!.fields[2]!;
    expect(visibilityControllerKeys(renamed)).toEqual(["a", "b2"]);
    const removed = removeField(spec, "id_a").definition.sections[0]!.fields.find((candidate) => candidate.key === "t")!;
    // Down to one member, so it is a single rule again.
    expect(removed.conditional).toEqual(yes("b"));
    expect(removed.conditionalGroup).toBeUndefined();
    expect(mapVisibilityConditions(field("plain"), () => null)).toEqual(field("plain"));
  });
});

describe("indirect sensitive and filter disclosure (#1072)", () => {
  const med = yesNo("medical_conditions", { label: "Medical conditions", scope: "ATTENDEE" });
  const neutral = yesNo("tent", { scope: "ATTENDEE" });
  const all = (fields: RegistrationFormField[]) => fields;

  it("follows a second member up to a sensitive controller", () => {
    const shirt = field("shirt", { type: "SELECT", scope: "ATTENDEE", options: ["S", "M"], conditionalGroup: { match: "ALL", conditions: [yes("tent"), yes("medical_conditions")] } });
    const fields = all([neutral, med, shirt]);
    expect(isLinkedToBlockedField(shirt, fields, (other) => other.key === "medical_conditions")).toBe(true);
  });

  it("follows every member down from a sensitive question", () => {
    const shirt = field("shirt", { type: "SELECT", scope: "ATTENDEE", options: ["S", "M"], conditionalGroup: { match: "ANY", conditions: [yes("tent"), yes("medical_conditions")] } });
    const fields = all([neutral, med, shirt]);
    // The neutral question controls the sensitive-linked shirt: the walk is up-and-down, so the shirt blocks the controller of its other member.
    expect(isLinkedToBlockedField(neutral, fields, (other) => other.key === "medical_conditions")).toBe(false);
    expect(isLinkedToBlockedField(med, fields, (other) => other.key === "shirt")).toBe(true);
  });

  it("keeps a filter out of the offer when only a later member is sensitive", () => {
    const dependent = field("style", { type: "SELECT", scope: "ATTENDEE", options: ["A", "B"], filterable: true, conditionalGroup: { match: "ALL", conditions: [yes("tent"), yes("medical_conditions")] } });
    const fields = all([neutral, med, dependent]);
    const offer = resolveFieldOffer(dependent, { allFields: fields, sectionTitleOf: sectionTitleLookup([{ id: "s", title: "Choices", description: "", fields }] as never), paymentMethodFieldKey: null });
    expect(offer.linkedToSensitive).toBe(true);
    expect(offer.sensitive).toBe(true);
  });

  it("leaves a question out of the draft, the staff link form and a group form when any member is excluded", () => {
    const health = yesNo("medical_conditions", { label: "Medical conditions" });
    const dependent = field("detail", { conditionalGroup: { match: "ANY", conditions: [yes("tent"), yes("medical_conditions")] } });
    const def = registrationFormDefinitionSchema.parse(definition([yesNo("tent"), health, dependent])) as RegistrationFormDefinition;
    expect(draftExcludedKeys(def).has("detail")).toBe(true);
    expect(staffEventQuestions(def).map((question) => question.key)).not.toContain("detail");
    const club = registrationFormDefinitionSchema.parse(definition([yesNo("club_choice", { optionSource: "CLUBS_DIRECTORY", options: [] }), yesNo("tent"), field("tent_note", { conditionalGroup: { match: "ALL", conditions: [yes("tent"), yes("club_choice")] } })]));
    expect(groupFormDefinition(club).sections.flatMap((section) => section.fields).map((candidate) => candidate.key)).toEqual(["tent"]);
  });
});

describe("rule summary, editor and move order (#1072)", () => {
  const def = registrationFormDefinitionSchema.parse(definition([
    yesNo("bus", { label: "Traveling by club bus" }),
    field("size", { label: "Club size", type: "NUMBER" }),
    field("seats", { label: "Bus seats needed", conditionalGroup: { match: "ALL", conditions: [yes("bus"), { fieldKey: "size", operator: "NOT_EMPTY", value: "" }] } }),
    field("pickup", { label: "Pickup location", conditional: yes("bus") }),
    field("plain", { label: "Plain" }),
  ], {})) as RegistrationFormDefinition;
  // The legacy removed reference still parses: the original checks apply to a single rule only when strict is off, and the original check refuses it.
  it("lists each conditional question and flags a deleted reference", () => {
    const parsed = registrationFormDefinitionSchema.safeParse(definition([yesNo("bus"), field("shirt", { conditional: yes("removed_question") })]));
    expect(parsed.success).toBe(false);
  });

  it("summarizes from a definition whose reference was deleted after it was saved", () => {
    const withGone = structuredClone(def);
    withGone.sections[0]!.fields.push(field("shirt", { label: "Shirt size", conditional: yes("wants_shirt") }));
    const entries = ruleSummary(withGone);
    expect(entries.map((entry) => entry.label)).toEqual(["Bus seats needed", "Pickup location", "Shirt size"]);
    expect(entries[0]).toMatchObject({ match: "ALL", needsFix: false, phrases: ["Traveling by club bus is Yes", "Club size is answered"] });
    expect(entries[1]).toMatchObject({ needsFix: false, phrases: ["Traveling by club bus is Yes"] });
    expect(entries[2]!.needsFix).toBe(true);
    expect(entries[2]!.fixMessage).toBe("Needs a fix: it depends on “wants_shirt”, which was removed.");
  });

  it("reads as a sentence and edits rows", () => {
    const seats = def.sections[0]!.fields.find((candidate) => candidate.key === "seats")!;
    const all = def.sections.flatMap((section) => section.fields);
    expect(readsAs(seats, all)).toBe("Reads as: shown when Traveling by club bus is Yes and Club size is answered.");
    expect(readsAs({ ...seats, conditionalGroup: { ...seats.conditionalGroup!, match: "ANY" } }, all)).toContain(" or ");
    expect(showWhenSummary(seats, all)).toBe("All of: Traveling by club bus is Yes; Club size is answered");
    const rule = fieldVisibilityRule(seats)!;
    expect(ruleEditPatch(withoutCondition(rule, 1))).toEqual({ conditional: yes("bus"), conditionalGroup: undefined });
    expect(withoutCondition({ match: "ALL", conditions: [yes("bus")] }, 0)).toBeNull();
    expect(withAddedCondition(rule, seats, all)!.conditions).toHaveLength(3);
  });

  it("refuses a move that puts a question before any member of its rule", () => {
    const sections = structuredClone(def.sections);
    const fields = sections[0]!.fields;
    const [seats] = fields.splice(2, 1);
    fields.splice(1, 0, seats!);
    expect(newOrderInversion(def.sections, sections, "id_seats")).toContain("Club size");
    expect(newOrderInversion(def.sections, def.sections, "id_seats")).toBeNull();
  });
});
