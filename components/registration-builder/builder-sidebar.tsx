// The editor's one sidebar (#1132): a tab list over tab panels, plus the drag
// handle that resizes it. What each tab shows is passed in, so the sidebar
// itself does not change when a tab's content does.
import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { nextTabIndex, type SidebarTab } from "./sidebar-tabs";
import { MIN_SIDEBAR_WIDTH, SIDEBAR_WIDTH_STEP, widthFromPointer, type EditorLayout } from "./editor-layout";

export type { SidebarTab };
export type SidebarTabDefinition = { id: SidebarTab; label: string; panel: ReactNode };

/** The tab/panel ids, so other code (focus requests, tests) can name them. */
export const sidebarTabId = (tab: SidebarTab) => `fb-tab-${tab}`;
export const sidebarPanelId = (tab: SidebarTab) => `fb-panel-${tab}`;

export function BuilderSidebar({ tabs, activeTab, onTabChange, layout, shownWidth, maxWidth, onResize, containerRef }: {
  tabs: SidebarTabDefinition[];
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  layout: EditorLayout;
  /** What the sidebar really measures, and the most the page has room for. The remembered width can be wider than what shows. */
  shownWidth: number;
  maxWidth: number;
  /** `persist` is false while a drag is still moving, true for the final width. */
  onResize: (width: number, persist?: boolean) => void;
  /** The element the sidebar sits in, for measuring a drag. */
  containerRef: RefObject<HTMLElement | null>;
}) {
  const tabRefs = useRef(new Map<SidebarTab, HTMLButtonElement>());
  const dragging = useRef(false);
  const lastDragWidth = useRef<number | null>(null);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextTabIndex(event.key, index, tabs.length);
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next]!;
    onTabChange(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  }

  function onHandleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The arrow that points away from the form widens the sidebar, whichever side it is on.
    const widen = layout.side === "right" ? "ArrowLeft" : "ArrowRight";
    const narrow = layout.side === "right" ? "ArrowRight" : "ArrowLeft";
    if (event.key === widen) onResize(Math.min(shownWidth + SIDEBAR_WIDTH_STEP, maxWidth));
    else if (event.key === narrow) onResize(shownWidth - SIDEBAR_WIDTH_STEP);
    else if (event.key === "Home") onResize(MIN_SIDEBAR_WIDTH);
    else if (event.key === "End") onResize(maxWidth);
    else return;
    event.preventDefault();
  }

  function onPointerMove(clientX: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!dragging.current || !rect) return;
    const width = Math.min(widthFromPointer(layout.side, clientX, rect.left, rect.right), maxWidth);
    lastDragWidth.current = width;
    onResize(width, false);
  }

  // The width is written to storage once, when the drag ends, not on every move.
  function endDrag() {
    if (!dragging.current) return;
    dragging.current = false;
    if (lastDragWidth.current !== null) onResize(lastDragWidth.current, true);
    lastDragWidth.current = null;
  }

  return (
    <aside className="fb-sidebar" aria-label="Questions and settings">
      <div
        className="fb-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={maxWidth}
        aria-valuenow={shownWidth}
        aria-valuetext={`${shownWidth} pixels wide`}
        tabIndex={0}
        onKeyDown={onHandleKeyDown}
        onPointerDown={(event) => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => onPointerMove(event.clientX)}
        onPointerUp={(event) => { endDrag(); event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={endDrag}
      />
      <div className="fb-tablist" role="tablist" aria-label="Sidebar">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => { if (node) tabRefs.current.set(tab.id, node); else tabRefs.current.delete(tab.id); }}
            type="button"
            role="tab"
            id={sidebarTabId(tab.id)}
            aria-selected={activeTab === tab.id}
            aria-controls={sidebarPanelId(tab.id)}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className="fb-tab"
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >{tab.label}</button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} className="fb-tabpanel" role="tabpanel" id={sidebarPanelId(tab.id)} aria-labelledby={sidebarTabId(tab.id)} hidden={activeTab !== tab.id}>
          {tab.panel}
        </div>
      ))}
    </aside>
  );
}
