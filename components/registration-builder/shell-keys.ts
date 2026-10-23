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

/**
 * What the "arrived from a setup warning" focus does on this render. It waits until the page has hydrated, so it
 * sees the layout stored in this browser rather than the default the server rendered (a saved hidden sidebar would
 * otherwise be unmounted right after the effect had used it); then it shows a hidden sidebar; then it focuses.
 */
export function focusTargetAction(state: { handled: boolean; hydrated: boolean; selected: boolean; settingsOpen: boolean; sidebarVisible: boolean }): "skip" | "reveal" | "focus" {
  if (state.handled || !state.hydrated || !state.selected || !state.settingsOpen) return "skip";
  return state.sidebarVisible ? "focus" : "reveal";
}

export type UndoKeyEvent = SlashKeyEvent & {
  shiftKey: boolean;
  /** Focus is in the editor or canvas, or on nothing; not in another panel such as Notifications. */
  inEditorScope: boolean;
};

/**
 * Ctrl or Cmd+Z undoes, Shift+Ctrl or Cmd+Z and Ctrl+Y redo (#1134). Never while typing (the field has its own undo),
 * after another handler took the key, or under a dialog.
 */
export function undoRedoShortcut(event: UndoKeyEvent): "undo" | "redo" | null {
  if (event.defaultPrevented || event.fromTypingTarget || event.dialogOpen || event.altKey || !event.inEditorScope) return null;
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey) return "redo";
  return null;
}

/** "/" jumps to the question search, except while typing, with a modifier, after another handler took it, or under a dialog. */
export function isSearchShortcut(event: SlashKeyEvent): boolean {
  return event.key === "/"
    && !event.metaKey && !event.ctrlKey && !event.altKey
    && !event.defaultPrevented
    && !event.fromTypingTarget
    && !event.dialogOpen;
}
