import type { SidebarSection } from "@/components/staff-navigation";

/**
 * Per-browser open/closed choice for the collapsible sidebar groups (#964),
 * `{ setup: true, reports: false }`. Nothing saved means closed. Storage can be
 * missing or throw (private windows, blocked site data); the sidebar then still
 * renders, with each group closed unless the current page is inside it.
 */
export const sidebarGroupsStorageKey = "imsda-staff-sidebar-groups";

export type SidebarGroupChoices = Readonly<Partial<Record<SidebarSection, boolean>>>;

const noChoices: SidebarGroupChoices = Object.freeze({});

function parseChoices(raw: string | null): SidebarGroupChoices {
  if (!raw) return noChoices;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return noChoices;
    const choices: Partial<Record<SidebarSection, boolean>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") choices[key as SidebarSection] = value;
    }
    return choices;
  } catch {
    return noChoices;
  }
}

/** Reads the saved choices. A missing, broken or blocked store reads as nothing saved. */
export function readSidebarGroups(storage?: Pick<Storage, "getItem">): SidebarGroupChoices {
  try {
    const target = storage ?? window.localStorage;
    return parseChoices(target.getItem(sidebarGroupsStorageKey));
  } catch {
    return noChoices;
  }
}

/** Saves the choices. A failure is ignored: the choice still applies until the page is closed. */
export function writeSidebarGroups(choices: SidebarGroupChoices, storage?: Pick<Storage, "setItem">): void {
  try {
    const target = storage ?? window.localStorage;
    target.setItem(sidebarGroupsStorageKey, JSON.stringify(choices));
  } catch {
    // Private windows or blocked site data: nothing to remember.
  }
}

/**
 * Whether a group is open. A group opens by itself when the current page is
 * inside it, unless the viewer just closed it on this very page (`dismissed`);
 * otherwise the saved choice decides, closed by default.
 */
export function resolveSidebarGroupOpen({
  saved,
  containsCurrentPage,
  dismissedOnThisPage,
}: {
  saved: boolean | undefined;
  containsCurrentPage: boolean;
  dismissedOnThisPage: boolean;
}): boolean {
  if (dismissedOnThisPage) return false;
  return containsCurrentPage || saved === true;
}

/**
 * A group the viewer closed stays closed only on the page they closed it on:
 * any navigation forgets it, so coming back to a page inside the group opens it
 * again.
 */
export function dismissalAfterNavigation<T>(dismissed: T | null, previousPathname: string, pathname: string): T | null {
  return previousPathname === pathname ? dismissed : null;
}

// A small external store so the saved choices are read after hydration (the
// server always renders with nothing saved) and still work without storage.
let choices: SidebarGroupChoices | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeSidebarGroups(listener: () => void) {
  listeners.add(listener);
  // Another tab changed the choices: drop the cached value and re-read storage.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== sidebarGroupsStorageKey) return;
    choices = null;
    notify();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Stable between changes, as `useSyncExternalStore` requires. */
export function getSidebarGroupsSnapshot(): SidebarGroupChoices {
  if (choices === null) choices = readSidebarGroups();
  return choices;
}

export function getSidebarGroupsServerSnapshot(): SidebarGroupChoices {
  return noChoices;
}

export function setSidebarGroupOpen(section: SidebarSection, open: boolean): void {
  choices = { ...getSidebarGroupsSnapshot(), [section]: open };
  writeSidebarGroups(choices);
  notify();
}

/** Test seam: forget the cached choices so the next read goes to storage. */
export function resetSidebarGroupsCache(): void {
  choices = null;
}
