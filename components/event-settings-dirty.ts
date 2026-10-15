"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the event settings form beside the calendar banner has unsaved changes (#445). Answering the banner reloads
 * the form, which would throw those changes away, so the banner waits until they are saved or discarded.
 */
let dirty = false;
const listeners = new Set<() => void>();

export function setEventSettingsDirty(next: boolean) {
  if (dirty === next) return;
  dirty = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useEventSettingsDirty() {
  return useSyncExternalStore(subscribe, () => dirty, () => false);
}
