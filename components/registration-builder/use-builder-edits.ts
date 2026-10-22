// Edits to the draft definition: field and section changes, reordering, module
// insertion and the review-step toggle. Every edit goes through replaceDefinition.
import { isAgeFieldKey, pruneRequireAtLeastOne, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";
import { moduleAlreadyPresentNotice, moduleAttendeeRoster, moduleInsertNotice, planModuleInsert, type BuilderModuleDefinition } from "@/modules/forms/builder-modules";
import { isPublicReviewSection } from "@/modules/forms/public-registration-steps";
import { localId, defaultField, blankPreviewAttendees } from "./builder-types";
import type { BuilderState } from "./use-builder-state";
import type { BuilderDerived } from "./use-builder-derived";

export function useBuilderEdits(state: BuilderState, derived: BuilderDerived) {
  const { definition, setDefinition, setPreviewAttendees, setDirty, setNotice, setError, setTestIssues, dragging, setDragging, setExpandedFieldId, previewRef, closeModuleLibrary } = state;
  const { totalFields, allFields } = derived;
  function replaceDefinition(next: RegistrationFormDefinition) {
    setDefinition(pruneRequireAtLeastOne(next)); setDirty(true); setNotice(""); setError(""); setTestIssues([]);
  }

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

  function moveField(sectionIndex: number, fieldIndex: number, direction: -1 | 1) {
    if (!definition) return;
    const nextIndex = fieldIndex + direction;
    const section = definition.sections[sectionIndex];
    if (nextIndex < 0 || nextIndex >= section.fields.length) return;
    const fields = [...section.fields];
    [fields[fieldIndex], fields[nextIndex]] = [fields[nextIndex], fields[fieldIndex]];
    updateSection(sectionIndex, { fields });
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
    const { sectionIndex: sourceSectionIndex, fieldIndex: sourceFieldIndex } = dragging;
    if (sourceSectionIndex !== targetSectionIndex && definition.sections[sourceSectionIndex].fields.length === 1) {
      setDragging(null);
      setError("Each section must keep at least one field. Add another field before moving this one.");
      return;
    }
    const sections = structuredClone(definition.sections);
    const [field] = sections[sourceSectionIndex].fields.splice(sourceFieldIndex, 1);
    sections[targetSectionIndex].fields.splice(targetFieldIndex, 0, field);
    setDragging(null);
    replaceDefinition({ ...definition, sections });
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

  function addModule(sectionIndex: number, module: BuilderModuleDefinition) {
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
    const sections = definition.sections.map((candidate, index) => index === sectionIndex
      ? { ...candidate, fields: [...section.fields, ...fields] }
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
  return { replaceDefinition, updateSection, updateField, updateNumberBounds, moveField, moveSection, dropSection, dropField, showPreview, removeField, duplicateField, addModule, addSection, removeSection, setReviewSection };
}

export type BuilderEdits = ReturnType<typeof useBuilderEdits>;
