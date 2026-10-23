// React side of the movable sidebar (#1132): the layout, remembered per
// browser, and the phone-width check (#1071).
import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_EDITOR_LAYOUT, SIDEBAR_WIDTH_STEP, clampSidebarWidth, createEditorLayoutStore, resizeSidebar, revealSidebar,
} from "./editor-layout";

/**
 * Phone width (#1071): under 768px the same editor shell shows a per-step question list, a sticky Save draft and Preview
 * bar and full-screen sheets instead of the canvas and sidebar. The stylesheet's phone rules use the same breakpoint.
 */
export const BUILDER_PHONE_MEDIA_QUERY = "(max-width: 767px)";

function subscribeToViewport(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(BUILDER_PHONE_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** False on the server and for the first client render, so markup matches and a desktop never flashes the phone layout; true once the browser reports a phone width. */
export function useBuilderPhoneViewport(): boolean {
  return useSyncExternalStore(
    subscribeToViewport,
    () => typeof window.matchMedia === "function" && window.matchMedia(BUILDER_PHONE_MEDIA_QUERY).matches,
    () => false,
  );
}

const noSubscription = () => () => {};

/** False while the page is being hydrated (and on the server), true from the first client render after it. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
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
