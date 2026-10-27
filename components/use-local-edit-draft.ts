"use client";

import { useEffect, useRef, useState } from "react";
import {
  clearEditDraft,
  getBrowserEditDraftStorage,
  loadEditDraft,
  saveEditDraft,
} from "@/lib/local-edit-draft";

/**
 * Backs up a staff editor's unsaved value in this browser and offers it back after a reload (#1263).
 * `dirty` is "differs from what is saved"; a saved editor clears its backup. `onRestore` receives the
 * stored value, which the caller must validate before use.
 */
export function useLocalEditDraft<T>({
  storageKey, version, value, dirty, onRestore,
}: {
  storageKey: string;
  version: string;
  value: T;
  dirty: boolean;
  onRestore: (stored: unknown) => void;
}) {
  const [restored, setRestored] = useState(false);
  const [ready, setReady] = useState(false);
  const restoreRef = useRef(onRestore);
  useEffect(() => { restoreRef.current = onRestore; });

  useEffect(() => {
    // Deferred a tick so the restore is an external-storage sync, not a synchronous state cascade in the effect.
    const timer = window.setTimeout(() => {
      const stored = loadEditDraft(getBrowserEditDraftStorage(), storageKey, version);
      if (stored !== null) {
        restoreRef.current(stored);
        setRestored(true);
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey, version]);

  useEffect(() => {
    if (!ready) return;
    if (!dirty) {
      // Nothing unsaved, but a just-restored copy must survive until the editor has re-rendered dirty.
      if (!restored) clearEditDraft(getBrowserEditDraftStorage(), storageKey);
      return;
    }
    const timer = window.setTimeout(() => saveEditDraft(getBrowserEditDraftStorage(), storageKey, version, value), 600);
    return () => window.clearTimeout(timer);
  }, [ready, dirty, value, storageKey, version, restored]);

  return {
    restored,
    dismiss: () => setRestored(false),
    discard: () => { clearEditDraft(getBrowserEditDraftStorage(), storageKey); setRestored(false); },
  };
}
