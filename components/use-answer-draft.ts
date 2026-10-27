"use client";

import { useEffect, useRef, useState } from "react";
import {
  answerDraftKey,
  clearAnswerDraft,
  getBrowserDraftStorage,
  loadAnswerDraft,
  saveAnswerDraft,
  type AnswerDraftContent,
  type AnswerDraftIdentity,
} from "@/modules/forms/answer-draft";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";

/**
 * Keeps a flat-answer form's unfinished answers in this browser (#1263) and brings them back after a
 * reload. `enabled` is false for any page that starts from saved or prefilled answers. Nothing is
 * written until `dirty`, and `done` (a successful submit) clears it. See `modules/forms/answer-draft.ts`
 * for exactly what is never kept.
 */
export function useAnswerDraft({
  enabled, identity, definition, sealedKeys, answers, extras, dirty, done, onRestore,
}: {
  enabled: boolean;
  identity: AnswerDraftIdentity;
  definition: RegistrationFormDefinition;
  sealedKeys?: readonly string[];
  answers: Record<string, unknown>;
  extras?: Record<string, string>;
  dirty: boolean;
  done: boolean;
  onRestore: (draft: AnswerDraftContent) => void;
}) {
  const [notice, setNotice] = useState<"restored" | "version-changed" | null>(null);
  const [ready, setReady] = useState(false);
  const restoreRef = useRef(onRestore);
  useEffect(() => { restoreRef.current = onRestore; });
  const identityKey = answerDraftKey(identity);

  useEffect(() => {
    if (!enabled) return;
    // Deferred a tick so the restore is an external-storage sync, not a synchronous state cascade in the effect.
    const timer = window.setTimeout(() => {
      const loaded = loadAnswerDraft(getBrowserDraftStorage(), identity, definition, { sealedKeys });
      if (loaded.status === "restored") {
        restoreRef.current(loaded.draft);
        setNotice("restored");
      } else if (loaded.status === "version-changed") {
        setNotice("version-changed");
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
    // Restore runs once per form identity, on the client only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, identityKey]);

  const extrasKey = JSON.stringify(extras ?? {});
  useEffect(() => {
    if (!enabled || !ready || !dirty || done) return;
    const timer = window.setTimeout(() => {
      saveAnswerDraft(getBrowserDraftStorage(), identity, definition, { answers, extras }, { sealedKeys });
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready, dirty, done, answers, extrasKey, identityKey]);

  return {
    notice,
    dismissNotice: () => setNotice(null),
    /** Forget the saved copy: after a successful submit, or when the person discards it. */
    clear: () => clearAnswerDraft(getBrowserDraftStorage(), identity),
  };
}
