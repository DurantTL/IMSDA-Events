/**
 * Browser-only backup of a staff editor's unsaved edits (#1263), so a failed save during a restart
 * (or an accidental reload) does not cost the work. The value is the editor's own definition
 * (form fields, settings, template text): never attendee data. Every storage call is wrapped, a
 * backup is tied to the version the edits started from, and it expires after 14 days.
 */
export const LOCAL_EDIT_DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const LOCAL_EDIT_DRAFT_RESTORED_NOTICE = "We restored your unsaved changes from earlier.";

const KEY_PREFIX = "imsda-events:edit-draft:v1";

export type EditDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function editDraftKey(scope: string, id: string) {
  return `${KEY_PREFIX}:${encodeURIComponent(scope)}:${encodeURIComponent(id)}`;
}

export function getBrowserEditDraftStorage(): EditDraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function saveEditDraft(storage: EditDraftStorage | null, key: string, version: string, value: unknown, now: Date = new Date()) {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify({ format: 1, version, savedAt: now.getTime(), value }));
  } catch {
    // Storage blocked or full: the editor works without a backup.
  }
}

export function clearEditDraft(storage: EditDraftStorage | null, key: string) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

/** The saved value, or null when there is none, it is for another version, expired or damaged. */
export function loadEditDraft(storage: EditDraftStorage | null, key: string, version: string, now: Date = new Date()): unknown | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { format?: unknown; version?: unknown; savedAt?: unknown; value?: unknown } | null;
    const fresh = parsed && parsed.format === 1 && parsed.version === version && typeof parsed.savedAt === "number"
      && parsed.savedAt <= now.getTime() + 60_000 && now.getTime() - parsed.savedAt < LOCAL_EDIT_DRAFT_TTL_MS;
    if (!fresh || parsed.value === undefined || parsed.value === null) {
      storage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}
