/**
 * The shared shape of a "setup checklist" (#743 for events, #1435 for club directors and area coordinators). One
 * presentational component (`components/setup-checklist-panel.tsx`) draws any of them; each role builds its own
 * steps from data it already reads. No step is stored: "done" is always derived, and a step the app cannot derive is a
 * `reference` row (a Help guide link, never a checkmark).
 */
export type ChecklistStep = {
  id: string;
  label: string;
  /** Plain words for what "done" means, shown under the label. */
  detail: string;
  done: boolean;
  /** The page that does the work. Ignored when the step is not linkable. */
  href: string;
  /** Opens in a new tab: the event's public page. */
  external?: boolean;
  /** False when the viewer cannot open the destination yet: the step shows `unavailableNote` (who to ask) instead. */
  linkable: boolean;
  /** Said instead of the link while it is not linkable. For a role that cannot do the step this names who to ask. */
  unavailableNote?: string;
  actionLabel: string;
  /** Not derivable from existing data: shown as a guide row, not counted, never given a checkmark. */
  reference?: boolean;
  /** A Help guide link shown beside the action (`/account/help/<id>`). */
  helpHref?: string;
  helpLabel?: string;
};

export type Checklist = {
  steps: ChecklistStep[];
  /** Tracked (derived) steps that are done. */
  doneCount: number;
  /** Tracked steps: the denominator of "N of M done". */
  trackedCount: number;
  nextStepId: string | null;
  /** Nothing tracked is left, or there is nothing to show. */
  hidden: boolean;
};

/** Builds the progress numbers from steps in display order. Reference rows are listed but never counted. */
export function summarizeChecklist(steps: ChecklistStep[]): Checklist {
  const tracked = steps.filter((step) => !step.reference);
  const doneCount = tracked.filter((step) => step.done).length;
  const next = tracked.find((step) => !step.done);
  return {
    steps,
    doneCount,
    trackedCount: tracked.length,
    nextStepId: next?.id ?? null,
    hidden: steps.length === 0 || (tracked.length > 0 && doneCount === tracked.length) || tracked.length === 0,
  };
}
