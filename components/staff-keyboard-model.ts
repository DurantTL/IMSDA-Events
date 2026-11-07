/**
 * Whether focus is in a control the on-screen keyboard opens for (#1566). Checkboxes, radios, buttons, file, color and range
 * inputs take no keyboard, so tapping them leaves the bottom bar where it is. Pure, so it is unit tested.
 */
const noKeyboardInputTypes = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit", "hidden"]);

export function opensKeyboard(element: { tagName?: string; type?: string; isContentEditable?: boolean; readOnly?: boolean; disabled?: boolean } | null | undefined): boolean {
  if (!element?.tagName) return false;
  if (element.disabled || element.readOnly) return false;
  const tag = element.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !noKeyboardInputTypes.has((element.type ?? "text").toLowerCase());
  return Boolean(element.isContentEditable);
}
