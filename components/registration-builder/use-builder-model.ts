import { useLocalEditDraft } from "@/components/use-local-edit-draft";
import { editDraftKey } from "@/lib/local-edit-draft";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { clearHistory } from "./edit-history";
import type { useConfirm } from "@/components/use-confirm";
import type { BuilderWorkspaceProps } from "./builder-types";
import { useBuilderActions } from "./use-builder-actions";
import { useBuilderDerived } from "./use-builder-derived";
import { useBuilderEdits } from "./use-builder-edits";
import { useBuilderRemoval } from "./use-builder-removal";
import { useBuilderState } from "./use-builder-state";

// One object that carries the whole editor: the event props, the draft state,
// the values derived from it, and every edit and action. The root workspace
// builds it once and shares it through BuilderContext, so each zone of the
// editor can be moved or wrapped without threading props.
export function useBuilderModel(props: BuilderWorkspaceProps, askConfirm: ReturnType<typeof useConfirm>["confirm"]) {
  const { eventId, eventSlug, eventName, eventAudience, eventBillingMode, canEditNotifications = false, canSaveAsTemplate = false, mealPlanPrices = {} } = props;
  const state = useBuilderState(props);
  // An information form has no event policies to point an acknowledgment at (#1149).
  const derived = useBuilderDerived(props.information ? null : eventId, state);
  const edits = useBuilderEdits(state, derived);
  const removal = useBuilderRemoval(state, edits);
  const actions = useBuilderActions(props, state, derived, askConfirm);
  // Unsaved edits to the open form are backed up in this browser and come back after a reload (#1263).
  // The definition holds questions and prices only, never attendee answers.
  const { setDefinition, setHistory, setDirty } = state;
  const editBackup = useLocalEditDraft({
    storageKey: editDraftKey("registration-builder", `${eventId}:${state.selectedFormId ?? ""}`),
    version: state.selectedVersion?.updatedAt ?? "",
    value: state.definition,
    dirty: state.dirty && state.definition !== null,
    onRestore: (stored) => {
      const parsed = registrationFormDefinitionSchema.safeParse(stored);
      if (!parsed.success) return;
      setDefinition(parsed.data);
      setHistory(clearHistory(parsed.data));
      setDirty(true);
    },
  });
  return { mealPlanPrices, eventId, eventSlug, eventName, eventAudience, eventBillingMode, canEditNotifications, canSaveAsTemplate, ...state, ...derived, ...edits, ...removal, ...actions, editBackup };
}

export type BuilderModel = ReturnType<typeof useBuilderModel>;
