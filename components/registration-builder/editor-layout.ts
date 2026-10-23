// The editor's movable sidebar (#1132): where it sits, how wide it is, and
// whether it is shown. Pure functions plus a storage wrapper, so the rules are
// testable without a browser. The layout is remembered per browser; every
// storage access is wrapped in try/catch because storage can be missing or
// throw (private windows, blocked site data, previews).

export type SidebarSide = "left" | "right";
export type EditorLayout = { sidebarVisible: boolean; side: SidebarSide; width: number };

export const DEFAULT_EDITOR_LAYOUT: EditorLayout = { sidebarVisible: true, side: "right", width: 380 };
export const MIN_SIDEBAR_WIDTH = 300;
export const MAX_SIDEBAR_WIDTH = 600;
/** One press of an arrow key, or of the narrower / wider buttons. */
export const SIDEBAR_WIDTH_STEP = 40;
export const EDITOR_LAYOUT_STORAGE_KEY = "imsda.registrationBuilder.editorLayout.v1";

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_EDITOR_LAYOUT.width;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

export function resizeSidebar(layout: EditorLayout, delta: number): EditorLayout {
  return { ...layout, width: clampSidebarWidth(layout.width + delta) };
}

/** The width a drag to `pointerX` gives, for a sidebar whose container spans `containerLeft`..`containerRight`. */
export function widthFromPointer(side: SidebarSide, pointerX: number, containerLeft: number, containerRight: number): number {
  return clampSidebarWidth(side === "right" ? containerRight - pointerX : pointerX - containerLeft);
}

/** Reads a stored layout; anything missing, malformed or out of range falls back to the default for that part. */
export function parseEditorLayout(raw: string | null | undefined): EditorLayout {
  if (!raw) return { ...DEFAULT_EDITOR_LAYOUT };
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof EditorLayout, unknown>> | null;
    if (!value || typeof value !== "object") return { ...DEFAULT_EDITOR_LAYOUT };
    return {
      sidebarVisible: typeof value.sidebarVisible === "boolean" ? value.sidebarVisible : DEFAULT_EDITOR_LAYOUT.sidebarVisible,
      side: value.side === "left" || value.side === "right" ? value.side : DEFAULT_EDITOR_LAYOUT.side,
      width: typeof value.width === "number" ? clampSidebarWidth(value.width) : DEFAULT_EDITOR_LAYOUT.width,
    };
  } catch {
    return { ...DEFAULT_EDITOR_LAYOUT };
  }
}

export type LayoutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The browser's localStorage, or null when it is missing or refuses access (reading the property can itself throw). */
export function browserLayoutStorage(): LayoutStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readEditorLayout(storage: LayoutStorage | null = browserLayoutStorage()): EditorLayout {
  if (!storage) return { ...DEFAULT_EDITOR_LAYOUT };
  try {
    return parseEditorLayout(storage.getItem(EDITOR_LAYOUT_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_EDITOR_LAYOUT };
  }
}

/** Returns false when the layout could not be remembered; the editor keeps working with the layout in memory. */
export function writeEditorLayout(layout: EditorLayout, storage: LayoutStorage | null = browserLayoutStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(EDITOR_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

export type EditorLayoutStore = {
  getSnapshot: () => EditorLayout;
  subscribe: (listener: () => void) => () => void;
  /** Remembers `next` in memory and, when storage allows, in the browser. */
  set: (next: EditorLayout) => void;
  /** Back to the default layout, and forget what was stored. */
  reset: () => void;
};

/**
 * The layout as an external store for React. It reads storage once, on first use; after that the layout
 * lives in memory and every change is also written, so the editor keeps working when storage is unavailable.
 */
export function createEditorLayoutStore(getStorage: () => LayoutStorage | null = browserLayoutStorage): EditorLayoutStore {
  let current: EditorLayout | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    getSnapshot() {
      if (!current) current = readEditorLayout(getStorage());
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next) {
      current = next;
      writeEditorLayout(next, getStorage());
      notify();
    },
    reset() {
      current = { ...DEFAULT_EDITOR_LAYOUT };
      clearEditorLayout(getStorage());
      notify();
    },
  };
}

export function clearEditorLayout(storage: LayoutStorage | null = browserLayoutStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(EDITOR_LAYOUT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
