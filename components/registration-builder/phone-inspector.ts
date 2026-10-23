// The phone inspector (#1139): at phone width, selecting a question opens Question
// settings full screen with Back and Done. Closing it only hides it. It never
// saves, never discards and never touches the edits, so "Unsaved changes" stays.
// Pure, so the rules are testable without a browser.

/** Selecting a different question opens the inspector; clearing the selection or re-rendering the same one leaves it as it is. */
export function inspectorAfterSelection(open: boolean, previousFieldId: string | null, nextFieldId: string | null): boolean {
  return nextFieldId && nextFieldId !== previousFieldId ? true : open;
}

/** Back and Done both close the inspector; neither does anything else. */
export function inspectorAfterClose(): false {
  return false;
}
