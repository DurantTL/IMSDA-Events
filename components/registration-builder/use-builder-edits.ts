// Edits to the draft definition: field and section changes, reordering, module
// insertion and the review-step toggle. Every edit goes through replaceDefinition.
import { isAgeFieldKey, pruneRequireAtLeastOne, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";
import { moduleAlreadyPresentNotice, moduleAttendeeRoster, moduleInsertNotice, planModuleInsert, type BuilderModuleDefinition } from "@/modules/forms/builder-modules";
import { isPublicReviewSection } from "@/modules/forms/public-registration-steps";
import type { PaletteEntry } from "./palette-registry";
import { planPaletteInsert } from "./palette-insert";
import { planFieldDrop } from "./field-drop";
import { dependencyOrderIssue, planAdjacentMove, planMoveToStep, type MovePlan } from "./phone-move";
import { localId, defaultField, blankPreviewAttendees } from "./builder-types";
import { isAtBaseline, recordEdit, redo as redoStep, singleValueEditKey, undo as undoStep } from "./edit-history";
import type { BuilderState } from "./use-builder-state";
import type { BuilderDerived } from "./use-builder-derived";

export function useBuilderEdits(state: BuilderState, derived: BuilderDerived) {
  const { history, setHistory, expandedFieldId, setAutoKeyFieldIds, definition, setDefinition, setPreviewAttendees, setDirty, setNotice, setError, setTestIssues, dragging, setDragging, setExpandedFieldId, previewRef, closeModuleLibrary, setLibraryRepairs } = state;
  const { totalFields, allFields } = derived;
  function replaceDefinition(next: RegistrationFormDefinition) {
    const pruned = pruneRequireAtLeastOne(next);
    if (definition && pruned !== definition) {
      const before = definition;
      const now = Date.now();
      setHistory((current) => recordEdit(current, before, singleValueEditKey(before, pruned), now));
    }
    setDefinition(pruned); setDirty(true); setNotice(""); setError(""); setTestIssues([]);
  }

  // Undo and redo (#1134) swap the draft for an earlier or later one. They always mark the draft changed: the
  // saved definition is not kept here, so the builder never claims a draft is clean when it might not be.
  // Dirty is false only when the draft is the saved or loaded definition itself.
  function stepHistory(step: typeof undoStep, message: string) {
    if (!definition) return;
    const result = step(history, definition);
    if (!result) return;
    const restored = result.value;
    setHistory(result.history); setDefinition(restored); setDirty(!isAtBaseline(result.history, restored)); setError(""); setTestIssues([]);
    const ids = new Set(restored.sections.flatMap((section) => section.fields.map((field) => field.id)));
    if (expandedFieldId && !ids.has(expandedFieldId)) setExpandedFieldId(null);
    setAutoKeyFieldIds((current) => current.size === 0 || Array.from(current).every((id) => ids.has(id)) ? current : new Set(Array.from(current).filter((id) => ids.has(id))));
    if (JSON.stringify(restored.attendeeRoster ?? null) !== JSON.stringify(definition.attendeeRoster ?? null)) setPreviewAttendees(blankPreviewAttendees(restored));
    // Announced through the notices' status region.
    setNotice(message);
  }
  const undoEdit = () => stepHistory(undoStep, "Undid last change.");
  const redoEdit = () => stepHistory(redoStep, "Redid change.");

  function updateSection(index: number, patch: Partial<RegistrationFormDefinition["sections"][number]>) {
    if (!definition) return;
    const sections = definition.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section);
    replaceDefinition({ ...definition, sections });
  }

  function updateField(sectionIndex: number, fieldIndex: number, patch: Partial<RegistrationFormField>) {
    if (!definition) return;
    const sections = definition.sections.map((section, currentSection) => currentSection === sectionIndex ? {
      ...section, fields: section.fields.map((field, currentField) => currentField === fieldIndex ? { ...field, ...patch } : field),
    } : section);
    replaceDefinition({ ...definition, sections });
  }

  function updateNumberBounds(sectionIndex: number, fieldIndex: number, field: RegistrationFormField, edge: "minimumAge" | "maximumAge", raw: string) {
    const parsed = raw.trim() === "" ? null : Math.min(isAgeFieldKey(field.key) ? 130 : 100000, Math.max(0, Math.floor(Number(raw))));
    const value = parsed === null || Number.isNaN(parsed) ? null : parsed;
    const next = { minimumAge: field.ageBounds?.minimumAge ?? null, maximumAge: field.ageBounds?.maximumAge ?? null, [edge]: value };
    updateField(sectionIndex, fieldIndex, { ageBounds: next.minimumAge === null && next.maximumAge === null ? undefined : next });
  }

  // Move up, Move down and Move to step by question id (#1071), for the phone Move screen. They hand a refusal back to the
  // caller instead of the page's error notice, so the screen can show it where the person is looking.
  type MoveResult = { ok: true; unchanged?: boolean } | { ok: false; message: string };
  function applyMovePlan(plan: MovePlan): MoveResult {
    if (!definition || plan.kind === "nothing") return { ok: true, unchanged: true };
    if (plan.kind === "refused") return { ok: false, message: plan.message };
    replaceDefinition({ ...definition, sections: plan.sections });
    return { ok: true };
  }
  const moveFieldBy = (fieldId: string, direction: -1 | 1): MoveResult => definition ? applyMovePlan(planAdjacentMove(definition.sections, fieldId, direction)) : { ok: true, unchanged: true };
  const moveFieldToStep = (fieldId: string, targetSectionIndex: number): MoveResult => definition ? applyMovePlan(planMoveToStep(definition.sections, fieldId, targetSectionIndex)) : { ok: true, unchanged: true };

  function moveField(sectionIndex: number, fieldIndex: number, direction: -1 | 1) {
    if (!definition) return;
    const field = definition.sections[sectionIndex]?.fields[fieldIndex];
    if (!field) return;
    const result = moveFieldBy(field.id, direction);
    if (!result.ok) setError(result.message);
  }

  function moveSection(sectionIndex: number, direction: -1 | 1) {
    if (!definition) return;
    const nextIndex = sectionIndex + direction;
    if (nextIndex < 0 || nextIndex >= definition.sections.length) return;
    const reviewSectionIndex = definition.sections.findIndex((section) => (
      isPublicReviewSection(definition, section)
    ));
    if (
      sectionIndex === reviewSectionIndex
      || (direction === 1 && nextIndex === reviewSectionIndex)
    ) return;
    const sections = [...definition.sections];
    [sections[sectionIndex], sections[nextIndex]] = [sections[nextIndex], sections[sectionIndex]];
    replaceDefinition({ ...definition, sections });
  }

  function dropSection(targetIndex: number) {
    if (!definition || dragging?.kind !== "section") return;
    const source = definition.sections[dragging.sectionIndex];
    if (isPublicReviewSection(definition, source)) {
      setDragging(null);
      return;
    }
    const sections = [...definition.sections];
    const [section] = sections.splice(dragging.sectionIndex, 1);
    const reviewIndex = sections.findIndex((candidate) => (
      isPublicReviewSection({ ...definition, sections }, candidate)
    ));
    const adjustedTarget = dragging.sectionIndex < targetIndex
      ? targetIndex - 1
      : targetIndex;
    sections.splice(
      reviewIndex >= 0 ? Math.min(adjustedTarget, reviewIndex) : adjustedTarget,
      0,
      section,
    );
    setDragging(null);
    replaceDefinition({ ...definition, sections });
  }

  function dropField(targetSectionIndex: number, targetFieldIndex: number) {
    if (!definition || dragging?.kind !== "field") return;
    const plan = planFieldDrop(definition.sections, { sectionIndex: dragging.sectionIndex, fieldIndex: dragging.fieldIndex }, { sectionIndex: targetSectionIndex, fieldIndex: targetFieldIndex });
    setDragging(null);
    if (plan.kind === "error") { setError(plan.message); return; }
    if (plan.kind !== "moved") return;
    // A question shown only when another is answered stays after it (#1071).
    const movedId = definition.sections[dragging.sectionIndex]?.fields[dragging.fieldIndex]?.id;
    const issue = movedId ? dependencyOrderIssue(plan.sections, movedId) : null;
    if (issue) setError(issue);
    else replaceDefinition({ ...definition, sections: plan.sections });
  }

  function showPreview() {
    previewRef.current?.focus({ preventScroll: true });
    previewRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }

  function removeField(sectionIndex: number, fieldIndex: number) {
    if (!definition) return;
    const section = definition.sections[sectionIndex];
    if (section.fields.length === 1) { setError("Each section must keep at least one field."); return; }
    updateSection(sectionIndex, { fields: section.fields.filter((_, index) => index !== fieldIndex) });
  }

  function duplicateField(sectionIndex: number, fieldIndex: number) {
    if (!definition) return;
    const source = definition.sections[sectionIndex].fields[fieldIndex];
    if (definition.sections[sectionIndex].fields.length >= 20) {
      setError("A section can contain up to 20 fields. Add another section before copying this field.");
      return;
    }
    const usedKeys = new Set(allFields.map((field) => field.key));
    const baseKey = `${source.key.slice(0, 55)}_copy`;
    let key = baseKey;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${baseKey.slice(0, 57)}_${suffix}`;
      suffix += 1;
    }
    const duplicate = {
      ...structuredClone(source),
      id: localId("field"),
      key,
      label: `${source.label} copy`.slice(0, 120),
    };
    const fields = [...definition.sections[sectionIndex].fields];
    fields.splice(fieldIndex + 1, 0, duplicate);
    updateSection(sectionIndex, { fields });
    setExpandedFieldId(duplicate.id);
  }

  // `atIndex` places the module's fields before that field; left out, they go at the end of the section.
  function addModule(sectionIndex: number, module: BuilderModuleDefinition, atIndex?: number) {
    if (!definition) return;
    const existingFields = definition.sections.flatMap((section) => section.fields);
    const plan = planModuleInsert(module, existingFields, () => localId("field"));
    if (plan.kind === "already-present") {
      const existing = existingFields.find((field) => plan.existingKeys.includes(field.key));
      setExpandedFieldId(existing?.id ?? null);
      closeModuleLibrary();
      setNotice(moduleAlreadyPresentNotice(module, plan));
      return;
    }
    const { fields } = plan;
    if (definition.sections[sectionIndex].fields.length + fields.length > 20) {
      setError(
        `${module.name} does not fit in this section. Add another section and place the module there.`,
      );
      return;
    }
    const section = definition.sections[sectionIndex];
    const insertAt = atIndex === undefined ? section.fields.length : Math.min(Math.max(atIndex, 0), section.fields.length);
    const sections = definition.sections.map((candidate, index) => index === sectionIndex
      ? { ...candidate, fields: [...section.fields.slice(0, insertAt), ...fields, ...section.fields.slice(insertAt)] }
      : candidate);
    const attendeeRoster = moduleAttendeeRoster(definition.attendeeRoster, module);
    const nextDefinition = { ...definition, sections, attendeeRoster };
    replaceDefinition(nextDefinition);
    if (module.enablesAttendeeRoster && !definition.attendeeRoster?.enabled) {
      setPreviewAttendees(blankPreviewAttendees(nextDefinition));
    }
    setExpandedFieldId(fields[0]?.id ?? null);
    closeModuleLibrary();
    const insertNotice = moduleInsertNotice(plan);
    if (insertNotice) setNotice(insertNotice);
  }

  // The Questions palette (#1132): add an entry's fields to a step, at the end or before `atIndex`.
  // Modules go through addModule so their fixed keys, "already on the form" check, roster switch-on and notices stay as they were.
  function addPaletteEntry(entry: PaletteEntry, sectionIndex: number, atIndex?: number) {
    if (!definition) return;
    const plan = planPaletteInsert(definition, entry, sectionIndex, atIndex, () => localId("field"));
    if (plan.kind === "module") addModule(sectionIndex, plan.module, plan.atIndex);
    else if (plan.kind === "error") setError(plan.message);
    else if (plan.kind === "inserted") {
      replaceDefinition({ ...definition, sections: plan.sections });
      setExpandedFieldId(plan.selectedFieldId);
      if (plan.repairs.length > 0) {
        setLibraryRepairs((current) => ({ ...current, ...Object.fromEntries(plan.repairs.map((repair) => [repair.fieldId, repair.message])) }));
        setNotice(`${plan.repairs.length === 1 ? "1 question needs" : `${plan.repairs.length} questions need`} repair: a condition could not be carried over from the library. It is marked on the question.`);
      }
    }
  }

  function addSection() {
    if (!definition) return;
    const sections = [...definition.sections];
    const reviewIndex = sections.findIndex((section) => (
      isPublicReviewSection(definition, section)
    ));
    sections.splice(
      reviewIndex >= 0 ? reviewIndex : sections.length,
      0,
      {
        id: localId("section"),
        title: "New section",
        description: "",
        fields: [defaultField(totalFields + 1)],
      },
    );
    replaceDefinition({ ...definition, sections });
  }

  function removeSection(sectionIndex: number) {
    if (!definition) return;
    if (definition.sections.length === 1) { setError("A form must keep at least one section."); return; }
    replaceDefinition({ ...definition, sections: definition.sections.filter((_, index) => index !== sectionIndex) });
  }

  function setReviewSection(sectionIndex: number, enabled: boolean) {
    if (!definition) return;
    const sections = definition.sections.map((section, index) => ({
      ...section,
      isReviewStep: enabled ? index === sectionIndex : index === sectionIndex
        ? false
        : section.isReviewStep ?? false,
    }));
    if (enabled) {
      const [reviewSection] = sections.splice(sectionIndex, 1);
      sections.push(reviewSection);
    }
    closeModuleLibrary();
    replaceDefinition({ ...definition, sections });
  }
  return { undoEdit, redoEdit, replaceDefinition, updateSection, updateField, updateNumberBounds, moveField, moveFieldBy, moveFieldToStep, moveSection, dropSection, dropField, showPreview, removeField, duplicateField, addModule, addPaletteEntry, addSection, removeSection, setReviewSection };
}

export type BuilderEdits = ReturnType<typeof useBuilderEdits>;
