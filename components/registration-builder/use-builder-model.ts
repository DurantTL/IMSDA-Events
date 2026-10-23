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
  return { mealPlanPrices, eventId, eventSlug, eventName, eventAudience, eventBillingMode, canEditNotifications, canSaveAsTemplate, ...state, ...derived, ...edits, ...removal, ...actions };
}

export type BuilderModel = ReturnType<typeof useBuilderModel>;
