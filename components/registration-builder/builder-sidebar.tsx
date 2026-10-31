// The editor's one sidebar (#1132): a tab list over tab panels, plus the drag
// handle that resizes it. What each tab shows is passed in, so the sidebar
// itself does not change when a tab's content does.
import { ChevronLeft } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from "react";
import { TabList, TabPanel } from "@/components/dashboard-tabs";
import type { SidebarTab } from "./sidebar-tabs";
import { MIN_SIDEBAR_WIDTH, SIDEBAR_WIDTH_STEP, widthFromPointer, type EditorLayout } from "./editor-layout";

export type { SidebarTab };
export type SidebarTabDefinition = { id: SidebarTab; label: string; panel: ReactNode };

/** The tab/panel ids, so other code (focus requests, tests) can name them. */
export const sidebarTabId = (tab: SidebarTab) => `fb-tab-${tab}`;
export const sidebarPanelId = (tab: SidebarTab) => `fb-panel-${tab}`;

export function BuilderSidebar({ tabs, activeTab, onTabChange, layout, shownWidth, maxWidth, onResize, containerRef, inspector, asideRef, modal = false }: {
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
  /** Back and Done for the full-screen phone inspector (#1139). Both only close it; the bar is shown by the stylesheet at phone width. */
  inspector?: { title: string; onBack: () => void; onDone: () => void; /** "Done" for settings, "Close" for the Add question sheet (#1071). */ doneLabel?: string; /** The Add question sheet has one Close button, not Back and Done. */ hideBack?: boolean; /** What the Done button does not do, said where it is pressed. */ note?: string; /** The page notices, shown inside the sheet while it covers the page. */ notices?: ReactNode };
  /** The aside element, so the phone sheet can trap focus in it. */
  asideRef?: Ref<HTMLElement>;
  /** True while the aside is a full-screen phone sheet: it is then a modal dialog. */
  modal?: boolean;
}) {
  const dragging = useRef(false);
  const lastDragWidth = useRef<number | null>(null);

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
    <aside className="fb-sidebar" ref={asideRef} aria-label={modal && inspector ? inspector.title : "Questions and settings"} role={modal ? "dialog" : undefined} aria-modal={modal ? "true" : undefined} tabIndex={modal ? -1 : undefined}>
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
      {inspector && (
        <div className="fb-inspector-bar">
          {!inspector.hideBack && <button type="button" className="fb-btn" onClick={inspector.onBack}><ChevronLeft size={16} aria-hidden="true" /> Back</button>}
          <p className="fb-inspector-title">{inspector.title}</p>
          <button type="button" className="fb-btn outline" onClick={inspector.onDone}>{inspector.doneLabel ?? "Done"}</button>
        </div>
      )}
      {inspector?.note && <p className="fb-inspector-note fb-hint">{inspector.note}</p>}
      {inspector?.notices && <div className="fb-inspector-notices">{inspector.notices}</div>}
      <TabList
        label="Sidebar"
        className="fb-tablist"
        tabClassName="fb-tab"
        selectedKey={activeTab}
        onSelect={(key) => onTabChange(key as SidebarTab)}
        tabs={tabs.map((tab) => ({ key: tab.id, id: sidebarTabId(tab.id), label: tab.label, panelId: sidebarPanelId(tab.id) }))}
      />
      {tabs.map((tab) => (
        <TabPanel key={tab.id} id={sidebarPanelId(tab.id)} tabId={sidebarTabId(tab.id)} className="fb-tabpanel" hidden={activeTab !== tab.id}>
          {tab.panel}
        </TabPanel>
      ))}
    </aside>
  );
}
