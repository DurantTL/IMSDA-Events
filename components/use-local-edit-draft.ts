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
 * `dirty` is "differs from what is saved"; a saved or reverted editor clears its backup.
 * `onRestore` receives the stored value, must validate it, and returns whether it applied it; a value it
 * refuses is removed and no notice is shown.
 *
 * Everything is tracked per backup (storage key plus version). When the editor switches to another
 * backup, nothing is saved or cleared for it until its own restore has run, so a clean editor that has
 * just switched can never wipe the backup it is about to restore.
 */
export function useLocalEditDraft<T>({
  storageKey, version, value, dirty, onRestore,
}: {
  storageKey: string;
  version: string;
  value: T;
  dirty: boolean;
  onRestore: (stored: unknown) => boolean;
}) {
  const id = `${storageKey}|${version}`;
  // The backup whose restore attempt has finished, and the one that actually restored something.
  const [doneId, setDoneId] = useState<string | null>(null);
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const dirtySeenIdRef = useRef<string | null>(null);
  const restoreRef = useRef(onRestore);
  useEffect(() => { restoreRef.current = onRestore; });

  useEffect(() => {
    // Deferred a tick so the restore is an external-storage sync, not a synchronous state cascade in the effect.
    const timer = window.setTimeout(() => {
      const storage = getBrowserEditDraftStorage();
      const stored = loadEditDraft(storage, storageKey, version);
      if (stored !== null) {
        if (restoreRef.current(stored)) setRestoredId(id);
        else clearEditDraft(storage, storageKey);
      }
      setDoneId(id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [id, storageKey, version]);

  const ready = doneId === id;
  const restored = restoredId === id;

  useEffect(() => {
    if (!ready) return;
    if (!dirty) {
      // Clean again (saved, or edited back): drop the backup. A just-restored copy survives only until the
      // editor has rendered dirty once, so a restore that has not been applied yet is not lost.
      if (!restored || dirtySeenIdRef.current === id) clearEditDraft(getBrowserEditDraftStorage(), storageKey);
      return;
    }
    dirtySeenIdRef.current = id;
    const timer = window.setTimeout(() => saveEditDraft(getBrowserEditDraftStorage(), storageKey, version, value), 600);
    return () => window.clearTimeout(timer);
  }, [ready, restored, dirty, value, id, storageKey, version]);

  return {
    restored,
    dismiss: () => setRestoredId(null),
    discard: () => { clearEditDraft(getBrowserEditDraftStorage(), storageKey); setRestoredId(null); },
  };
}
