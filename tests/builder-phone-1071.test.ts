import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { newOrderInversion, ordinal, planAdjacentMove, planMoveToStep, positionStatus, showWhenSummary } from "@/components/registration-builder/phone-move";
import { KEYBOARD_MIN_INSET, keyboardInset } from "@/components/registration-builder/use-keyboard-inset";
import type { RegistrationFormDefinition, RegistrationFormField } from "@/modules/forms/definition";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const css = read("app/globals.css");

type Sections = RegistrationFormDefinition["sections"];

function field(id: string, label: string, patch: Partial<RegistrationFormField> = {}): RegistrationFormField {
  return { id, key: id, label, helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], ...patch };
}

// Synthetic: step 1 Club has three questions; the third is shown only when the second (Yes / No) is Yes. Step 3 is the final review.
function sections(): Sections {
  return [
    { id: "s1", title: "Club", description: "", fields: [
      field("club_name", "Club name"),
      field("by_bus", "Traveling by club bus", { type: "RADIO", options: ["Yes", "No"] }),
      field("bus_seats", "Bus seats needed", { type: "NUMBER", conditional: { fieldKey: "by_bus", operator: "EQUALS", value: "Yes" } }),
    ] },
    { id: "s2", title: "Attendees", description: "", fields: [field("shirt", "Shirt size"), field("notes", "Notes")] },
    { id: "s3", title: "Review", description: "", isReviewStep: true, fields: [field("agree", "I agree")] },
  ];
}

const ids = (list: Sections, index: number) => list[index]!.fields.map((entry) => entry.id);

describe("Move screen position line (#1071)", () => {
  it("reads like the approved wording", () => {
    expect(positionStatus(sections(), "bus_seats")).toBe("Now 3rd of 3 in step 1 · Club.");
    expect(positionStatus(sections(), "shirt")).toBe("Now 1st of 2 in step 2 · Attendees.");
    expect(positionStatus(sections(), "missing")).toBe("");
  });

  it("has correct ordinals, including the teens", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });
});

describe("Move up and Move down (#1071)", () => {
  it("swap one place inside the step and keep the field's identity", () => {
    const plan = planAdjacentMove(sections(), "shirt", 1);
    expect(plan.kind).toBe("moved");
    if (plan.kind !== "moved") return;
    expect(ids(plan.sections, 1)).toEqual(["notes", "shirt"]);
    // Same ids and keys: it is the same question, not a copy.
    expect(plan.sections[1]!.fields[1]).toEqual(sections()[1]!.fields[0]);
  });

  it("do nothing at either end", () => {
    expect(planAdjacentMove(sections(), "club_name", -1).kind).toBe("nothing");
    expect(planAdjacentMove(sections(), "notes", 1).kind).toBe("nothing");
    expect(planAdjacentMove(sections(), "missing", 1).kind).toBe("nothing");
  });

  it("refuse to put a question in front of the question its show-when rule depends on", () => {
    const plan = planAdjacentMove(sections(), "bus_seats", -1);
    expect(plan.kind).toBe("refused");
    if (plan.kind !== "refused") return;
    expect(plan.message).toContain('"Bus seats needed"');
    expect(plan.message).toContain("has to stay after that question");
  });

  it("refuse to move a question behind a question that depends on it", () => {
    const plan = planAdjacentMove(sections(), "by_bus", 1);
    expect(plan.kind).toBe("refused");
    if (plan.kind !== "refused") return;
    expect(plan.message).toContain("has to stay before it");
  });

  it("also guard an optional-when rule, but only across steps", () => {
    const list = sections();
    list[1]!.fields[0] = field("shirt", "Shirt size", { optionalWhen: { fieldKey: "club_name", operator: "NOT_EMPTY", value: "" } });
    const refused = planMoveToStep(list, "club_name", 2);
    expect(refused.kind).toBe("refused");
    // The message names the optional-when rule, not a show-when rule.
    expect(refused.kind === "refused" && refused.message).toMatch(/becomes optional depending on/);
    expect(planMoveToStep(list, "shirt", 0).kind).toBe("moved");
    // Inside one step the order changes nothing, so it is free.
    const same = sections();
    same[0]!.fields[2] = field("late", "Late", { optionalWhen: { fieldKey: "club_name", operator: "NOT_EMPTY", value: "" } });
    expect(planAdjacentMove(same, "club_name", 1).kind).toBe("moved");
  });

  it("lets a mutual optional-when pair (the club form's two guardian signatures) move freely", () => {
    const list = sections();
    list[1]!.fields = [
      field("father", "Father signature", { optionalWhen: { fieldKey: "mother", operator: "NOT_EMPTY", value: "" } }),
      field("mother", "Mother signature", { optionalWhen: { fieldKey: "father", operator: "NOT_EMPTY", value: "" } }),
    ];
    expect(planAdjacentMove(list, "father", 1).kind).toBe("moved");
    expect(planAdjacentMove(list, "mother", -1).kind).toBe("moved");
    expect(planMoveToStep(list, "father", 0).kind).toBe("moved");
    expect(planMoveToStep(list, "mother", 0).kind).toBe("moved");
  });

  it("refuses a step move that would put a controller after its dependents, and allows one that does not", () => {
    const list = sections();
    list[1]!.fields.push(field("late_dep", "Late", { conditional: { fieldKey: "club_name", operator: "NOT_EMPTY", value: "" } }));
    const swapped = [list[1]!, list[0]!, list[2]!];
    expect(newOrderInversion(list, swapped)).toContain("depends on");
    expect(newOrderInversion(list, list)).toBeNull();
  });
});

describe("Move to step (#1071)", () => {
  it("puts the question at the end of the chosen step and leaves the step order alone", () => {
    const before = sections();
    const plan = planMoveToStep(before, "club_name", 1);
    expect(plan.kind).toBe("moved");
    if (plan.kind !== "moved") return;
    expect(ids(plan.sections, 0)).toEqual(["by_bus", "bus_seats"]);
    expect(ids(plan.sections, 1)).toEqual(["shirt", "notes", "club_name"]);
    // The final review step is still last, and no step moved.
    expect(plan.sections.map((section) => section.id)).toEqual(["s1", "s2", "s3"]);
    expect(plan.sections.at(-1)!.isReviewStep).toBe(true);
    // The draft it was made from is untouched.
    expect(ids(before, 0)).toEqual(["club_name", "by_bus", "bus_seats"]);
  });

  it("does nothing for the step it is already in", () => {
    expect(planMoveToStep(sections(), "club_name", 0).kind).toBe("nothing");
    expect(planMoveToStep(sections(), "club_name", 9).kind).toBe("nothing");
  });

  it("refuses a move that would leave its step empty, or fill the target step", () => {
    expect(planMoveToStep(sections(), "agree", 0)).toMatchObject({ kind: "refused", message: expect.stringContaining("at least one field") });
    const full = sections();
    full[1]!.fields = Array.from({ length: 20 }, (_, index) => field(`filler_${index}`, `Filler ${index}`));
    expect(planMoveToStep(full, "club_name", 1)).toMatchObject({ kind: "refused", message: expect.stringContaining("up to 20") });
  });

  it("refuses to move the dependent question to a step before its controller, and the controller to a step after it", () => {
    const list = sections();
    // by_bus moves to step 2, behind bus_seats (still in step 1): refused. bus_seats moving to step 2 stays after by_bus: fine.
    expect(planMoveToStep(list, "by_bus", 1).kind).toBe("refused");
    expect(planMoveToStep(list, "bus_seats", 1).kind).toBe("moved");
    // With the dependent question already in step 2, the end of step 2 or step 3 is behind it, so its controller cannot go there.
    const split = sections();
    const [dependent] = split[0]!.fields.splice(2, 1);
    split[1]!.fields.push(dependent!);
    expect(planMoveToStep(split, "by_bus", 1).kind).toBe("refused");
    expect(planMoveToStep(split, "by_bus", 2).kind).toBe("refused");
  });

  it("lets a form that is already out of order be repaired with Up and Down, and refuses only new inversions", () => {
    const odd = sections();
    // bus_seats is first, ahead of its controller by_bus.
    odd[0]!.fields = [odd[0]!.fields[2]!, odd[0]!.fields[0]!, odd[0]!.fields[1]!];
    expect(newOrderInversion(odd, odd, "club_name")).toBeNull();
    expect(planAdjacentMove(odd, "club_name", 1).kind).toBe("moved");
    // Moving the dependent question down toward its controller repairs the order.
    expect(planAdjacentMove(odd, "bus_seats", 1).kind).toBe("moved");
    // Once repaired, undoing the repair is a new inversion and is refused.
    const fixed = planAdjacentMove(odd, "bus_seats", 1);
    if (fixed.kind !== "moved") throw new Error("expected a move");
    const repaired = planAdjacentMove(fixed.sections, "by_bus", -1);
    expect(repaired.kind).toBe("moved");
    if (repaired.kind !== "moved") return;
    expect(planAdjacentMove(repaired.sections, "bus_seats", -1).kind).toBe("refused");
  });
});

describe("show-when summary on the question card (#1071)", () => {
  it("names the controlling question, the operator and the value", () => {
    const all = sections().flatMap((section) => section.fields);
    expect(showWhenSummary(all[2]!, all)).toBe("Traveling by club bus is Yes");
    expect(showWhenSummary(all[0]!, all)).toBeNull();
    const rule = (operator: "EQUALS" | "NOT_EQUALS" | "INCLUDES" | "NOT_EMPTY") => showWhenSummary(field("x", "X", { conditional: { fieldKey: "club_name", operator, value: "Pine" } }), all);
    expect(rule("NOT_EQUALS")).toBe("Club name is not Pine");
    expect(rule("INCLUDES")).toBe("Club name includes Pine");
    expect(rule("NOT_EMPTY")).toBe("Club name is answered");
  });
});

describe("sticky bar above the keyboard (#1071)", () => {
  it("lifts by what the keyboard covers", () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(844, { height: 500, offsetTop: 0 })).toBe(344);
    expect(keyboardInset(844, { height: 500, offsetTop: 30.4 })).toBe(314);
    expect(keyboardInset(844, { height: 900, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(844, null)).toBe(0);
    expect(keyboardInset(844, { height: 0, offsetTop: 0 })).toBe(0);
    expect(KEYBOARD_MIN_INSET).toBeGreaterThan(60);
  });
});

describe("the phone builder wiring (#1071)", () => {
  const shell = read("components/registration-builder/builder-editor-shell.tsx");
  const canvas = read("components/registration-builder/builder-phone-canvas.tsx");
  const moveSheet = read("components/registration-builder/builder-phone-move.tsx");
  const sheet = read("components/registration-builder/builder-phone-sheet.tsx");
  const modal = read("components/registration-builder/use-phone-modal.ts");
  const edits = read("components/registration-builder/use-builder-edits.ts");

  it("opens the builder on phones: no hidden wrapper, notice or device hint", () => {
    const page = read("app/(workspace)/registration-builder/page.tsx");
    expect(page).not.toContain("builder-phone-hidden");
    expect(page).not.toContain("BuilderPhoneNotice");
    expect(page).not.toContain("BuilderDeviceHint");
  });

  it("shows one step at a time with Edit, Move and More on each question, and an Add question button", () => {
    expect(canvas).toContain('aria-label="Steps"');
    expect(canvas).toContain('aria-current={index === sectionIndex ? "step" : undefined}');
    expect(canvas).toContain("Shown when: {rule}");
    expect(canvas).toContain("aria-label={`Move ${label}`}");
    expect(canvas).toContain("aria-label={`More actions for ${label}`}");
    expect(canvas).toContain("Add question");
    expect(canvas).toContain("data-fb-phone-edit={field.id}");
    // The #1060 protections still hold on the form title and description.
    expect(canvas).toContain('autoComplete="off" name="builder-rb-field-1"');
    expect(canvas).toContain('autoComplete="off" name="builder-rb-note-2"');
    expect(moveSheet).toContain('name="builder-rb-move-step"');
  });

  it("Add question opens the searchable palette as a sheet, and settings open full screen with Done", () => {
    expect(shell).toContain('tab === "questions" ? "Add a question"');
    expect(shell).toContain('doneLabel: tab === "questions" ? "Close" : "Done"');
    expect(shell).toContain("setInspectorOpen(true);\n    request({ kind: \"search\" });");
    expect(shell).toContain("Done keeps your changes in this draft. They are saved with Save draft.");
  });

  it("keeps Save draft and Preview in a sticky bar, with Publish in the top bar and one filled button", () => {
    expect(shell).toContain('className="fb-phone-bar"');
    expect(shell).toContain("{!phone && <BuilderSaveDraftButton");
    expect(shell).toContain('"fb-btn outline" : "fb-btn primary"');
    expect(shell).toContain('<BuilderPublishButton className="fb-btn primary" />');
    expect(css).toContain('.fb-phone-bar[data-engaged], .fb-phone-bar[data-keyboard="open"] { position: sticky; }');
    expect(css).toMatch(/\.fb-phone-bar \{ position: static; bottom: calc\(var\(--fb-keyboard-inset, 0px\) \+ 8px\)/);
    expect(css).toContain("body:has(.mobile-nav) .fb-phone-bar { bottom: calc(67px + env(safe-area-inset-bottom, 0px) + 8px); }");
  });

  it("the Move screen has Move up, Move down, Move to step and a status line, and never saves", () => {
    expect(moveSheet).toContain('role="status"');
    expect(moveSheet).toContain('role="alert"');
    expect(moveSheet).toContain("Move up");
    expect(moveSheet).toContain("Move down");
    expect(moveSheet).toContain("Move to step");
    expect(moveSheet).toContain("Move to this step");
    expect(moveSheet).toContain('aria-disabled={first ? "true" : undefined}');
    expect(moveSheet).toContain('aria-disabled={last ? "true" : undefined}');
    for (const forbidden of ["saveDraft", "beginPublish", "setDirty", "discard"]) expect(moveSheet, forbidden).not.toContain(forbidden);
  });

  it("every move path refuses a dependency inversion: the buttons, the Move screen and the drag", () => {
    expect(edits).toContain("planAdjacentMove(definition.sections, fieldId, direction)");
    expect(edits).toContain("planMoveToStep(definition.sections, fieldId, targetSectionIndex)");
    expect(edits).toContain("newOrderInversion(definition.sections, plan.sections, movedId)");
    expect(edits).toContain("if (!result.ok) setError(result.message);");
  });

  it("modal surfaces trap focus, close on Escape, make the page inert and give focus back", () => {
    for (const text of [modal]) {
      expect(text).toContain("makeBackgroundInert");
      expect(text).toContain("trappedTabIndex");
      // Escape and the Tab loop run in the shared dialog core (#1354).
      expect(text).toContain("dialogKeyDown(");
      expect(read("components/use-accessible-dialog.ts")).toContain('event.key === "Escape"');
      expect(text).toContain("pushOpenDialog()");
      expect(text).toContain("removeOpenDialog(token)");
      expect(text).toContain("opener.focus");
      expect(text).toContain("pickerViewportBox");
    }
    expect(sheet).toContain('role="dialog" aria-modal="true"');
    expect(sheet).toContain("usePhoneModal(");
    expect(shell).toContain("modal={sheetActive}");
    expect(read("components/registration-builder/builder-sidebar.tsx")).toContain('aria-modal={modal ? "true" : undefined}');
  });

  it("the stylesheet gives every phone control at least 44px and leaves shared font-size rules alone", () => {
    const block = css.slice(css.indexOf("/* Registration form builder on a phone (#1071)"));
    expect(block).toContain("min-height: var(--touch-target, 44px)");
    expect(block).toMatch(/\.fb-phone-card-actions \.fb-btn \{[^}]*min-height: 48px/);
    expect(block).toMatch(/\.fb-phone-step-pill \{[^}]*min-height: var\(--touch-target, 44px\)/);
    expect(block).toMatch(/\.fb-phone-step-option \{[^}]*min-height: var\(--touch-target, 44px\)/);
    expect(block).toMatch(/\.fb-phone-sheet \.fb-btn \{ min-height: 48px; \}/);
    // No literal font size under 0.875rem anywhere in the new block.
    for (const match of block.matchAll(/font-size:\s*([\d.]+)rem/g)) expect(Number(match[1])).toBeGreaterThanOrEqual(0.875);
    expect(block).toContain("scroll-padding-bottom");
  });
});
