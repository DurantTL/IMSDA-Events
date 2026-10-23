// React side of the movable sidebar (#1132): the layout, remembered per
// browser, and the viewport check that keeps phones on today's builder.
import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_EDITOR_LAYOUT, SIDEBAR_WIDTH_STEP, clampSidebarWidth, createEditorLayoutStore, resizeSidebar, revealSidebar,
} from "./editor-layout";

/** The editor shell is for tablets and desktops; below this the builder keeps its phone layout (#685, #1071). */
export const EDITOR_SHELL_MEDIA_QUERY = "(min-width: 768px)";

function subscribeToViewport(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(EDITOR_SHELL_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True on the server: the page renders the shell first, so a desktop never flashes the phone layout. A phone never shows it (the builder is hidden under 768px, #685) and switches once the browser reports its width. */
export function useEditorShellViewport(): boolean {
  return useSyncExternalStore(
    subscribeToViewport,
    () => typeof window.matchMedia === "function" && window.matchMedia(EDITOR_SHELL_MEDIA_QUERY).matches,
    () => true,
  );
}

const layoutStore = createEditorLayoutStore();

export function useEditorLayout() {
  const layout = useSyncExternalStore(layoutStore.subscribe, layoutStore.getSnapshot, () => DEFAULT_EDITOR_LAYOUT);
  return {
    layout,
    toggleSidebar: useCallback(() => layoutStore.set({ ...layoutStore.getSnapshot(), sidebarVisible: !layoutStore.getSnapshot().sidebarVisible }), []),
    showSidebar: useCallback(() => { const current = layoutStore.getSnapshot(); const next = revealSidebar(current); if (next !== current) layoutStore.set(next); }, []),
    swapSide: useCallback(() => { const current = layoutStore.getSnapshot(); layoutStore.set({ ...current, side: current.side === "right" ? "left" : "right" }); }, []),
    setWidth: useCallback((width: number, persist = true) => layoutStore.set({ ...layoutStore.getSnapshot(), width: clampSidebarWidth(width) }, persist), []),
    narrower: useCallback(() => layoutStore.set(resizeSidebar(layoutStore.getSnapshot(), -SIDEBAR_WIDTH_STEP)), []),
    wider: useCallback(() => layoutStore.set(resizeSidebar(layoutStore.getSnapshot(), SIDEBAR_WIDTH_STEP)), []),
    resetLayout: useCallback(() => layoutStore.reset(), []),
  };
}

export type EditorLayoutControls = ReturnType<typeof useEditorLayout>;
