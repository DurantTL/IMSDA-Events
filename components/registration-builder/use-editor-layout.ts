// React side of the movable sidebar (#1132): the layout, remembered per
// browser, and the viewport check that keeps phones on today's builder.
import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_EDITOR_LAYOUT, SIDEBAR_WIDTH_STEP, clampSidebarWidth, createEditorLayoutStore, resizeSidebar,
} from "./editor-layout";

/** The editor shell is for tablets and desktops; below this the builder keeps its phone layout (#685, #1071). */
export const EDITOR_SHELL_MEDIA_QUERY = "(min-width: 768px)";

function subscribeToViewport(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(EDITOR_SHELL_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** False on the server and on phones, so the first paint is always today's builder. */
export function useEditorShellViewport(): boolean {
  return useSyncExternalStore(
    subscribeToViewport,
    () => typeof window.matchMedia === "function" && window.matchMedia(EDITOR_SHELL_MEDIA_QUERY).matches,
    () => false,
  );
}

const layoutStore = createEditorLayoutStore();

export function useEditorLayout() {
  const layout = useSyncExternalStore(layoutStore.subscribe, layoutStore.getSnapshot, () => DEFAULT_EDITOR_LAYOUT);
  return {
    layout,
    toggleSidebar: useCallback(() => layoutStore.set({ ...layoutStore.getSnapshot(), sidebarVisible: !layoutStore.getSnapshot().sidebarVisible }), []),
    showSidebar: useCallback(() => { const current = layoutStore.getSnapshot(); if (!current.sidebarVisible) layoutStore.set({ ...current, sidebarVisible: true }); }, []),
    swapSide: useCallback(() => { const current = layoutStore.getSnapshot(); layoutStore.set({ ...current, side: current.side === "right" ? "left" : "right" }); }, []),
    setWidth: useCallback((width: number) => layoutStore.set({ ...layoutStore.getSnapshot(), width: clampSidebarWidth(width) }), []),
    narrower: useCallback(() => layoutStore.set(resizeSidebar(layoutStore.getSnapshot(), -SIDEBAR_WIDTH_STEP)), []),
    wider: useCallback(() => layoutStore.set(resizeSidebar(layoutStore.getSnapshot(), SIDEBAR_WIDTH_STEP)), []),
    resetLayout: useCallback(() => layoutStore.reset(), []),
  };
}

export type EditorLayoutControls = ReturnType<typeof useEditorLayout>;
