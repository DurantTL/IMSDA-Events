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

/** "/" jumps to the question search, except while typing, with a modifier, after another handler took it, or under a dialog. */
export function isSearchShortcut(event: SlashKeyEvent): boolean {
  return event.key === "/"
    && !event.metaKey && !event.ctrlKey && !event.altKey
    && !event.defaultPrevented
    && !event.fromTypingTarget
    && !event.dialogOpen;
}
