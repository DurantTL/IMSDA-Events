/**
 * The registration draft's save queue (#643). One save runs at a time;
 * `flush()` waits for every save in flight (including one started while it
 * waited) and resolves true only when nothing is left unsaved. A failed save
 * stays pending so a retry resends it, except after `submitted()`, which drops
 * the draft for good so a late failure can't bring a stale draft back.
 */
export function createDraftSaveQueue<T>({
  send,
  onState,
}: {
  send: (draft: T) => Promise<boolean>;
  onState?: (state: "saving" | "saved" | "error") => void;
}) {
  let pending: T | null = null;
  let inFlight: Promise<boolean> | null = null;
  let generation = 0;

  /**
   * `followUp` (default true, for explicit flushes such as leaving the page):
   * after a save succeeds, send any newer edit queued meanwhile too. The
   * debounce timer passes false; a newer edit has its own timer.
   */
  async function flush(followUp = true): Promise<boolean> {
    while (inFlight) await inFlight;
    const next = pending;
    if (next === null) return true;
    pending = null;
    const started = generation;
    onState?.("saving");
    const attempt = (async () => {
      let ok = false;
      try { ok = await send(next); } catch { ok = false; }
      if (started !== generation) return true;
      // A newer edit queued during a failed save wins over the failed one.
      if (!ok) pending ??= next;
      onState?.(ok ? "saved" : "error");
      return ok;
    })();
    inFlight = attempt;
    let ok = false;
    try {
      ok = await attempt;
    } finally {
      if (inFlight === attempt) inFlight = null;
    }
    if (!ok) return false;
    return followUp && pending !== null ? flush(true) : true;
  }

  return {
    set(draft: T) { pending = draft; },
    hasPending: () => pending !== null,
    flush,
    submitted() { generation += 1; pending = null; },
  };
}

/**
 * Whether leaving the registration page now would lose answers (#1468): a change is waiting in
 * the queue (which covers the debounce timer, set together with it), a save is in flight, the
 * last save failed, or the draft is in conflict so its changes were refused. A registration that
 * was just submitted has no draft left to lose.
 */
export function registrationDraftUnsaved(state: {
  hasPending: boolean;
  saveState: "idle" | "saving" | "saved" | "error";
  conflict: boolean;
  submitted: boolean;
}): boolean {
  // A submit empties the queue, so a change pending now was made after it and is always new work.
  if (state.hasPending) return true;
  if (state.submitted) return false;
  return state.saveState === "saving" || state.saveState === "error" || state.conflict;
}
