import { validatePhone } from "@/lib/field-validation";

/**
 * True when any field of an uncontrolled form no longer holds the value it started with (its default): typed text, a changed
 * pick, or a ticked box. Checked against the defaults rather than "anything is filled in", so a pre-filled form is clean.
 * Feeds `useUnsavedChangesGuard` for forms that read their values on submit (#1468).
 */
export type FormEditOptions = {
  /** Names of controlled fields the caller compares itself. */
  ignore?: readonly string[];
  /** A selector for a part of the form the caller compares itself (a controlled group of unnamed fields). */
  ignoreWithin?: string;
};

export function formHasEdits(form: HTMLFormElement, options: FormEditOptions = {}): boolean {
  return Array.from(form.elements).some((element) => {
    if (options.ignoreWithin && element.closest(options.ignoreWithin)) return false;
    // Controlled fields the caller tracks itself (React keeps their default in step with what is typed) are skipped by name.
    if (options.ignore && "name" in element && options.ignore.includes(String(element.name))) return false;
    if (element instanceof HTMLInputElement) {
      if (element.type === "hidden" || element.type === "submit" || element.type === "button") return false;
      return element.type === "checkbox" || element.type === "radio" ? element.checked !== element.defaultChecked : element.value !== element.defaultValue;
    }
    if (element instanceof HTMLTextAreaElement) return element.value !== element.defaultValue;
    if (element instanceof HTMLSelectElement) {
      const options = Array.from(element.options);
      // A single select with no option marked as default starts on its first option, as the browser picks it.
      const implicitFirst = !element.multiple && !options.some((option) => option.defaultSelected);
      return options.some((option, index) => option.selected !== (option.defaultSelected || (implicitFirst && index === 0)));
    }
    return false;
  });
}

/**
 * True when two phone numbers are the same number: a valid one is tidied on leaving the field ("5155550134" becomes
 * "(515) 555-0134"), which is not a change the person made (#1468).
 */
export function samePhoneNumber(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const first = validatePhone(a);
  const second = validatePhone(b);
  return first.ok && second.ok && first.value === second.value;
}
