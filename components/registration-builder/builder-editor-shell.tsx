// The Fluent-style editor shell (#1132), for tablets and desktops: a top bar,
// the live form canvas in the middle and one sidebar with Questions, Question
// settings, Form settings and History tabs, which can be hidden, moved to the other side and
// resized. It is a layout over the existing builder model (BuilderContext):
// every edit and action it triggers is one the builder already had.
// Phones keep the older layout (see registration-builder-workspace.tsx).
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { ChevronLeft, Eye, EllipsisVertical, PanelLeft, PanelRight, Plus } from "lucide-react";
import { RegistrationFormNotificationsPanel } from "@/components/registration-form-notifications-panel";
import { TemplateCleanupChecklistPanel } from "@/components/template-cleanup-checklist-panel";
import { PUBLIC_DRAFT_STAFF_HELP } from "@/modules/forms/public-draft";
import { useLoadedBuilder } from "./builder-context";
import { showsPublishButton, BuilderActionHints, BuilderHistoricalGate, BuilderPublicLink, BuilderPublishButton, BuilderSaveDraftButton, BuilderUndoRedo, BuilderVersionChips } from "./builder-top-bar";
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
import { BuilderSidebar, sidebarPanelId, sidebarTabId, type SidebarTabDefinition } from "./builder-sidebar";
import { tabAfterSelectionChange, type SidebarTab } from "./sidebar-tabs";
import { locateField } from "./canvas-rows";
import { inspectorAfterClose, inspectorAfterSelection } from "./phone-inspector";
import { MIN_SIDEBAR_WIDTH, SIDEBAR_WIDTH_STEP, displayedSidebarWidth, maxSidebarWidthFor } from "./editor-layout";
import { canRedo, canUndo } from "./edit-history";
import { focusTargetAction, isSearchShortcut, undoRedoShortcut } from "./shell-keys";
import { useBuilderPhoneViewport, useEditorLayout, useHydrated } from "./use-editor-layout";
import { BuilderPhoneCanvas } from "./builder-phone-canvas";
import { PhoneMoveSheet } from "./builder-phone-move";
import { usePhoneModal } from "./use-phone-modal";
import { useKeyboardInset } from "./use-keyboard-inset";
import { paletteRegistry, type PaletteEntry, type PaletteRegistry } from "./palette-registry";
import { filterPaletteRegistry } from "./information-palette";
import { useQuestionLibraryRegistry } from "./use-question-library";
import { informationListHref, informationResponsesHref } from "./information-mode";
import { BuilderInformationSettings } from "./builder-information-settings";
type FocusRequest =
  | { kind: "label" }
  | { kind: "search" }
  | { kind: "toolbar"; fieldId: string; action: ToolbarAction }
  | { kind: "field"; fieldId: string }
  | { kind: "step-add"; sectionId: string }
  | { kind: "tab"; tab: SidebarTab }
  | { kind: "settings-link" };

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function focusSelector(request: FocusRequest) {
  switch (request.kind) {
    case "label": return `#${LABEL_INPUT_ID}`;
    case "search": return "#fb-palette-search";
    case "toolbar": return `[data-fb-action="${request.action}"][data-field-id="${request.fieldId}"]`;
    case "field": return `.fb-field[data-field-id="${request.fieldId}"], [data-fb-phone-edit="${request.fieldId}"]`;
    case "step-add": return `[data-fb-step-add="${request.sectionId}"]`;
    case "tab": return `#${sidebarTabId(request.tab)}`;
    case "settings-link": return '[data-fb-nav="settings"]';
  }
}

/** Width and height of an element, kept current. Null until the browser has measured it (never on the server). */
function useMeasuredSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setSize((current) => current && current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Undo and redo act from the editor and canvas, the top bar and the sidebar, or with nothing focused; not in Notifications. */
function inUndoScope(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true;
  if (target === document.body) return true;
  return target.closest(".fb-shell") !== null && target.closest("#builder-notifications") === null;
}

function dialogIsOpen() {
  return document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]') !== null;
}

/**
 * `registry` is the palette's source. It defaults to the shared registry; entries that belong to one organization
 * (saved questions, #1070) belong in a registry made for that provider and passed here. See docs/FORM-BUILDER-PALETTE.md.
 */
export function BuilderEditorShell({ focusTarget = null, registry }: { focusTarget?: { formId: string; fieldId: string } | null; registry?: PaletteRegistry }) {
  const {
    eventId, forms, selectedFormId, selectedForm, selectedVersion, definition, dirty, canEdit, editsCreateDraft, canEditNotifications: canEditRegistrationNotifications, information,
    busy, history, undoEdit, redoEdit, libraryRefresh, expandedFieldId, setExpandedFieldId, addPaletteEntry, moveField, duplicateField, openRemoveField, showPreview, chooseForm,
  } = useLoadedBuilder();
  // Information mode (#1149): no registration notifications, and the palette lists only what the information-form check allows.
  const canEditNotifications = canEditRegistrationNotifications && !information;
  // The question library (#1070) is layered over the registry; in information mode its entries pass the same refusal check as every other.
  const libraryRegistry = useQuestionLibraryRegistry(registry ?? paletteRegistry, information ? information.eventId : eventId, libraryRefresh);
  const paletteSource = useMemo(() => information ? filterPaletteRegistry(libraryRegistry) : libraryRegistry, [information, libraryRegistry]);
  const layoutControls = useEditorLayout();
  const hydrated = useHydrated();
  const { layout, showSidebar } = layoutControls;

  // A question already selected on arrival (a setup warning's link) opens its settings.
  const [tab, setTab] = useState<SidebarTab>(expandedFieldId ? "settings" : "questions");
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<PaletteEntry | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Phone width only (#1139): whether Question settings covers the screen. The stylesheet decides whether that means anything.
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // Phone width (#1071): a per-step question list, a sticky Save draft and Preview bar, and the Move screen.
  const phone = useBuilderPhoneViewport();
  const [phoneStepId, setPhoneStepId] = useState<string | null>(null);
  const [moveFieldId, setMoveFieldId] = useState<string | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const phoneBarRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<"editor" | "settings" | "notifications">("editor");
  const [focusRequest, setFocusRequest] = useState<{ request: FocusRequest; nonce: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const lastSelection = useRef<{ fieldId: string; sectionId: string } | null>(null);
  const handledFocusTarget = useRef(false);
  const lastVersionKey = useRef<string | null>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const topbarSize = useMeasuredSize(topbarRef);
  const bodySize = useMeasuredSize(bodyRef);
  // What the page has room for: the sidebar takes at most half the editor, so a remembered width can be wider than what shows.
  const maxWidth = maxSidebarWidthFor(bodySize?.width ?? null);
  const shownWidth = displayedSidebarWidth(layout.width, maxWidth);

  const selection = locateField(definition.sections, expandedFieldId);
  const selectedSectionId = selection ? definition.sections[selection.sectionIndex]!.id : null;

  // Selecting a question, by any route (a click, a duplicate, a module insert, a setup warning's link), opens its settings.
  // Adjusting state while rendering is React's pattern for state that follows other state.
  const [seenSelection, setSeenSelection] = useState<string | null>(expandedFieldId);
  if (seenSelection !== expandedFieldId) {
    setSeenSelection(expandedFieldId);
    setTab(tabAfterSelectionChange(tab, seenSelection, expandedFieldId));
    setInspectorOpen(inspectorAfterSelection(inspectorOpen, seenSelection, expandedFieldId));
  }
  // A setup warning's link (#617) arrives with its question selected: at phone width its settings open as the full-screen sheet, once.
  const [openedForTarget, setOpenedForTarget] = useState(false);
  if (phone && !openedForTarget && focusTarget && focusTarget.formId === selectedFormId && expandedFieldId === focusTarget.fieldId) {
    setOpenedForTarget(true);
    setInspectorOpen(true);
  }
  // A question removed (or undone away) while its settings fill the phone screen leaves nothing to show: close the sheet.
  if (inspectorOpen && tab === "settings" && !selection) setInspectorOpen(false);

  const targetIndexById = definition.sections.findIndex((section) => section.id === targetSectionId);
  const targetIndex = targetIndexById >= 0 ? targetIndexById : (selection?.sectionIndex ?? 0);
  // The step the phone list shows: the one the person chose, else the one holding the selected question, else the first.
  const phoneStepById = definition.sections.findIndex((section) => section.id === phoneStepId);
  const phoneStepIndex = phoneStepById >= 0 ? phoneStepById : (selection?.sectionIndex ?? 0);

  // Phone width: the full-screen sidebar traps focus and gives it back; the sticky bar lifts above the keyboard.
  const sheetActive = phone && inspectorOpen && layout.sidebarVisible;
  useKeyboardInset(phoneBarRef, phone);

  const request = useCallback((next: FocusRequest) => {
    setFocusRequest((current) => ({ request: next, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  // Declared before the focus-request effect below, so it notes what opened the sheet before a request moves focus into it.
  usePhoneModal({
    active: sheetActive,
    ref: asideRef,
    onClose: closeInspector,
    // The control that opened the sheet is gone (a removed question, or a browser that does not focus a tapped button): the
    // question's card, else the step's Add question button, else the top of the editor.
    fallback: () => {
      const target = (expandedFieldId ? document.querySelector<HTMLElement>(`[data-fb-phone-edit="${expandedFieldId}"]`) : null)
        ?? document.querySelector<HTMLElement>("[data-fb-step-add]")
        ?? document.getElementById("builder-editor");
      target?.focus({ preventScroll: true });
    },
  });

  // Runs after the render a request came with, so the element it names exists. Only reads and moves focus.
  useEffect(() => {
    if (!focusRequest) return;
    // The first match that is on screen: at phone width the inspector's own buttons stand in for the canvas's, and the other way round.
    const element = Array.from(document.querySelectorAll<HTMLElement>(focusSelector(focusRequest.request))).find((candidate) => candidate.getClientRects().length > 0);
    if (!element) return;
    element.focus();
    if (focusRequest.request.kind === "label" && element instanceof HTMLInputElement) element.select();
  }, [focusRequest]);

  // The question a setup warning links to (#617): its fee box may sit inside the closed Advanced fold, so open the folds and focus it.
  // A hidden sidebar is shown first, or the box would not exist to focus.
  useEffect(() => {
    if (!focusTarget || focusTarget.formId !== selectedFormId) return;
    const action = focusTargetAction({ handled: handledFocusTarget.current, hydrated, selected: expandedFieldId === focusTarget.fieldId, settingsOpen: tab === "settings", sidebarVisible: layout.sidebarVisible });
    if (action === "skip") return;
    if (action === "reveal") { showSidebar(); return; }
    // At phone width the settings fill the screen: wait for the sheet to open (see openedForTarget) and run again then.
    if (phone && !inspectorOpen) return;
    const input = document.getElementById(`registration-fee-${focusTarget.fieldId}`);
    if (!input) { handledFocusTarget.current = true; return; }
    handledFocusTarget.current = true;
    for (let node: HTMLElement | null = input; node; node = node.parentElement) {
      if (node instanceof HTMLDetailsElement) node.open = true;
    }
    input.scrollIntoView({ block: "center" });
    input.focus();
  }, [focusTarget, selectedFormId, expandedFieldId, tab, layout.sidebarVisible, showSidebar, hydrated, phone, inspectorOpen]);

  // Remember where the selection was; if the question is then removed, focus goes to its step's add button instead of being lost.
  // Opening another form or version forgets it. The removal confirmation puts focus back itself when it closes, so this waits a
  // tick and only acts if focus has been lost (it is on nothing, or on the page body) and no dialog is open.
  const versionKey = `${selectedFormId}:${selectedVersion.id}`;
  useEffect(() => {
    if (lastVersionKey.current !== versionKey) { lastVersionKey.current = versionKey; lastSelection.current = null; }
    if (selection && selectedSectionId) {
      lastSelection.current = { fieldId: selection.field.id, sectionId: selectedSectionId };
    } else if (lastSelection.current && lastSelection.current.fieldId === expandedFieldId) {
      const { sectionId } = lastSelection.current;
      lastSelection.current = null;
      window.setTimeout(() => {
        const active = document.activeElement;
        if ((active && active !== document.body) || dialogIsOpen()) return;
        (document.querySelector<HTMLElement>(`[data-fb-step-add="${sectionId}"]`) ?? document.getElementById("fb-form-title"))?.focus();
      }, 0);
    }
  });

  // "/" jumps to the question search, as in Fluent Forms, unless the person is typing somewhere or a dialog is open.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSearchShortcut({ key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, defaultPrevented: event.defaultPrevented, fromTypingTarget: isTypingTarget(event.target), dialogOpen: dialogIsOpen() })) return;
      event.preventDefault();
      showSidebar();
      setTab("questions");
      request({ kind: "search" });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showSidebar, request]);

  // Ctrl or Cmd+Z, Shift+Ctrl or Cmd+Z and Ctrl+Y (#1134), outside text fields (which keep the browser's own undo) and dialogs.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const action = undoRedoShortcut({ key: event.key, shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, defaultPrevented: event.defaultPrevented, fromTypingTarget: isTypingTarget(event.target), dialogOpen: dialogIsOpen(), inEditorScope: inUndoScope(event.target) });
      // Only a shortcut that runs is taken from the browser.
      if (!action || !canEdit || busy !== null || !(action === "undo" ? canUndo(history) : canRedo(history))) return;
      event.preventDefault();
      (action === "undo" ? undoEdit : redoEdit)();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [canEdit, busy, history, undoEdit, redoEdit]);

  function selectField(fieldId: string, sectionIndex: number) {
    setTargetSectionId(definition.sections[sectionIndex]?.id ?? null);
    setActiveSection("editor");
    setPhoneStepId(definition.sections[sectionIndex]?.id ?? null);
    setExpandedFieldId(fieldId);
    setTab("settings");
    // At phone width the settings fill the screen; Edit on the question that is already selected must open them again too.
    setInspectorOpen(true);
    // Selecting while the sidebar is hidden shows it, so the settings the selection opens can be seen.
    showSidebar();
  }

  function addToStep(sectionIndex: number) {
    setTargetSectionId(definition.sections[sectionIndex]?.id ?? null);
    setPhoneStepId(definition.sections[sectionIndex]?.id ?? null);
    showSidebar();
    setTab("questions");
    // At phone width the question search opens as its own sheet.
    setInspectorOpen(true);
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
    if (action === "settings") { setTab("settings"); setInspectorOpen(true); showSidebar(); request({ kind: "label" }); return; }
    if (action === "up" || action === "down") { moveField(sectionIndex, fieldIndex, action === "up" ? -1 : 1); request({ kind: "toolbar", fieldId: field.id, action }); return; }
    // The copy is selected; put the cursor in its label, since the button just pressed leaves the page with the old selection.
    if (action === "duplicate") { duplicateField(sectionIndex, fieldIndex); request({ kind: "label" }); return; }
    openRemoveField(sectionIndex, fieldIndex);
  }

  // Back, Done, Close and Escape only close the inspector: the edits stay, nothing is saved, and "Unsaved changes" stays on.
  // Focus goes back to the control that opened it (usePhoneModal), which is the question's Edit button, the step's Add
  // question button or the Settings & payment link.
  function closeInspector() {
    setInspectorOpen(inspectorAfterClose());
  }

  // The "Settings & payment" link opens the Form settings tab (#1139), showing the sidebar first if it is hidden.
  function openFormSettings() {
    setActiveSection("settings");
    showSidebar();
    setTab("form-settings");
    setInspectorOpen(true);
    request({ kind: "tab", tab: "form-settings" });
  }

  function scrollToSection(id: "editor" | "notifications") {
    setActiveSection(id);
    const element = document.getElementById(id === "editor" ? "builder-editor" : "builder-notifications");
    element?.scrollIntoView({ block: "start" });
    element?.focus({ preventScroll: true });
  }

  const tabs: SidebarTabDefinition[] = [
    {
      id: "questions",
      label: "Questions",
      panel: (
        <BuilderPalette
          registry={paletteSource}
          searchPlaceholder={information ? "Name, email, choice, date…" : undefined}
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
    { id: "settings", label: "Question settings", panel: <BuilderQuestionSettings selection={selection} onAction={onToolbarAction} /> },
    {
      id: "form-settings",
      label: "Form settings",
      // The form-wide controls, reused as they are (#1139): who the form registers, payment, the confirmation message and Withdraw.
      panel: (
        information
          ? (
            <div className="fb-form-settings" id="builder-settings" role="group" aria-label="Form settings">
              <BuilderInformationSettings />
              <BuilderConfirmationEditor />
            </div>
          )
          : (
            <div className="fb-form-settings" id="builder-settings" role="group" aria-label="Settings and payment">
              <div className="fb-public-link"><BuilderPublicLink /></div>
              <BuilderRosterSettings />
              <BuilderPaymentSettings />
              <BuilderConfirmationEditor />
              <BuilderWithdrawZone />
            </div>
          )
      ),
    },
    {
      id: "history",
      label: "History",
      panel: (
        <div className="fb-history">
          <p className="fb-hint">Every saved version of this form. Choose one to view it read-only. Restore as draft copies an older version into the draft; the live version stays live until you publish.</p>
          <BuilderVersionHistory detailed />
        </div>
      ),
    },
  ];

  const sidebarSide = layout.side;
  // At phone width the notices sit just above the sticky bar, or inside the full-screen sheet while it covers the page.
  const phoneNotices = <BuilderNotices />;

  return (
    <div className="fb-shell" data-phone={phone ? "true" : undefined} data-side={sidebarSide} data-sidebar={layout.sidebarVisible ? "shown" : "hidden"} data-inspector={inspectorOpen ? "open" : "closed"} style={topbarSize ? { ["--fb-topbar-height" as string]: `${topbarSize.height}px` } : undefined}>
      <header className="fb-topbar" ref={topbarRef}>
        <Link className="fb-icon-button" href={information ? informationListHref(information) : `/event-setup?event=${encodeURIComponent(eventId)}`} aria-label={information ? "Back to information forms" : "Back to event setup"}><ChevronLeft size={18} aria-hidden="true" /></Link>
        {forms.length > 1
          ? <label className="fb-form-switch"><span className="sr-only">Form</span><select value={selectedFormId} onChange={(event) => { const form = forms.find((candidate) => candidate.id === event.target.value); if (form) void chooseForm(form); }}>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>
          : <span className="fb-form-name">{selectedForm.name}</span>}
        <nav className="fb-nav" aria-label="Form sections">
          <a href="#builder-editor" aria-current={activeSection === "editor" && tab !== "form-settings" ? "page" : undefined} onClick={(event) => { event.preventDefault(); scrollToSection("editor"); }}>Editor</a>
          {information && <a href="#builder-settings" data-fb-nav="settings" aria-current={tab === "form-settings" ? "page" : undefined} aria-controls={sidebarPanelId("form-settings")} onClick={(event) => { event.preventDefault(); openFormSettings(); }}>Form settings</a>}
          {!information && <a href="#builder-settings" data-fb-nav="settings" aria-current={tab === "form-settings" ? "page" : undefined} aria-controls={sidebarPanelId("form-settings")} onClick={(event) => { event.preventDefault(); openFormSettings(); }}>Settings &amp; payment</a>}
          {information && <Link href={informationResponsesHref(information, selectedForm.id)}>Responses</Link>}
          {canEditNotifications && <a href="#builder-notifications" aria-current={activeSection === "notifications" && tab !== "form-settings" ? "page" : undefined} onClick={(event) => { event.preventDefault(); scrollToSection("notifications"); }}>Notifications</a>}
        </nav>
        <BuilderVersionChips />
        <BuilderUndoRedo />
        {!phone && <button className="fb-btn" type="button" onClick={showPreview}><Eye size={15} aria-hidden="true" /> {information ? "Preview" : "Preview & test"}</button>}
        {/* Publish is the main button; with no Publish (a clean live or withdrawn version) Save is (#1137). */}
        {!phone && <BuilderSaveDraftButton className={showsPublishButton({ status: selectedVersion.status, canEdit, editsCreateDraft, dirty }) ? "fb-btn outline" : "fb-btn primary"} />}
        <BuilderPublishButton className="fb-btn primary" />
        {!phone && <button
          ref={menuButtonRef}
          className="fb-icon-button"
          type="button"
          aria-label="Layout options"
          aria-expanded={menuOpen}
          aria-controls="fb-layout-menu"
          onClick={() => setMenuOpen((open) => !open)}
        ><EllipsisVertical size={18} aria-hidden="true" /></button>}
      </header>
      {menuOpen && !phone && (
        <div
          className="fb-layout-menu"
          id="fb-layout-menu"
          role="group"
          aria-label="Layout options"
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setMenuOpen(false); menuButtonRef.current?.focus(); } }}
        >
          <button className="fb-btn" type="button" onClick={layoutControls.toggleSidebar}>{layout.sidebarVisible ? "Hide sidebar" : "Show sidebar"}</button>
          <button className="fb-btn" type="button" onClick={layoutControls.swapSide}>{layout.side === "right" ? "Move sidebar to the left" : "Move sidebar to the right"}</button>
          <button className="fb-btn" type="button" disabled={shownWidth <= MIN_SIDEBAR_WIDTH} onClick={() => layoutControls.setWidth(shownWidth - SIDEBAR_WIDTH_STEP)}>Sidebar narrower</button>
          <button className="fb-btn" type="button" disabled={shownWidth >= maxWidth} onClick={() => layoutControls.setWidth(Math.min(shownWidth + SIDEBAR_WIDTH_STEP, maxWidth))}>Sidebar wider</button>
          <button className="fb-btn" type="button" onClick={layoutControls.resetLayout}>Reset layout</button>
          <p className="fb-hint">You can also drag the sidebar&apos;s edge, or focus it and use the arrow keys. Your layout is remembered in this browser.</p>
        </div>
      )}
      {!phone && <BuilderNotices />}
      <div className="fb-body" ref={bodyRef} style={{ ["--fb-sidebar-width" as string]: `${layout.width}px` }}>
        <div className="fb-main" id="builder-editor" tabIndex={-1}>
          <BuilderActionHints />
          <BuilderHistoricalGate />
          <BuilderTemplateNotice />
          {canEdit && !information && <TemplateCleanupChecklistPanel key={selectedForm.id} formId={selectedForm.id} definition={definition} />}
          {!information && <p className="builder-draft-note"><small>{PUBLIC_DRAFT_STAFF_HELP}</small></p>}
          {phone
            ? <BuilderPhoneCanvas
              activeStepIndex={phoneStepIndex}
              onStepChange={(index) => setPhoneStepId(definition.sections[index]?.id ?? null)}
              onEdit={selectField}
              onMove={setMoveFieldId}
              onAddToStep={addToStep}
              onAction={onToolbarAction}
            />
            : <BuilderCanvas
              paletteDrag={paletteDrag}
              onSelect={selectField}
              onAction={onToolbarAction}
              onAddToStep={addToStep}
              onDropPalette={(sectionIndex, index) => {
                if (paletteDrag) addEntry(paletteDrag, sectionIndex, index);
                setPaletteDrag(null);
              }}
            />}
          {canEditNotifications && (
            <div className="fb-form-sections" id="builder-notifications" tabIndex={-1} aria-label="Notifications">
              <RegistrationFormNotificationsPanel key={selectedForm.id} eventId={eventId} formId={selectedForm.id} />
            </div>
          )}
          <div className="fb-preview-section"><BuilderPreview /></div>
          {phone && <button className="fb-btn outline fb-phone-return" type="button" onClick={() => scrollToSection("editor")}>Back to the questions</button>}
        </div>
        {layout.sidebarVisible
          ? <BuilderSidebar tabs={tabs} activeTab={tab} onTabChange={setTab} layout={layout} shownWidth={shownWidth} maxWidth={maxWidth} onResize={layoutControls.setWidth} containerRef={bodyRef} asideRef={asideRef} modal={sheetActive} inspector={{ title: tab === "form-settings" ? "Form settings" : tab === "questions" ? "Add a question" : selection ? selection.field.label || "Untitled question" : "Question settings", onBack: closeInspector, onDone: closeInspector, doneLabel: tab === "questions" ? "Close" : "Done", hideBack: tab === "questions", note: tab === "questions" ? undefined : "Done keeps your changes in this draft. They are saved with Save draft.", notices: phone && inspectorOpen ? phoneNotices : undefined }} />
          : <div className="fb-rail"><button className="fb-btn" type="button" onClick={layoutControls.toggleSidebar}>{sidebarSide === "left" ? <PanelLeft size={15} aria-hidden="true" /> : <PanelRight size={15} aria-hidden="true" />} Show sidebar</button><button className="fb-btn" type="button" onClick={() => addToStep(targetIndex)}><Plus size={15} aria-hidden="true" /> Add question</button></div>}
      </div>
      {/* Phone width (#1071): Save draft and Preview stay at the bottom, above the keyboard and the safe area. Save is the one filled button unless Publish is showing (it is in the top bar). */}
      {phone && (
        <div className="fb-phone-bar" ref={phoneBarRef} role="group" aria-label="Draft actions">
          {!inspectorOpen && <div className="fb-phone-bar-notices">{phoneNotices}</div>}
          <div className="fb-phone-bar-actions">
            <button className="fb-btn outline" type="button" onClick={showPreview}><Eye size={15} aria-hidden="true" /> Preview</button>
            <BuilderSaveDraftButton className={showsPublishButton({ status: selectedVersion.status, canEdit, editsCreateDraft, dirty }) ? "fb-btn outline" : "fb-btn primary"} />
          </div>
        </div>
      )}
      {phone && moveFieldId && <PhoneMoveSheet fieldId={moveFieldId} onClose={() => setMoveFieldId(null)} onMoved={setPhoneStepId} />}
    </div>
  );
}
