/**
 * True when any field of an uncontrolled form no longer holds the value it started with (its default): typed text, a changed
 * pick, or a ticked box. Checked against the defaults rather than "anything is filled in", so a pre-filled form is clean.
 * Feeds `useUnsavedChangesGuard` for forms that read their values on submit (#1468).
 */
export function formHasEdits(form: HTMLFormElement): boolean {
  return Array.from(form.elements).some((element) => {
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
