"use client";

import { useCallback, useRef, useState } from "react";
import type { FormEvent } from "react";
import { formHasEdits, type FormEditOptions } from "@/components/form-has-edits";

/**
 * Which of several uncontrolled forms on one component hold typed work, keyed by a name the caller picks per form (#1468).
 * `track(key)` is the form's `onChange`: it records whether any field is off its starting value, so changing a field
 * back clears it. `clear(...keys)` is for a successful save, a cancel, or a form that is closing. `gone(key)` is a
 * stable `ref` for forms that come and go with the data (a row that disappears after a save, or a closed panel): it
 * clears the key when the form leaves the page, so no unseen form keeps the page marked as unsaved. `mark(key, value)` records a field the form cannot see (a controlled one the caller compares itself). `dirty` feeds
 * `useUnsavedChangesGuard`.
 */
export function useEditedForms() {
  const [edited, setEdited] = useState<Readonly<Record<string, true>>>({});
  const set = useCallback((key: string, value: boolean) => {
    setEdited((current) => {
      if (Boolean(current[key]) === value) return current;
      if (value) return { ...current, [key]: true };
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);
  const track = useCallback((key: string, options?: FormEditOptions) => (event: FormEvent<HTMLFormElement>) => set(key, formHasEdits(event.currentTarget, options)), [set]);
  const clear = useCallback((...keys: string[]) => { for (const key of keys) set(key, false); }, [set]);
  const refs = useRef(new Map<string, (element: HTMLFormElement | null) => void>());
  // `also` names extra keys cleared with it (a controlled field the caller marks itself, such as a phone number).
  const gone = useCallback((key: string, ...also: string[]) => {
    const id = [key, ...also].join("\u0000");
    let callback = refs.current.get(id);
    if (!callback) {
      callback = (element) => { if (!element) for (const each of [key, ...also]) set(each, false); };
      refs.current.set(id, callback);
    }
    return callback;
  }, [set]);
  return { gone, dirty: Object.keys(edited).length > 0, track, clear, mark: set };
}
