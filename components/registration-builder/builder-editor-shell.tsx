// The Fluent-style editor shell (#1132), for tablets and desktops: a top bar,
// the live form canvas in the middle and one sidebar with Questions, Question
// settings and History tabs, which can be hidden, moved to the other side and
// resized. It is a layout over the existing builder model (BuilderContext):
// every edit and action it triggers is one the builder already had.
// Phones keep the older layout (see registration-builder-workspace.tsx).
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Eye, EllipsisVertical, PanelLeft, PanelRight, Plus } from "lucide-react";
import { RegistrationFormNotificationsPanel } from "@/components/registration-form-notifications-panel";
import { TemplateCleanupChecklistPanel } from "@/components/template-cleanup-checklist-panel";
import { PUBLIC_DRAFT_STAFF_HELP } from "@/modules/forms/public-draft";
import { statusLabel } from "./builder-types";
import { useLoadedBuilder } from "./builder-context";
import { BuilderActionHints, BuilderHistoricalGate, BuilderPublicLink, BuilderPublishButton, BuilderSaveDraftButton } from "./builder-top-bar";
import { BuilderNotices } from "./builder-notices";
import { BuilderTemplateNotice } from "./builder-template-notice";
import { BuilderRosterSettings, BuilderConfirmationEditor } from "./builder-form-settings";
import { BuilderPaymentSettings } from "./builder-payment-settings";
import { BuilderWithdrawZone } from "./builder-withdraw-zone";
import { BuilderPreview } from "./builder-preview";
import { BuilderVersionHistory } from "./builder-form-list";
import { BuilderCanvas, type ToolbarAction } from "./builder-canvas";
import { BuilderPalette } from "./builder-palette";
import { BuilderQuestionSettings, LABEL_INPUT_ID } from "./builder-question-settings";
import { BuilderSidebar, type SidebarTabDefinition } from "./builder-sidebar";
import { tabAfterSelectionChange, type SidebarTab } from "./sidebar-tabs";
import { locateField } from "./canvas-rows";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from "./editor-layout";
import { useEditorLayout } from "./use-editor-layout";
import type { PaletteEntry } from "./palette-registry";

type FocusRequest =
  | { kind: "label" }
  | { kind: "search" }
  | { kind: "toolbar"; fieldId: string; action: ToolbarAction }
  | { kind: "field"; fieldId: string }
  | { kind: "step-add"; sectionId: string };

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function focusSelector(request: FocusRequest) {
  switch (request.kind) {
    case "label": return `#${LABEL_INPUT_ID}`;
    case "search": return "#fb-palette-search";
    case "toolbar": return `[data-fb-action="${request.action}"][data-field-id="${request.fieldId}"]`;
    case "field": return `.fb-field[data-field-id="${request.fieldId}"]`;
    case "step-add": return `[data-fb-step-add="${request.sectionId}"]`;
  }
}

export function BuilderEditorShell({ focusTarget = null }: { focusTarget?: { formId: string; fieldId: string } | null }) {
  const {
    eventId, forms, selectedFormId, selectedForm, selectedVersion, definition, dirty, canEdit, canEditNotifications,
    expandedFieldId, setExpandedFieldId, addPaletteEntry, moveField, duplicateField, openRemoveField, showPreview, chooseForm,
  } = useLoadedBuilder();
  const layoutControls = useEditorLayout();
  const { layout, showSidebar } = layoutControls;

  // A question already selected on arrival (a setup warning's link) opens its settings.
  const [tab, setTab] = useState<SidebarTab>(expandedFieldId ? "settings" : "questions");
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<PaletteEntry | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<"editor" | "settings" | "notifications">("editor");
  const [focusRequest, setFocusRequest] = useState<{ request: FocusRequest; nonce: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const lastSelection = useRef<{ fieldId: string; sectionId: string } | null>(null);
  const handledFocusTarget = useRef(false);

  const selection = locateField(definition.sections, expandedFieldId);
  const selectedSectionId = selection ? definition.sections[selection.sectionIndex]!.id : null;

  // Selecting a question, by any route (a click, a duplicate, a module insert, a setup warning's link), opens its settings.
  // Adjusting state while rendering is React's pattern for state that follows other state.
  const [seenSelection, setSeenSelection] = useState<string | null>(expandedFieldId);
  if (seenSelection !== expandedFieldId) {
    setSeenSelection(expandedFieldId);
    setTab(tabAfterSelectionChange(tab, seenSelection, expandedFieldId));
  }

  const targetIndexById = definition.sections.findIndex((section) => section.id === targetSectionId);
  const targetIndex = targetIndexById >= 0 ? targetIndexById : (selection?.sectionIndex ?? 0);

  const request = useCallback((next: FocusRequest) => {
    setFocusRequest((current) => ({ request: next, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  // Runs after the render a request came with, so the element it names exists. Only reads and moves focus.
  useEffect(() => {
    if (!focusRequest) return;
    const element = document.querySelector<HTMLElement>(focusSelector(focusRequest.request));
    if (!element) return;
    element.focus();
    if (focusRequest.request.kind === "label" && element instanceof HTMLInputElement) element.select();
  }, [focusRequest]);

  // The question a setup warning links to (#617): its fee box may sit inside the closed Advanced fold, so open the folds and focus it.
  useEffect(() => {
    if (!focusTarget || handledFocusTarget.current || focusTarget.formId !== selectedFormId) return;
    if (expandedFieldId !== focusTarget.fieldId || tab !== "settings") return;
    const input = document.getElementById(`registration-fee-${focusTarget.fieldId}`);
    if (!input) { handledFocusTarget.current = true; return; }
    handledFocusTarget.current = true;
    for (let node: HTMLElement | null = input; node; node = node.parentElement) {
      if (node instanceof HTMLDetailsElement) node.open = true;
    }
    input.scrollIntoView({ block: "center" });
    input.focus();
  }, [focusTarget, selectedFormId, expandedFieldId, tab]);

  // Remember where the selection was; if the question is then removed, focus goes to its step's add button instead of being lost.
  useEffect(() => {
    if (selection && selectedSectionId) {
      lastSelection.current = { fieldId: selection.field.id, sectionId: selectedSectionId };
    } else if (lastSelection.current && lastSelection.current.fieldId === expandedFieldId) {
      const { sectionId } = lastSelection.current;
      lastSelection.current = null;
      const target = document.querySelector<HTMLElement>(`[data-fb-step-add="${sectionId}"]`) ?? document.getElementById("fb-form-title");
      target?.focus();
    }
  });

  // "/" jumps to the question search, as in Fluent Forms, unless the person is typing somewhere.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || isTypingTarget(event.target)) return;
      event.preventDefault();
      showSidebar();
      setTab("questions");
      request({ kind: "search" });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showSidebar, request]);

  function selectField(fieldId: string, sectionIndex: number) {
    setTargetSectionId(definition.sections[sectionIndex]?.id ?? null);
    setExpandedFieldId(fieldId);
    setTab("settings");
  }

  function addToStep(sectionIndex: number) {
    setTargetSectionId(definition.sections[sectionIndex]?.id ?? null);
    showSidebar();
    setTab("questions");
    request({ kind: "search" });
  }

  function addEntry(entry: PaletteEntry, sectionIndex = targetIndex, atIndex?: number) {
    addPaletteEntry(entry, sectionIndex, atIndex);
    // The new question is selected (so the settings tab opens); put the cursor in its label to name it.
    request({ kind: "label" });
  }

  function onToolbarAction(action: ToolbarAction, sectionIndex: number, fieldIndex: number) {
    const field = definition.sections[sectionIndex]?.fields[fieldIndex];
    if (!field) return;
    if (action === "settings") { setTab("settings"); showSidebar(); request({ kind: "label" }); return; }
    if (action === "up" || action === "down") { moveField(sectionIndex, fieldIndex, action === "up" ? -1 : 1); request({ kind: "toolbar", fieldId: field.id, action }); return; }
    // The copy is selected; put the cursor in its label, since the button just pressed leaves the page with the old selection.
    if (action === "duplicate") { duplicateField(sectionIndex, fieldIndex); request({ kind: "label" }); return; }
    openRemoveField(sectionIndex, fieldIndex);
  }

  function scrollToSection(id: "editor" | "settings" | "notifications") {
    setActiveSection(id);
    const element = document.getElementById(id === "editor" ? "builder-editor" : id === "settings" ? "builder-settings" : "builder-notifications");
    element?.scrollIntoView({ block: "start" });
    element?.focus({ preventScroll: true });
  }

  const tabs: SidebarTabDefinition[] = [
    {
      id: "questions",
      label: "Questions",
      panel: (
        <BuilderPalette
          steps={definition.sections.map((section) => ({ id: section.id, title: section.title }))}
          targetIndex={targetIndex}
          onTargetChange={(index) => setTargetSectionId(definition.sections[index]?.id ?? null)}
          onAdd={(entry) => addEntry(entry)}
          onDragStart={setPaletteDrag}
          onDragEnd={() => setPaletteDrag(null)}
          disabled={!canEdit}
        />
      ),
    },
    { id: "settings", label: "Question settings", panel: <BuilderQuestionSettings selection={selection} /> },
    {
      id: "history",
      label: "History",
      panel: (
        <div className="fb-history">
          <p className="fb-hint">Every saved version of this form, read-only. Choose one to view it. Restoring an old version comes later.</p>
          <BuilderVersionHistory />
        </div>
      ),
    },
  ];

  const sidebarSide = layout.side;
  const status = selectedVersion.status;

  return (
    <div className="fb-shell" data-side={sidebarSide} data-sidebar={layout.sidebarVisible ? "shown" : "hidden"}>
      <header className="fb-topbar">
        <Link className="fb-icon-button" href={`/event-setup?event=${encodeURIComponent(eventId)}`} aria-label="Back to event setup"><ChevronLeft size={18} aria-hidden="true" /></Link>
        {forms.length > 1
          ? <label className="fb-form-switch"><span className="sr-only">Form</span><select value={selectedFormId} onChange={(event) => { const form = forms.find((candidate) => candidate.id === event.target.value); if (form) void chooseForm(form); }}>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>
          : <span className="fb-form-name">{selectedForm.name}</span>}
        <nav className="fb-nav" aria-label="Form sections">
          <a href="#builder-editor" aria-current={activeSection === "editor" ? "page" : undefined} onClick={(event) => { event.preventDefault(); scrollToSection("editor"); }}>Editor</a>
          <a href="#builder-settings" aria-current={activeSection === "settings" ? "page" : undefined} onClick={(event) => { event.preventDefault(); scrollToSection("settings"); }}>Settings &amp; payment</a>
          {canEditNotifications && <a href="#builder-notifications" aria-current={activeSection === "notifications" ? "page" : undefined} onClick={(event) => { event.preventDefault(); scrollToSection("notifications"); }}>Notifications</a>}
        </nav>
        <span className={`status-chip fb-version-chip ${status === "PUBLISHED" ? "green" : status === "DRAFT" ? "gold" : "purple"}`}>{statusLabel(status)} · version {selectedVersion.versionNumber}</span>
        {dirty && <span className="unsaved-dot">Unsaved changes</span>}
        <button className="fb-btn" type="button" onClick={showPreview}><Eye size={15} aria-hidden="true" /> Preview &amp; test</button>
        <BuilderSaveDraftButton className="fb-btn primary" />
        <BuilderPublishButton className="fb-btn outline" />
        <button
          ref={menuButtonRef}
          className="fb-icon-button"
          type="button"
          aria-label="Layout options"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          aria-controls="fb-layout-menu"
          onClick={() => setMenuOpen((open) => !open)}
        ><EllipsisVertical size={18} aria-hidden="true" /></button>
      </header>
      {menuOpen && (
        <div
          className="fb-layout-menu"
          id="fb-layout-menu"
          role="group"
          aria-label="Layout options"
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setMenuOpen(false); menuButtonRef.current?.focus(); } }}
        >
          <button className="fb-btn" type="button" onClick={layoutControls.toggleSidebar}>{layout.sidebarVisible ? "Hide sidebar" : "Show sidebar"}</button>
          <button className="fb-btn" type="button" onClick={layoutControls.swapSide}>{layout.side === "right" ? "Move sidebar to the left" : "Move sidebar to the right"}</button>
          <button className="fb-btn" type="button" disabled={layout.width <= MIN_SIDEBAR_WIDTH} onClick={layoutControls.narrower}>Sidebar narrower</button>
          <button className="fb-btn" type="button" disabled={layout.width >= MAX_SIDEBAR_WIDTH} onClick={layoutControls.wider}>Sidebar wider</button>
          <button className="fb-btn" type="button" onClick={layoutControls.resetLayout}>Reset layout</button>
          <p className="fb-hint">You can also drag the sidebar&apos;s edge, or focus it and use the arrow keys. Your layout is remembered in this browser.</p>
        </div>
      )}
      <BuilderNotices />
      <div className="fb-body" ref={bodyRef} style={{ ["--fb-sidebar-width" as string]: `${layout.width}px` }}>
        <div className="fb-main" id="builder-editor" tabIndex={-1}>
          <BuilderActionHints />
          <BuilderHistoricalGate />
          <BuilderTemplateNotice />
          {canEdit && <TemplateCleanupChecklistPanel key={selectedForm.id} formId={selectedForm.id} definition={definition} />}
          <p className="builder-draft-note"><small>{PUBLIC_DRAFT_STAFF_HELP}</small></p>
          <BuilderCanvas
            paletteDrag={paletteDrag}
            onSelect={selectField}
            onAction={onToolbarAction}
            onAddToStep={addToStep}
            onDropPalette={(sectionIndex, index) => {
              if (paletteDrag) addEntry(paletteDrag, sectionIndex, index);
              setPaletteDrag(null);
            }}
          />
          <div className="fb-form-sections" id="builder-settings" tabIndex={-1} aria-label="Settings and payment">
            <h2 className="fb-section-title">Settings &amp; payment</h2>
            <div className="fb-public-link"><BuilderPublicLink /></div>
            <BuilderRosterSettings />
            <BuilderPaymentSettings />
            <BuilderConfirmationEditor />
            <BuilderWithdrawZone />
          </div>
          {canEditNotifications && (
            <div className="fb-form-sections" id="builder-notifications" tabIndex={-1} aria-label="Notifications">
              <RegistrationFormNotificationsPanel key={selectedForm.id} eventId={eventId} formId={selectedForm.id} />
            </div>
          )}
          <div className="fb-preview-section"><BuilderPreview /></div>
        </div>
        {layout.sidebarVisible
          ? <BuilderSidebar tabs={tabs} activeTab={tab} onTabChange={setTab} layout={layout} onResize={layoutControls.setWidth} containerRef={bodyRef} />
          : <div className="fb-rail"><button className="fb-btn" type="button" onClick={layoutControls.toggleSidebar}>{sidebarSide === "left" ? <PanelLeft size={15} aria-hidden="true" /> : <PanelRight size={15} aria-hidden="true" />} Show sidebar</button><button className="fb-btn" type="button" onClick={() => addToStep(targetIndex)}><Plus size={15} aria-hidden="true" /> Add question</button></div>}
      </div>
    </div>
  );
}
