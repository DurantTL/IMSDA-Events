// "Remove field" and "Remove section" review dialogs (#471): the target being
// removed and the best-effort count of already-submitted answers.
import { useRef, useState } from "react";
import type { RegistrationFormDefinition, RegistrationFormField } from "@/modules/forms/definition";
import { batchFieldKeys } from "@/modules/forms/field-answer-counts";
import type { BuilderState } from "./use-builder-state";
import type { BuilderEdits } from "./use-builder-edits";

export function useBuilderRemoval(state: BuilderState, edits: BuilderEdits) {
  const { selectedForm, definition, setError } = state;
  const { removeField, removeSection } = edits;
  const [removeFieldTarget, setRemoveFieldTarget] = useState<{ sectionIndex: number; fieldIndex: number; field: RegistrationFormField } | null>(null);
  const [removeSectionTarget, setRemoveSectionTarget] = useState<{ sectionIndex: number; section: RegistrationFormDefinition["sections"][number] } | null>(null);
  const [removalAnswerCounts, setRemovalAnswerCounts] = useState<Record<string, number> | null>(null);
  const [removalAnswerCountsLoading, setRemovalAnswerCountsLoading] = useState(false);
  // Each count lookup gets an id; a response for anything but the latest
  // lookup (the dialog was closed or reopened for another field) is ignored.
  const removalAnswerRequestId = useRef(0);

  function resetRemovalAnswerCounts() {
    removalAnswerRequestId.current += 1;
    setRemovalAnswerCounts(null);
    setRemovalAnswerCountsLoading(false);
  }

  /**
   * Best-effort real counts for the removal dialog (#471), in batches the
   * route accepts. Any failure (HTTP error, network error, bad body) leaves
   * the counts null, which the dialog words neutrally rather than as "no
   * answers"; a stale response never overwrites a newer lookup.
   */
  async function loadRemovalAnswerCounts(fieldKeys: string[]) {
    const requestId = removalAnswerRequestId.current + 1;
    removalAnswerRequestId.current = requestId;
    setRemovalAnswerCounts(null);
    if (!selectedForm) { setRemovalAnswerCountsLoading(false); return; }
    // An information form's answers are counted by its own responses page, not by the registration lookup: leave the counts unknown, which the dialog words neutrally (#1149).
    if (state.information) { setRemovalAnswerCountsLoading(false); return; }
    // A form template (#1064) belongs to no event, so it holds no submitted answers.
    if (!selectedForm.eventId) { setRemovalAnswerCounts(Object.fromEntries(fieldKeys.map((key) => [key, 0]))); setRemovalAnswerCountsLoading(false); return; }
    setRemovalAnswerCountsLoading(true);
    let merged: Record<string, number> | null = {};
    try {
      for (const batch of batchFieldKeys(fieldKeys)) {
        const response = await fetch(
          `/api/events/${selectedForm.eventId}/forms/${selectedForm.id}/field-answer-counts`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fieldKeys: batch }),
          },
        );
        const result = await response.json().catch(() => ({})) as { counts?: Record<string, number> };
        if (!response.ok || !result.counts) { merged = null; break; }
        merged = { ...merged, ...result.counts };
      }
    } catch {
      merged = null;
    }
    if (removalAnswerRequestId.current !== requestId) return;
    setRemovalAnswerCounts(merged);
    setRemovalAnswerCountsLoading(false);
  }

  function openRemoveField(sectionIndex: number, fieldIndex: number) {
    if (!definition) return;
    const section = definition.sections[sectionIndex];
    if (section.fields.length === 1) { setError("Each section must keep at least one field."); return; }
    const field = section.fields[fieldIndex];
    setRemoveFieldTarget({ sectionIndex, fieldIndex, field });
    void loadRemovalAnswerCounts([field.key]);
  }

  function confirmRemoveField() {
    if (!removeFieldTarget) return;
    removeField(removeFieldTarget.sectionIndex, removeFieldTarget.fieldIndex);
    setRemoveFieldTarget(null);
    resetRemovalAnswerCounts();
  }

  function openRemoveSection(sectionIndex: number) {
    if (!definition) return;
    if (definition.sections.length === 1) { setError("A form must keep at least one section."); return; }
    const section = definition.sections[sectionIndex];
    setRemoveSectionTarget({ sectionIndex, section });
    void loadRemovalAnswerCounts(section.fields.map((field) => field.key));
  }

  function confirmRemoveSection() {
    if (!removeSectionTarget) return;
    removeSection(removeSectionTarget.sectionIndex);
    setRemoveSectionTarget(null);
    resetRemovalAnswerCounts();
  }
  return { removeFieldTarget, setRemoveFieldTarget, removeSectionTarget, setRemoveSectionTarget, removalAnswerCounts, removalAnswerCountsLoading, resetRemovalAnswerCounts, openRemoveField, confirmRemoveField, openRemoveSection, confirmRemoveSection };
}
