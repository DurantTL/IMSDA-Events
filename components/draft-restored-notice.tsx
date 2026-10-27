"use client";

import { ANSWER_DRAFT_RESTORED_NOTICE, ANSWER_DRAFT_VERSION_CHANGED_NOTICE } from "@/modules/forms/answer-draft";

/** Tells the visitor their unfinished answers came back (or could not, because the form changed) (#1263). */
export function DraftRestoredNotice({
  kind,
  onDiscard,
  onDismiss,
}: {
  kind: "restored" | "version-changed";
  onDiscard: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="form-notice draft-restored-notice" role="status">
      <span>{kind === "restored" ? ANSWER_DRAFT_RESTORED_NOTICE : ANSWER_DRAFT_VERSION_CHANGED_NOTICE}</span>
      <button type="button" className="secondary-button" onClick={kind === "restored" ? onDiscard : onDismiss}>
        {kind === "restored" ? "Discard" : "Dismiss"}
      </button>
    </div>
  );
}
