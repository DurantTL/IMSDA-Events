// Keyboard rules for the editor shell (#1132), kept free of the DOM so they can be tested.

export type SlashKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  /** The event came from a text input, textarea, select or editable element. */
  fromTypingTarget: boolean;
  /** A dialog (the confirmation, the publish review, ...) is open. */
  dialogOpen: boolean;
};

/** "/" jumps to the question search, except while typing, with a modifier, after another handler took it, or under a dialog. */
export function isSearchShortcut(event: SlashKeyEvent): boolean {
  return event.key === "/"
    && !event.metaKey && !event.ctrlKey && !event.altKey
    && !event.defaultPrevented
    && !event.fromTypingTarget
    && !event.dialogOpen;
}
