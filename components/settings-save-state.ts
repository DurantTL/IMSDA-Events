/**
 * The shared save-status vocabulary for the settings pages (#1076, #1258): Saved, Unsaved, Saving, Failed and Conflict.
 * Pure, so Platform settings and Event settings use the same words and the rules are tested without a browser.
 */
export type SettingsSaveOutcome = "saved" | "failed" | "conflict";
export type SettingsSaveState = "saving" | "conflict" | "failed" | "saved" | "unsaved" | "clean";

export const settingsSaveStateLabels: Record<SettingsSaveState, string> = {
  saving: "Saving…",
  conflict: "Not saved: changed by someone else",
  failed: "Not saved",
  saved: "Saved",
  unsaved: "Unsaved changes",
  clean: "",
};

/**
 * A request in flight wins; then a conflict or failure from the last save (the edits are still in the form); then Saved,
 * which only holds while nothing has been edited since; then Unsaved. `cleanLabel` is what an untouched form says.
 */
export function settingsSaveState(input: { saving: boolean; dirty: boolean; outcome: SettingsSaveOutcome | null; cleanLabel?: string }) {
  const state: SettingsSaveState = input.saving
    ? "saving"
    : input.outcome === "conflict"
      ? "conflict"
      : input.outcome === "failed"
        ? "failed"
        : input.outcome === "saved" && !input.dirty
          ? "saved"
          : input.dirty
            ? "unsaved"
            : "clean";
  return { state, label: state === "clean" ? input.cleanLabel ?? "" : settingsSaveStateLabels[state] };
}

export type SettingsSaveFailure = { kind: "conflict" | "permission" | "failed"; message: string };

/** What 401 and 403 mean mid-edit: the person's access changed after the page loaded. Nothing was saved; the edits stay. */
export const permissionRevokedMessages = {
  platform: "Your system administrator access changed, so nothing was saved. Your edits are still here; copy anything you need before you leave, then ask another system administrator.",
  event: "You no longer have permission to change this event's settings, so nothing was saved. Your edits are still here; copy anything you need before you leave, then ask an event administrator.",
} as const;

/**
 * Sorts a failed settings response. `conflictCodes` are the codes the route uses for a stale write (an Event save over dates
 * changed since the page opened answers 409 `EVENT_CHANGED`); other 409s, such as a taken web address, stay plain failures.
 */
export function classifySettingsSaveFailure(input: {
  scope: "platform" | "event";
  status: number;
  code?: unknown;
  message?: unknown;
  conflictCodes?: readonly string[];
  fallback: string;
}): SettingsSaveFailure {
  const message = typeof input.message === "string" && input.message ? input.message : input.fallback;
  if (input.status === 401 || input.status === 403) return { kind: "permission", message: permissionRevokedMessages[input.scope] };
  if (input.status === 409 && typeof input.code === "string" && input.conflictCodes?.includes(input.code)) {
    return { kind: "conflict", message: `${message} Your edits are still here.` };
  }
  return { kind: "failed", message };
}
