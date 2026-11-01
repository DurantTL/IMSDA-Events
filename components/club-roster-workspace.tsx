"use client";
import { LiveListBoundary, ReloadButton } from "@/components/live-list-boundary";
import { SubmitButton } from "@/components/submit-button";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import Link from "next/link";
import { type ComponentProps, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { focusSearchInput, SearchClearButton } from "@/components/search-clear-button";
import { useAddressParam, useClientSearch, writeAddressParams } from "@/components/search-as-you-type";
import { Award, ChevronDown, Eye, Pencil, Plus, Power, Save, Search, Trash2, UsersRound, X } from "lucide-react";
import { ActionsMenu } from "@/components/actions-menu";
import { EmptyState } from "@/components/empty-state";
import { SortOrderNote, SortableHeader } from "@/components/list-sort";
import { flipDirection, nameSortLabel, sortByName, sortOrderText, type SortDirection } from "@/lib/list-sort";
import { BirthDateField } from "@/components/birth-date-field";
import { calendarDateInEventTimeZone } from "@/modules/events/lifecycle";
import { RosterTypeDefinitions } from "@/components/roster-type-definitions";
import { validateRosterForm, rosterFormFieldOrder, type RosterFormErrors, type RosterFormField } from "@/modules/club-rosters/form-validation";
import { ClubMemberHonorsDialog } from "@/components/club-member-honors-dialog";
import { RosterCsvImport } from "@/components/roster-csv-import";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { formEntries, rosterCloseDecision, rosterDialogIsDirty, rosterDiscardPrompt, rosterFormSnapshot, rosterFormSnapshots, type RosterFormSnapshot } from "@/components/roster-dialog-dirty";
import { complianceFilterLabels, complianceFilterState, type ComplianceFilterValue } from "@/modules/background-checks/display";
import {
  clubClassLevelLabels,
  attendeeTypeAgeHint,
  clubRosterAttendeeTypeLabels,
  clubRosterGenderLabels,
  clubRosterStatusLabels,
  defaultRosterRole,
  rosterSectionOf,
} from "@/modules/club-rosters/domain";
import {
  GUARDIAN_SLOTS,
  validateGuardianForm,
  type GuardianFormErrors,
  type GuardianRecord,
} from "@/modules/club-rosters/guardians-domain";
import { RosterGuardianFields, guardianErrorItems } from "@/components/roster-guardian-fields";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { FormErrorSummary, summaryMessage, useFormErrorSummary } from "@/components/form-error-summary";
import {
  applyRosterFilters,
  clearedRosterFilters,
  ROSTER_DETAILS_NEEDED_FILTER,
  rosterColumns,
  rosterDetailsNeededItems,
  rosterDetailsSummary,
  rosterDetailsNeeded,
  rosterLabelDetail,
  rosterPersonLabels,
  rosterRowTools,
  rosterSectionOpen,
  rosterSectionStorageKey,
} from "@/modules/club-rosters/roster-view";
import type { RosterMemberRecord } from "@/modules/club-rosters/repository";
import styles from "@/components/club-roster-sections.module.css";

type RosterResponse = {
  members?: RosterMemberRecord[];
  birthDates?: Record<string, string>;
  guardians?: Record<string, GuardianRecord[]>;
  nameKept?: boolean;
  message?: string;
  issues?: Array<{ message?: string }>;
};

/** A person's Sterling Volunteers mark on a club page (#427): status only, or status and note for staff. */
export type RosterComplianceInfo = {
  state: "CLEAR" | "FLAGGED" | "NOT_COMPLIANT" | "NO_RECORD";
  note: string | null;
  /** The note as readable reasons, for the same staff who get the note (#544); empty otherwise. */
  reasons?: string[];
};

/** "!" on the roster import is `FLAGGED`: expiring soon. Staff, who get the note, are pointed to it. */
function complianceLabel({ state, note }: RosterComplianceInfo) {
  if (state === "FLAGGED") return note ? "Expiring soon (see note)" : "Expiring soon";
  return { CLEAR: "Clear", NOT_COMPLIANT: "Not in compliance", NO_RECORD: "No record" }[state];
}
type SectionKey = "STAFF" | "MEMBERS";

const complianceTone = { CLEAR: "green", FLAGGED: "gold", NOT_COMPLIANT: "coral", NO_RECORD: "gold" } as const;

/** Remembered Staff/Members open state (#1305), kept in this browser only. Read with useSyncExternalStore so the server render and first client render agree (the role default). */
const sectionChoiceListeners = new Set<() => void>();
function readSectionChoices(organizationId: string) {
  return (["STAFF", "MEMBERS"] as const).map((key) => {
    try {
      return window.localStorage.getItem(rosterSectionStorageKey(organizationId, key)) ?? "";
    } catch {
      return "";
    }
  }).join("|");
}
function subscribeSectionChoices(listener: () => void) {
  sectionChoiceListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    sectionChoiceListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const rosterFieldLabels: Record<RosterFormField, string> = { firstName: "First name", lastName: "Last name", birthDate: "Birth date", gender: "Gender" };

function ClubRosterWorkspaceInner({
  canSeeBirthDates,
  clubYear,
  initialMembers,
  organizationId,
  readOnly = false,
  birthDatesEndpoint,
  complianceStatuses,
  honorsPopup,
  honorsHref,
  classHistoryBase,
  complianceFilter: initialComplianceFilter = null,
  initialQuery = "",
  detailsNeededFirst = false,
  headingActions,
  healthTab,
  healthEntryOnly,
  healthRecordFlags,
  guardians: initialGuardians,
  guardiansOnly = false,
  sectionsStartClosed = false,
}: {
  /** Directors and deputies only; a registrar enters birth dates but sees ages (#375). */
  canSeeBirthDates: boolean;
  clubYear: string;
  initialMembers: RosterMemberRecord[];
  organizationId: string;
  /** Staff "Open club" view (#386): see the roster the director sees, change nothing. */
  readOnly?: boolean;
  /** Where "Show birth dates" asks; staff use their own audited route. */
  birthDatesEndpoint?: string;
  /**
   * Sterling Volunteers status per roster member id (#427). Omitted entirely
   * where no one is allowed to see it; `note` is already blank unless the
   * caller is allowed to see it (club directors never get a note).
   */
  complianceStatuses?: Record<string, RosterComplianceInfo>;
  /**
   * The Honors column holds only a button (#819), never a list of honors: the
   * honors themselves live on the Honors page and in the history popup.
   * This one opens each person's honors in a popup (#701) instead of linking away.
   * `canRecord` shows the record form; without it the popup is view-only.
   * Omit where the caller can't use the club honors endpoints (staff views).
   */
  honorsPopup?: { canRecord: boolean };
  /** Where callers without the popup (conference staff) open the club's Honors page; the button links there. */
  honorsHref?: string;
  /**
   * The club portal's class tracking address (#791). Only that page sets it: the
   * class history page opens on the club portal's own gate, so area and staff
   * views omit it and show no link. A string, not a function, so it can cross
   * from a server page.
   */
  classHistoryBase?: string;
  /** `?compliance=` from the What's next reminder link (#479): narrows the list to that one flag. */
  complianceFilter?: ComplianceFilterValue | null;
  /** `?filter=details-needed` (#1167): open with the Details needed list already on. */
  detailsNeededFirst?: boolean;
  /** `?q=`: open with the name search already typed, so a reload or shared link keeps it (#1456). */
  initialQuery?: string;
  /** Extra actions beside "Add to roster", such as "Request a transfer" (#489). */
  headingActions?: React.ReactNode;
  /**
   * The Health tab link and status chip per member (#611). Present only when
   * the feature is switched on and the viewer is the club's director or
   * deputy; omitted everywhere else, so nothing about health is rendered.
   */
  healthTab?: Record<string, { status: "NONE" | "CURRENT" | "NEEDS_UPDATE" | "LOCKED"; hasHealthNote: boolean }>;
  /** A Registrar (#923) can enter a health record only when none exists yet: with one on file, the row shows its status and no link. */
  healthEntryOnly?: boolean;
  /** A neutral "Has a health record" marker (#611): a record exists, nothing more. Ids only, never text. */
  healthRecordFlags?: Record<string, boolean>;
  /**
   * Guardian contacts per roster member id (#510). Present only for the club's
   * director and deputy on the current year: it is what turns the guardian
   * fields on in the add/edit popup. Omitted for every other role, so nothing
   * about guardians is rendered or sent.
   */
  guardians?: Record<string, GuardianRecord[]>;
  /**
   * Next year's roster (#959): the rest of the page is read-only, but a
   * director or deputy can edit each person's emergency contacts. The pop-up
   * then holds only the contact fields, and nothing else about the person is sent.
   */
  guardiansOnly?: boolean;
  /** Staff and Members start closed (#1305) for the club director and registrar; a remembered choice still wins. Everyone else starts open. */
  sectionsStartClosed?: boolean;
}) {
  const [members, setMembers] = useState(initialMembers);
  // A page refresh (a transfer was accepted, the year rolled over) hands this component a fresh list from the server;
  // show it instead of the copy from first load (#1445, rule P2).
  const [membersFrom, setMembersFrom] = useState(initialMembers);
  if (membersFrom !== initialMembers) {
    setMembersFrom(initialMembers);
    setMembers(initialMembers);
  }
  const showHonors = Boolean(honorsPopup || honorsHref);
  const [honorsFor, setHonorsFor] = useState<RosterMemberRecord | null>(null);
  const [editing, setEditing] = useState<RosterMemberRecord | null>(null);
  /** The type picked in the dialog, so the Role placeholder shows the blank-role default (#424). */
  const [formType, setFormType] = useState<string>("YOUTH");
  const [formBirthDate, setFormBirthDate] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [birthDates, setBirthDates] = useState<Record<string, string> | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  /** Name search, the "Details needed" list and the Sterling Volunteers filter live in the address (`?q=`, `?filter=details-needed`, `?compliance=`), so reload, Back and shared links keep them (rule B2, #1456). The extra columns are not saved or sent anywhere. */
  const [complianceRaw, setComplianceRaw] = useAddressParam("compliance", initialComplianceFilter ?? "");
  const complianceFilter = Object.hasOwn(complianceFilterLabels, complianceRaw) ? (complianceRaw as ComplianceFilterValue) : null;
  const search = useClientSearch(initialQuery, undefined, "q");
  const query = search.term;
  const [detailsRaw, setDetailsRaw] = useAddressParam("filter", detailsNeededFirst ? ROSTER_DETAILS_NEEDED_FILTER : "");
  const detailsOnly = detailsRaw === ROSTER_DETAILS_NEEDED_FILTER;
  const [showGender, setShowGender] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  /** The request never reached the server (blocked, offline): the list on screen may be out of date, so offer Reload (#1445). */
  const [connectionLost, setConnectionLost] = useState(false);
  /** The dialog's own notice: a blocked save scrolls it into view and focuses it, so it is seen on a phone (#1445). */
  const dialogNoticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (connectionLost && dialogNoticeRef.current) {
      dialogNoticeRef.current.scrollIntoView({ block: "nearest" });
      dialogNoticeRef.current.focus();
    }
  }, [connectionLost, error]);
  const [notice, setNotice] = useState("");
  // Offered with the "Deactivated …" message; reactivating is the existing reverse action (#1455).
  const [undoDeactivate, setUndoDeactivate] = useState<RosterMemberRecord | null>(null);
  const [undoFailed, setUndoFailed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RosterFormErrors>({});
  const [guardianMap, setGuardianMap] = useState(initialGuardians);
  const [guardiansFrom, setGuardiansFrom] = useState(initialGuardians);
  if (guardiansFrom !== initialGuardians) {
    setGuardiansFrom(initialGuardians);
    setGuardianMap(initialGuardians);
  }
  const [guardianErrors, setGuardianErrors] = useState<GuardianFormErrors>({});
  const { ref: memberRef, items: memberItems, show: showMember, clear: clearMember, clearField: clearMemberField } = useFormErrorSummary();
  const canEditGuardians = initialGuardians !== undefined && (!readOnly || guardiansOnly);
  const contactsOnlyDialog = guardiansOnly && readOnly;
  /** Whether the dialog has this member's current guardians (#510): "failed" leaves guardians untouched on save. */
  const [guardianState, setGuardianState] = useState<"ready" | "loading" | "failed">("ready");
  const [guardianRev, setGuardianRev] = useState(0);
  const guardianLoadToken = useRef(0);
  const base = `/api/attendee/clubs/${encodeURIComponent(organizationId)}/roster`;
  /** Reads and contact saves name the year on next year's roster, so the server answers for that year (#959). */
  const yearQuery = contactsOnlyDialog ? `?year=${encodeURIComponent(clubYear)}` : "";
  /** The editor's values differ from the loaded ones (#1452); read from the form on each edit, since its fields are not controlled. */
  const [dialogDirty, setDialogDirty] = useState(false);
  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setDialogDirty(false);
    setEditing(null);
    clearMember();
  }, [clearMember]);
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  // Escape and Close keep their own "Discard unsaved changes?"; this adds the warning for links, Back and reload while the editor is open and changed.
  useUnsavedChangesGuard(dialogOpen && dialogDirty, "You have unsaved changes to this roster member. Leave this page and discard them?");
  const formRef = useRef<HTMLFormElement>(null);
  const baselineRef = useRef<RosterFormSnapshot | null>(null);
  const savingRef = useRef(false);
  const reviewingRef = useRef(false);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);
  // Once the loaded values are in the DOM, that is the baseline (#1101).
  useEffect(() => {
    const form = formRef.current;
    baselineRef.current = dialogOpen && form ? rosterFormSnapshots(formEntries(form)) : null;
  }, [dialogOpen, editing?.id]);
  // A refreshed contact list replaces only the contact fields, so only that half is re-baselined.
  useEffect(() => {
    const form = formRef.current;
    if (!dialogOpen || !form || !baselineRef.current) return;
    baselineRef.current = { ...baselineRef.current, contacts: rosterFormSnapshot(formEntries(form), "contacts") };
    setDialogDirty(rosterDialogIsDirty(baselineRef.current, rosterFormSnapshots(formEntries(form))));
  }, [guardianRev, dialogOpen]);
  const editorIsDirty = useCallback(() => {
    const form = formRef.current;
    return Boolean(form) && rosterDialogIsDirty(baselineRef.current, rosterFormSnapshots(formEntries(form!)));
  }, []);
  /** Close, Cancel, Escape and the backdrop all come here: clean closes at once, dirty asks, saving waits. */
  const requestClose = useCallback(async () => {
    const decision = rosterCloseDecision({ saving: savingRef.current, reviewing: reviewingRef.current, dirty: editorIsDirty() });
    if (decision === "ignore") return;
    if (decision === "confirm") {
      const form = formRef.current;
      const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      reviewingRef.current = true;
      const discard = await askConfirm({ ...rosterDiscardPrompt });
      reviewingRef.current = false;
      if (!discard || savingRef.current) {
        // Keep editing: put focus back inside the editor, on the field it was on, else the dialog itself.
        window.requestAnimationFrame(() => {
          const dialog = form?.closest<HTMLElement>("[role='dialog']") ?? null;
          if (previous && dialog?.contains(previous) && previous.isConnected) previous.focus();
          else dialog?.focus();
        });
        return;
      }
    }
    closeDialog();
  }, [askConfirm, closeDialog, editorIsDirty]);
  const dialogRef = useAccessibleDialog<HTMLElement>(dialogOpen, requestClose);
  const closeHonors = useCallback(() => setHonorsFor(null), []);

  /** Add and edit happen in a pop-up (#383), so the list never scrolls away. */
  function openDialog(member: RosterMemberRecord | null) {
    setUndoDeactivate(null);
    setUndoFailed(false);
    setEditing(member);
    setFormType(member?.attendeeType ?? "YOUTH");
    setFormBirthDate("");
    setNotice("");
    setError("");
    setFieldErrors({});
    setGuardianErrors({});
    setDialogDirty(false);
    setDialogOpen(true);
    // Re-read this member's guardians as the dialog opens, so a page left open
    // can't save over a co-leader's newer edit (#510). Until the answer is
    // in, the guardian fields are read-only and a save is held back.
    const token = ++guardianLoadToken.current;
    if (canEditGuardians && member) {
      setGuardianState("loading");
      fetch(`${base}${yearQuery}`, { cache: "no-store" })
        .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => ({})) as RosterResponse }))
        .then(({ ok, body }) => {
          if (token !== guardianLoadToken.current) return;
          if (ok && body.guardians) {
            setGuardianMap(body.guardians);
            setGuardianRev((current) => current + 1);
            setGuardianState("ready");
          } else {
            setGuardianState("failed");
          }
        })
        .catch(() => {
          if (token === guardianLoadToken.current) setGuardianState("failed");
        });
    } else {
      setGuardianState("ready");
    }
  }

  const today = calendarDateInEventTimeZone(new Date(), "America/Chicago");
  const typeHint = formBirthDate
    ? attendeeTypeAgeHint(formType as keyof typeof clubRosterAttendeeTypeLabels, formBirthDate, today)
    : null;
  const [nameDirection, setNameDirection] = useState<SortDirection>("asc");
  const active = members.filter((member) => member.status === "ACTIVE");
  const needBirthDates = active.filter((member) => member.birthDateNeeded).length;
  const notInCompliance = complianceStatuses
    ? active.filter((member) => complianceStatuses[member.id]?.state === "NOT_COMPLIANT").length
    : 0;
  const expiringSoon = complianceStatuses
    ? active.filter((member) => complianceStatuses[member.id]?.state === "FLAGGED").length
    : 0;
  /** The people the page is about: the same authorized club/year list the counts, the filters and the rows all start from. */
  const population = showInactive ? members : active;
  const complianceFilterOn = Boolean(complianceFilter && complianceStatuses);
  const { visible, needDetailsCount } = applyRosterFilters(population, {
    query,
    detailsOnly,
    keepForCompliance: complianceFilter && complianceStatuses
      ? (member) => complianceStatuses[member.id]?.state === complianceFilterState[complianceFilter]
      : null,
  });
  const filtersActive = query.trim() !== "" || detailsOnly || complianceFilterOn;
  const resultText = `${visible.length} of ${population.length} ${population.length === 1 ? "person" : "people"} shown${detailsOnly ? ", Details needed" : ""}${query.trim() ? `, name contains ${query.trim()}` : ""}`;
  function clearFilters() {
    const cleared = clearedRosterFilters();
    // One history entry for the whole clearing, so Back brings every filter back; the address no longer says what the page is not showing.
    writeAddressParams({ q: null, filter: null, compliance: null }, "push");
    search.setValue(cleared.query);
    setDetailsRaw("");
    setComplianceRaw("");
  }
  /** Each person's accessible name: just the name, or the name with what tells two people of that name apart. */
  const personLabels = rosterPersonLabels(members, {
    typeLabel: (member) => clubRosterAttendeeTypeLabels[member.attendeeType],
    classLabel: (member) => (member.classLevel ? clubClassLevelLabels[member.classLevel] : null),
  });
  const sections = [
    { key: "STAFF", title: "Staff", empty: filtersActive ? "No one in Staff matches." : "No staff on the roster yet.", people: sortByName(visible.filter((member) => rosterSectionOf(member.attendeeType) === "STAFF"), nameDirection) },
    { key: "MEMBERS", title: "Members", empty: filtersActive ? "No one in Members matches." : "No Pathfinders on the roster yet.", people: sortByName(visible.filter((member) => rosterSectionOf(member.attendeeType) === "MEMBERS"), nameDirection) },
  ] as const;
  /**
   * Staff and Members open and close on their own (#1305). Order of precedence: a search or filter that matches people
   * in a section opens it (so results are never hidden); otherwise the choice remembered in this browser; otherwise the
   * role default. A filter-forced open is not remembered: closing a section while filtering lasts only until the
   * filters change, and clearing them returns each section to its remembered state.
   */
  const savedChoices = useSyncExternalStore(
    subscribeSectionChoices,
    () => readSectionChoices(organizationId),
    () => "",
  );
  const remembered: Partial<Record<SectionKey, boolean>> = {};
  savedChoices.split("|").forEach((value, index) => {
    if (value === "open" || value === "closed") remembered[index === 0 ? "STAFF" : "MEMBERS"] = value === "open";
  });
  const filterSignature = `${query}|${detailsOnly}|${complianceFilter ?? ""}`;
  const [filterChoice, setFilterChoice] = useState<{ signature: string; open: Partial<Record<SectionKey, boolean>> }>({ signature: "", open: {} });
  const [hashOpen, setHashOpen] = useState<SectionKey[]>([]);
  const sectionOfPerson = useRef(new Map<string, SectionKey>());
  useEffect(() => {
    sectionOfPerson.current = new Map(sections.flatMap((section) => section.people.map((person) => [person.id, section.key] as const)));
  });
  // A link to #member-<id> opens that person's section so the row can be shown (not remembered).
  useEffect(() => {
    function openForHash() {
      const match = /^#member-(.+)$/.exec(window.location.hash);
      let id = "";
      try {
        id = match ? decodeURIComponent(match[1]!) : "";
      } catch {
        return;
      }
      const key = id ? sectionOfPerson.current.get(id) : undefined;
      if (!key) return;
      setHashOpen((current) => (current.includes(key) ? current : [...current, key]));
      window.requestAnimationFrame(() => document.getElementById(`member-${id}`)?.scrollIntoView({ block: "center" }));
    }
    openForHash();
    window.addEventListener("hashchange", openForHash);
    return () => window.removeEventListener("hashchange", openForHash);
  }, []);
  function sectionIsOpen(section: { key: SectionKey; people: readonly unknown[] }) {
    return rosterSectionOpen({
      filtersActive,
      matchCount: section.people.length,
      filterChoice: filterChoice.signature === filterSignature ? filterChoice.open[section.key] : undefined,
      hashTarget: hashOpen.includes(section.key),
      remembered: remembered[section.key],
      startClosed: sectionsStartClosed,
    });
  }
  function sectionToggled(section: { key: SectionKey; people: readonly unknown[] }, open: boolean) {
    if (open === sectionIsOpen(section)) return;
    if (filtersActive && section.people.length > 0) {
      setFilterChoice((current) => ({ signature: filterSignature, open: { ...(current.signature === filterSignature ? current.open : {}), [section.key]: open } }));
      return;
    }
    setHashOpen((current) => current.filter((key) => key !== section.key));
    try {
      window.localStorage.setItem(rosterSectionStorageKey(organizationId, section.key), open ? "open" : "closed");
    } catch {
      // Storage is blocked: the choice is not remembered, and the section keeps the state the browser gave it.
    }
    sectionChoiceListeners.forEach((listener) => listener());
  }
  /** The Health link's words and status; its accessible name starts with exactly these. */
  const healthLinkText = (id: string) => `${healthEntryOnly ? "Enter health record" : "Health record"}${healthTab?.[id]?.status === "NEEDS_UPDATE" ? ": needs update" : healthTab?.[id]?.status === "NONE" ? ": none yet" : ""}`;
  const renderedOrder = sections.flatMap((section) => section.people.map((person) => person.id));
  /** Where focus goes when the row it was on leaves the list (saved out of the filter, removed): the next row's Edit, else the result line. */
  const focusRequest = useRef<{ id: string; order: string[] } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  // After a result message, the message (or its Undo) takes focus and scrolls into view; a row Edit button only when there is none.
  const messageWanted = useRef(false);
  const messageSlot = useRef<HTMLDivElement>(null);
  const [messageTick, setMessageTick] = useState(0);
  useEffect(() => {
    if (dialogOpen) return;
    if (messageWanted.current) {
      messageWanted.current = false;
      focusRequest.current = null;
      window.requestAnimationFrame(() => {
        const slot = messageSlot.current;
        if (!slot) return;
        const target = slot.querySelector<HTMLElement>("button") ?? slot;
        // Scrolls only as far as needed, with no smooth motion, so reduced-motion settings are respected.
        target.focus();
        slot.scrollIntoView?.({ block: "nearest", behavior: "auto" });
      });
      return;
    }
    const request = focusRequest.current;
    if (!request) return;
    focusRequest.current = null;
    window.requestAnimationFrame(() => {
      const at = request.order.indexOf(request.id);
      const candidates = [...request.order.slice(at + 1), ...request.order.slice(0, Math.max(at, 0)).reverse()];
      for (const id of candidates) {
        const edit = document.getElementById(`roster-edit-${id}`);
        // A row inside a closed section can't take focus; try the next one, else the result line.
        if (edit && edit.closest("details")?.open !== false) {
          edit.focus();
          return;
        }
      }
      document.getElementById("roster-result-text")?.focus();
    });
  }, [focusTick, messageTick, dialogOpen]);
  /** After a change to one person: if they no longer belong in the filtered list, say so and keep focus on the page, not on a row that is gone. */
  function rowChanged(member: RosterMemberRecord, updated: RosterMemberRecord[] | undefined, lead: string, explain: boolean) {
    if (!updated) return;
    const next = updated.find((person) => person.id === member.id);
    const stillShown = Boolean(next)
      && (showInactive || next!.status === "ACTIVE")
      && (!complianceFilter || !complianceStatuses || complianceStatuses[member.id]?.state === complianceFilterState[complianceFilter])
      && applyRosterFilters([next!], { query, detailsOnly, keepForCompliance: null }).visible.length === 1;
    if (stillShown) return;
    focusRequest.current = { id: member.id, order: renderedOrder };
    setFocusTick((tick) => tick + 1);
    if (!explain) return;
    const name = `${member.firstName} ${member.lastName}`;
    const reason = next && next.status === "INACTIVE" && !showInactive
      ? "is now inactive and hidden from this list."
      : next && detailsOnly && !rosterDetailsNeeded(next)
        ? "no longer needs details."
        : "no longer matches the current search or filters.";
    setNotice(`${lead} ${name} ${reason}`);
  }
  /** The columns this viewer's table has: only what their role gets today, with the secondary ones opt-in. */
  const columns = rosterColumns({
    birthDatesShown: Boolean(birthDates),
    showGender,
    hasScreening: Boolean(complianceStatuses),
    hasRowActions: !readOnly || canEditGuardians || showHonors,
  });

  async function call(url: string, method: string, body: unknown, success: string, keepMessage = false) {
    setSaving(true);
    setError("");
    setConnectionLost(false);
    // Undo keeps its message on screen (showing "Undoing…") until the answer comes back.
    if (!keepMessage) {
      setNotice("");
      setUndoDeactivate(null);
      setUndoFailed(false);
    }
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as RosterResponse;
      if (!response.ok) {
        throw new Error(result.message ?? result.issues?.[0]?.message ?? "The roster could not be updated.");
      }
      if (result.members) setMembers(result.members);
      if (result.guardians) setGuardianMap(result.guardians);
      if (success) {
        setNotice(success);
      }
      return result;
    } catch (caught) {
      if (caught instanceof TypeError) {
        // fetch rejects with a TypeError when the request is blocked or the connection drops (#1445).
        setConnectionLost(true);
        setError(notSavedMessage("the connection was lost or blocked. Reload to see the current list, then try again."));
      } else {
        setError(notSavedMessage(caught instanceof Error ? caught.message : "The roster could not be updated."));
      }
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (contactsOnlyDialog) {
      await saveContactsOnly(formElement, form);
      return;
    }
    const birthDate = String(form.get("birthDate") ?? "");
    const attendeeType = String(form.get("attendeeType") ?? "YOUTH");
    // Inline, per-field errors (#571 F-26) instead of only the browser tooltip.
    const errors = validateRosterForm({
      firstName: String(form.get("firstName") ?? ""),
      lastName: String(form.get("lastName") ?? ""),
      birthDate,
      birthDateText: String(form.get("birthDateText") ?? ""),
      gender: String(form.get("gender") ?? ""),
      editing: Boolean(editing),
    });
    setFieldErrors(errors);
    // Emergency contacts (#510): every member, two slots, every field optional; only email and phone format are checked.
    if (canEditGuardians && guardianState === "loading") {
      setError("Still loading this person's emergency contacts. Try again in a moment.");
      return;
    }
    const guardianSlots = canEditGuardians && guardianState === "ready"
      ? Array.from({ length: GUARDIAN_SLOTS }, (_, index) => ({
        name: String(form.get(`g${index + 1}Name`) ?? "").trim(),
        relationship: String(form.get(`g${index + 1}Relationship`) ?? "").trim(),
        email: String(form.get(`g${index + 1}Email`) ?? "").trim(),
        phone: String(form.get(`g${index + 1}Phone`) ?? "").trim(),
      }))
      : null;
    const guardianProblems = guardianSlots ? validateGuardianForm(guardianSlots, (editing ? guardianMap?.[editing.id] : undefined) ?? []) : {};
    setGuardianErrors(guardianProblems);
    const memberProblems = [
      ...rosterFormFieldOrder.filter((field) => errors[field]).map((field) => ({
        targetId: field === "birthDate" ? "birthDate-input" : `roster-${field}`,
        message: summaryMessage(rosterFieldLabels[field], errors[field] as string),
      })),
      ...guardianErrorItems(guardianProblems),
    ];
    if (memberProblems.length > 0) {
      showMember(memberProblems);
      return;
    }
    clearMember();
    const details = {
      firstName: String(form.get("firstName") ?? ""),
      lastName: String(form.get("lastName") ?? ""),
      attendeeType,
      role: String(form.get("role") ?? ""),
      classLevel: String(form.get("classLevel") ?? "") || null,
      gender: String(form.get("gender") ?? "") || null,
      ...(guardianSlots ? { guardians: guardianSlots } : {}),
    };
    const result = editing
      ? await call(`${base}/${encodeURIComponent(editing.id)}`, "PATCH", {
        ...details,
        ...(birthDate ? { birthDate } : {}),
      }, savedMessage())
      : await call(base, "POST", { ...details, birthDate }, "Added to the roster. Next: they can be chosen when the club registers for an event.");
    if (editing) rowChanged(editing, result?.members, savedMessage(), true);
    if (result) {
      setBirthDates(null);
      formElement.reset();
      closeDialog();
    }
  }

  /** Next year's row (#959): only the emergency contacts are validated and sent. */
  async function saveContactsOnly(formElement: HTMLFormElement, form: FormData) {
    if (!editing) return;
    if (guardianState !== "ready") {
      setError(guardianState === "loading"
        ? "Still loading this person's emergency contacts. Try again in a moment."
        : "This person's emergency contacts could not be loaded, so nothing was saved. Close this and try again.");
      return;
    }
    const slots = Array.from({ length: GUARDIAN_SLOTS }, (_, index) => ({
      name: String(form.get(`g${index + 1}Name`) ?? "").trim(),
      relationship: String(form.get(`g${index + 1}Relationship`) ?? "").trim(),
      email: String(form.get(`g${index + 1}Email`) ?? "").trim(),
      phone: String(form.get(`g${index + 1}Phone`) ?? "").trim(),
    }));
    const problems = validateGuardianForm(slots, guardianMap?.[editing.id] ?? []);
    setGuardianErrors(problems);
    const contactProblems = guardianErrorItems(problems);
    if (contactProblems.length > 0) {
      showMember(contactProblems);
      return;
    }
    clearMember();
    const result = await call(`${base}/${encodeURIComponent(editing.id)}${yearQuery}`, "PATCH", { guardians: slots }, savedMessage());
    if (result) closeDialog();
  }

  async function setStatus(member: RosterMemberRecord, status: "ACTIVE" | "INACTIVE", keepMessage = false) {
    return call(`${base}/${encodeURIComponent(member.id)}`, "PATCH", { status },
      status === "INACTIVE" ? `Deactivated ${member.firstName} ${member.lastName}.` : `Reactivated ${member.firstName} ${member.lastName}.`, keepMessage);
  }

  /** Undo for a deactivation: the same reactivate call the dialog already makes. */
  async function undoStatusChange(member: RosterMemberRecord) {
    const result = await setStatus(member, "ACTIVE", true);
    if (result) setUndoDeactivate(null);
    // A failure keeps Undo on offer (next to this error only) so it can be tried again; either way the message takes focus.
    setUndoFailed(!result);
    messageWanted.current = true;
    setMessageTick((tick) => tick + 1);
  }

  /** Deactivate/reactivate lives in the edit dialog now (#424), with a confirmation there. */
  async function confirmSetStatus(member: RosterMemberRecord) {
    const next = member.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    const verb = next === "INACTIVE" ? "Deactivate" : "Reactivate";
    // The status change closes the editor, so unsaved edits typed here would be lost: say so (#1101).
    const hasUnsavedEdits = editorIsDirty();
    const confirmed = await askConfirm({
      title: `${verb} ${member.firstName} ${member.lastName}`,
      body: (
        <>
          <p>{next === "INACTIVE" ? "They stay on file but are left out of new registrations until reactivated." : "They are available for registrations again."}</p>
          {hasUnsavedEdits && <p><strong>You have unsaved changes. Save them first, or they will be discarded.</strong></p>}
        </>
      ),
      confirmLabel: `${verb} ${member.firstName} ${member.lastName}`,
      destructive: next === "INACTIVE",
    });
    if (!confirmed) return;
    const result = await setStatus(member, next);
    rowChanged(member, result?.members, next === "INACTIVE" ? "Deactivated." : "Reactivated.", true);
    if (result && next === "INACTIVE") {
      setUndoDeactivate(member);
      // Undo is on offer, so the message takes focus and scrolls into view; other saves keep the Edit-button focus path.
      messageWanted.current = true;
      setMessageTick((tick) => tick + 1);
    }
    if (result) closeDialog();
  }

  async function remove(member: RosterMemberRecord, label: string) {
    const confirmed = await askConfirm({
      // Two people can share a name, so the title and the button also carry what tells them apart.
      title: `Remove ${member.firstName} ${member.lastName} from the roster${rosterLabelDetail(label, member)}`,
      body: <p>Their birth date and details are erased. This can&apos;t be undone. To keep them on file, mark them inactive instead.</p>,
      confirmLabel: `Remove ${label}`,
      destructive: true,
    });
    if (!confirmed) return;
    const result = await call(`${base}/${encodeURIComponent(member.id)}`, "DELETE", { confirm: true }, "Removed and erased.");
    rowChanged(member, result?.members, "Removed and erased.", false);
    if (result?.nameKept) setNotice("Removed and erased. Their name stays on items already ordered.");
  }

  async function revealBirthDates() {
    const result = await call(birthDatesEndpoint ?? `${base}/birth-dates`, "POST", {}, "");
    if (result?.birthDates) setBirthDates(result.birthDates);
  }

  return (
    <div className="club-roster-stack">
      {confirmDialog}
      {/* The page's one message slot; while the dialog is open its own slot (inside the dialog) shows errors. */}
      <div id="roster-message-slot" ref={messageSlot} tabIndex={-1}>
        {error && !dialogOpen
          ? <FormMessage message={error} tone="error" undo={undoDeactivate && undoFailed ? { busy: saving, onUndo: () => void undoStatusChange(undoDeactivate) } : undefined} />
          : notice
            ? <FormMessage message={notice} tone="success" undo={undoDeactivate ? { busy: saving, onUndo: () => void undoStatusChange(undoDeactivate) } : undefined} />
            : null}
        {/* A blocked or dropped request: the list on screen may be out of date, so offer Reload in the same slot (#1445). */}
        {error && !dialogOpen && connectionLost && <ReloadButton />}
      </div>

      <section className="public-manage-card">
        <div className="public-manage-card-heading club-roster-heading">
          <div>
            <p className="public-registration-eyebrow">{`Club year ${clubYear}`}</p>
            <h2 id="club-roster-heading">Roster</h2>
          </div>
          <div className="club-roster-heading-actions">
            <span className="count-badge">{`${active.length} active`}</span>
            {!readOnly && (
              <button className="primary-button" disabled={saving} onClick={() => openDialog(null)} type="button">
                <Plus aria-hidden="true" size={16} /> Add to roster
              </button>
            )}
            {!readOnly && headingActions}
          </div>
        </div>
        {needBirthDates > 0 && (
          <p className="inline-notice roster-birth-date-notice" role="status">
            {needBirthDates === 1 ? "1 person needs" : `${needBirthDates} people need`} a birth date. The age from the
            registration form is shown until {readOnly ? "the club adds one." : "you add one; edit each person to add it."}
          </p>
        )}
        {complianceStatuses && (notInCompliance > 0 || expiringSoon > 0) && (
          <p className="inline-notice roster-compliance-notice" role="status">
            {notInCompliance} adult{notInCompliance === 1 ? "" : "s"} not in compliance with Sterling Volunteers
            {expiringSoon > 0 && ` · ${expiringSoon} expiring soon`}
          </p>
        )}
        {complianceFilter && complianceStatuses && (
          <p className="inline-notice roster-compliance-notice" role="status">
            Showing only people {complianceFilterLabels[complianceFilter]}.{" "}
            <button className="text-button" onClick={clearFilters} type="button">Clear filters</button>
          </p>
        )}
        <div className={styles.rosterSearchPanel}>
          <div className={styles.rosterSearchRow}>
            <div className={styles.rosterSearchField}>
              <label htmlFor="roster-search">Search roster</label>
              <span className={`search-field ${styles.rosterSearchInput}`} onMouseDown={focusSearchInput}>
                <Search aria-hidden="true" size={16} />
                <input
                  autoComplete="off"
                  id="roster-search"
                  {...search.inputProps}
                  placeholder="Find a person by name"
                  type="search"
                />
                <SearchClearButton onClear={() => search.setValue("")} visible={search.value !== ""} />
              </span>
            </div>
            <div className={styles.rosterFilterButtons}>
              <button
                aria-describedby="roster-details-help"
                aria-pressed={detailsOnly}
                className={`secondary-button ${styles.rosterFilterButton}`}
                onClick={() => setDetailsRaw(detailsOnly ? "" : ROSTER_DETAILS_NEEDED_FILTER)}
                type="button"
              >
                Details needed <span className="count-badge">{needDetailsCount}</span>
              </button>
              <button
                aria-pressed={showGender}
                className={`secondary-button ${styles.rosterFilterButton}`}
                onClick={() => setShowGender((current) => !current)}
                type="button"
              >
                Show gender
              </button>
            </div>
          </div>
          <p className="field-help" id="roster-details-help">
            Details needed lists people missing a gender, current class, role or type. Each row says what to add.
          </p>
          <div className={styles.rosterResultLine}>
            <p id="roster-result-text" tabIndex={-1}>
              <strong>{`${visible.length} of ${population.length}`}</strong> {population.length === 1 ? "person" : "people"} shown
              {detailsOnly ? " · Details needed" : ""}{query.trim() ? ` · Name contains "${query.trim()}"` : ""}
            </p>
            {/* The same result for screen readers; it follows the search term, which settles once typing pauses. */}
            <p aria-live="polite" className="sr-only" role="status">{resultText}</p>
            {filtersActive && (
              <button className="text-button" onClick={clearFilters} type="button">Clear filters</button>
            )}
          </div>
        </div>
        <div className="club-roster-tools club-roster-toolbar">
          <label className="checkbox-label">
            <input checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} type="checkbox" />
            Show inactive people
          </label>
          {!readOnly && (
            <span className="roster-csv-actions">
              <RosterCsvImport
                base={base}
                onImported={(updated, message) => {
                  setMembers(updated);
                  setBirthDates(null);
                  setNotice(message);
                }}
              />
            </span>
          )}
          {!canSeeBirthDates ? null : birthDates ? (
            <button className="text-button" onClick={() => setBirthDates(null)} type="button">
              <Eye aria-hidden="true" size={14} /> Hide birth dates
            </button>
          ) : (
            <button className="text-button" disabled={saving || members.length === 0} onClick={revealBirthDates} type="button">
              <Eye aria-hidden="true" size={14} /> Show birth dates
            </button>
          )}
        </div>
        {population.length === 0 ? (
          <EmptyState
            className="empty-state public-manage-empty"
            hint={readOnly ? "A club director adds people to the roster." : undefined}
            icon={<UsersRound size={17} aria-hidden="true" />}
            title="No one is on the roster yet"
          >
            {readOnly
              ? "This club's roster has no one on it yet."
              : "Add regular members one at a time or import a CSV. You can add event-only guests when registering."}
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState
            action={{ label: "Clear filters", onClick: clearFilters }}
            actionClass="secondary-button"
            announce={false}
            canCreate
            className="empty-state public-manage-empty"
            icon={<Search size={17} aria-hidden="true" />}
            title={complianceFilterOn && !query.trim() && !detailsOnly ? "No one matches this filter" : "No one matches these filters"}
          >
            {complianceFilterOn
              ? "Clear the filters, or choose a different Sterling Volunteers filter, to see the rest of the roster."
              : "Check the spelling, or clear the filters to see everyone on the roster."}
          </EmptyState>
        ) : (
          <div className={styles.sections}>
            {/*
              One table per section inside a native <details> (#1305): a details element can't live inside a table, and a
              closed section should take no room. The columns of the two tables size independently (some drift between them is
              accepted). The summary is the section heading and names its table. Both tables keep the sortable Name header, so sorting works from whichever is open.
            */}
            <SortOrderNote>{`${sortOrderText(nameSortLabel, nameDirection)} Staff and Members are listed separately.`}</SortOrderNote>
            {sections.map((section) => (
              <details
                className={styles.section}
                data-roster-section={section.key}
                key={section.key}
                onToggle={(event) => sectionToggled(section, event.currentTarget.open)}
                open={sectionIsOpen(section)}
              >
                <summary className={styles.summary}>
                  <ChevronDown aria-hidden="true" className={styles.chevron} size={16} />
                  <span id={`roster-section-${section.key.toLowerCase()}-title`}>{section.title}</span>{" "}
                  <span className="count-badge">{section.people.length}</span>
                </summary>
                {section.people.length === 0 ? (
                  <p className={styles.empty}>{section.empty}</p>
                ) : (
                  <div className="report-table-wrap scroll-cue card-box" data-scroll-cue>
                    <table aria-labelledby={`roster-section-${section.key.toLowerCase()}-title`} className="report-table roster-card-table">
                      <thead>
                        <tr>
                          {columns.map((column) => {
                            switch (column) {
                              case "name": return <SortableHeader active direction={nameDirection} key={column} hiddenLabel={section.title} label="Name" onSort={() => setNameDirection(flipDirection(nameDirection))} />;
                              case "age": return <th key={column}>Age</th>;
                              case "birthDate": return <th key={column}>Birth date</th>;
                              case "type": return <th key={column}>Type</th>;
                              case "class": return <th key={column}>Current class</th>;
                              case "details": return <th key={column}>Details</th>;
                              case "gender": return <th key={column}>Gender</th>;
                              case "screening": return <th key={column}>Sterling Volunteers</th>;
                              case "actions": return <th key={column}>Actions</th>;
                            }
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {section.people.map((member) => {
                        // The birth-date banner above the table already counts an active person's missing birth date, so the row
                        // names only what else is missing (#1004); the Details needed list follows the same rule.
                        const needs = rosterDetailsNeededItems(member);
                        const label = personLabels.get(member.id) ?? `${member.firstName} ${member.lastName}`;
                        const healthOnFile = Boolean(healthTab && healthEntryOnly && (healthTab[member.id]?.status === "CURRENT" || healthTab[member.id]?.status === "NEEDS_UPDATE"));
                        const tools = rosterRowTools({
                          readOnly,
                          canEditContacts: canEditGuardians,
                          hasHonors: showHonors,
                          hasHealthLink: Boolean(healthTab) && !healthOnFile,
                          hasHealthOnFileNote: healthOnFile,
                        });
                        const honorsControl = (
                          <>
                            {honorsHref && !honorsPopup && (
                              <a
                                aria-label={`Honors for ${label}`}
                                className={tools.honorsButton ? "secondary-button roster-honors-button" : undefined}
                                href={honorsHref}
                              >
                                <Award aria-hidden="true" size={14} /> Honors
                              </a>
                            )}
                            {honorsPopup && (
                              <button
                                aria-haspopup="dialog"
                                aria-label={`Honors for ${label}`}
                                className={tools.honorsButton ? "secondary-button roster-honors-button" : undefined}
                                onClick={() => setHonorsFor(member)}
                                type="button"
                              >
                                <Award aria-hidden="true" size={14} /> Honors
                              </button>
                            )}
                          </>
                        );
                        return (
                          <tr id={`member-${member.id}`} key={member.id}>
                            {columns.map((column) => {
                              switch (column) {
                                case "name": return (
                                  <td className="roster-card-name" data-label="Name" key={column}>
                                    <strong className={styles.rosterMemberName} translate="no">{member.lastName}, {member.firstName}</strong>
                                    {member.role && <span className={styles.rosterMemberRole}>{`Role: ${member.role}`}</span>}
                                    {classHistoryBase && member.personId && (
                                      <Link className="text-button roster-class-history-link" href={`${classHistoryBase}/${encodeURIComponent(member.personId)}`}>
                                        Class history<span className="sr-only">{` for ${label}`}</span>
                                      </Link>
                                    )}
                                  </td>
                                );
                                case "age": return (
                                  <td data-label="Age" key={column}>
                                    {member.age ?? (member.reportedAge !== null ? `${member.reportedAge} (reported)` : "—")}
                                  </td>
                                );
                                case "birthDate": return <td data-label="Birth date" key={column} translate="no">{birthDates?.[member.id] ?? "—"}</td>;
                                case "type": return <td data-label="Type" key={column}>{clubRosterAttendeeTypeLabels[member.attendeeType]}</td>;
                                case "class": return <td data-label="Current class" key={column}>{member.classLevel ? clubClassLevelLabels[member.classLevel] : "—"}</td>;
                                case "details": return (
                                  <td className="roster-card-flags" data-label="Details" key={column}>
                                    {/* The flex layout lives on this wrapper: a td that is itself flex stops being a table cell and drifts out of line (#435). */}
                                    <div className="roster-flag-list">
                                      {member.status === "INACTIVE" && (
                                        <span className="status-chip gold">{clubRosterStatusLabels.INACTIVE}</span>
                                      )}
                                      {needs.length > 0 && (
                                        <span className={`status-chip gold ${styles.rosterNeedsDetails}`}>{rosterDetailsSummary(needs)}</span>
                                      )}
                                      {healthRecordFlags?.[member.id] && (
                                        <span className="status-chip">Has a health record</span>
                                      )}
                                      {member.status === "ACTIVE" && needs.length === 0 && !healthRecordFlags?.[member.id] && (
                                        <>
                                          <span aria-hidden="true">—</span>
                                          <span className="sr-only">Nothing needed</span>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                );
                                case "gender": return <td data-label="Gender" key={column}>{member.gender ? clubRosterGenderLabels[member.gender] : "—"}</td>;
                                case "screening": return (
                                  <td data-label="Sterling Volunteers" key={column}>
                                    {complianceStatuses?.[member.id] ? (
                                      <>
                                        <span className={`status-chip ${complianceTone[complianceStatuses[member.id]!.state]}`}>
                                          {complianceLabel(complianceStatuses[member.id]!)}
                                        </span>
                                        {complianceStatuses[member.id]!.note && (
                                          <small className="quiet-copy background-check-note"> {complianceStatuses[member.id]!.note}</small>
                                        )}
                                        {(complianceStatuses[member.id]!.reasons ?? []).length > 0 && (
                                          <small className="quiet-copy background-check-note">
                                            <br />{complianceStatuses[member.id]!.reasons!.join("; ")}
                                          </small>
                                        )}
                                      </>
                                    ) : "—"}
                                  </td>
                                );
                                case "actions": return (
                                  <td className="roster-card-actions roster-row-actions" data-label="Actions" key={column}>
                                    <div className={`${styles.rosterRowActionSet} roster-row-action-set`}>
                                      {tools.primary === "edit" && (
                                        <button aria-label={`Edit ${label}`} className={`secondary-button ${styles.rosterEditButton}`} disabled={saving} id={`roster-edit-${member.id}`} onClick={() => openDialog(member)} type="button">
                                          <Pencil aria-hidden="true" size={14} /> Edit
                                        </button>
                                      )}
                                      {tools.primary === "contacts" && (
                                        <button aria-label={`Emergency contacts for ${label}`} className={`secondary-button ${styles.rosterEditButton}`} disabled={saving} id={`roster-edit-${member.id}`} onClick={() => openDialog(member)} type="button">
                                          <Pencil aria-hidden="true" size={14} /> Emergency contacts
                                        </button>
                                      )}
                                      {tools.honorsButton && honorsControl}
                                      {tools.menu.length > 0 && (
                                        <ActionsMenu ariaLabel={`Actions for ${label}`}>
                                          {tools.menu.includes("honors") && <li>{honorsControl}</li>}
                                          {tools.menu.includes("health") && healthTab && (
                                            <li>
                                              <a
                                                aria-label={`${healthLinkText(member.id)}, ${label}`}
                                                href={`/account/clubs/${encodeURIComponent(organizationId)}/roster/${encodeURIComponent(member.id)}/health`}
                                              >
                                                {healthLinkText(member.id)}
                                              </a>
                                            </li>
                                          )}
                                          {tools.menu.includes("healthOnFile") && (
                                            <li className={styles.actionsMenuNote}>A health record is on file; the director or a deputy can update it.</li>
                                          )}
                                          {tools.menu.includes("remove") && (
                                            <li className="actions-menu-divider">
                                              <button aria-label={`Remove ${label}`} className="actions-menu-danger" disabled={saving} onClick={() => remove(member, label)} type="button">
                                                <Trash2 aria-hidden="true" size={14} /> Remove
                                              </button>
                                            </li>
                                          )}
                                        </ActionsMenu>
                                      )}
                                    </div>
                                  </td>
                                );
                              }
                            })}
                          </tr>
                        );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            ))}
          </div>
        )}
      </section>

      {dialogOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) void requestClose(); }} role="presentation">
      <section aria-labelledby="roster-dialog-title" aria-modal="true" className="modal-card roster-dialog" ref={dialogRef} role="dialog" tabIndex={-1}>
      <form
        ref={formRef}
        className="form-stack"
        key={editing?.id ?? "new"}
        noValidate
        // Adding or removing a contact changes the form without an input event, so look again after any click once it has rendered.
        onClick={() => window.requestAnimationFrame(() => setDialogDirty(editorIsDirty()))}
        onInput={(event) => {
          setDialogDirty(editorIsDirty());
          const name = (event.target as HTMLInputElement).name;
          const field = (name === "birthDateText" ? "birthDate" : name) as RosterFormField;
          setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
          // The changed field's summary item goes with its message (the summary hides when it empties).
          clearMemberField((event.target as HTMLElement).id);
          if (name in guardianErrors) setGuardianErrors((current) => ({ ...current, [name]: undefined }));
        }}
        onSubmit={save}
      >
        <div className="modal-head">
          <div>
            <p className="public-registration-eyebrow">{editing ? "Edit" : "Add someone"}</p>
            <h2 id="roster-dialog-title" translate={editing ? "no" : undefined}>{editing ? `${editing.firstName} ${editing.lastName}` : "Add to the roster"}</h2>
          </div>
          <button aria-label="Close" className="icon-button modal-close-button" onClick={() => void requestClose()} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        {memberItems.length > 0 && <FormErrorSummary items={memberItems} ref={memberRef} />}
        {contactsOnlyDialog ? (
          <p className="field-help">Next year&apos;s roster. Only emergency contacts can be changed here; the rest of this person&apos;s details are edited once the club year starts.</p>
        ) : (
        <div className="form-grid two-column">
          <label>
            First name
            <input {...fieldErrorProps("roster-firstName-error", fieldErrors.firstName)} autoComplete="off" defaultValue={editing?.firstName ?? ""} id="roster-firstName" maxLength={80} name="firstName" required />
            <FieldError id="roster-firstName-error">{fieldErrors.firstName}</FieldError>
          </label>
          <label>
            Last name
            <input {...fieldErrorProps("roster-lastName-error", fieldErrors.lastName)} autoComplete="off" defaultValue={editing?.lastName ?? ""} id="roster-lastName" maxLength={80} name="lastName" required />
            <FieldError id="roster-lastName-error">{fieldErrors.lastName}</FieldError>
          </label>
          <BirthDateField
            defaultValue={editing && birthDates ? birthDates[editing.id] ?? "" : ""}
            label={editing && !editing.birthDateNeeded ? "Birth date (leave blank to keep)" : "Birth date"}
            error={fieldErrors.birthDate}
            name="birthDate"
            onParsedChange={setFormBirthDate}
            required={!editing}
          />
          <label>
            Type
            <select aria-describedby="roster-type-hint roster-type-definitions" defaultValue={editing?.attendeeType ?? "YOUTH"} name="attendeeType" onChange={(event) => setFormType(event.target.value)}>
              {Object.entries(clubRosterAttendeeTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className="roster-type-help">
            <RosterTypeDefinitions className="field-help" id="roster-type-definitions" />
            <p className="field-help roster-type-hint" id="roster-type-hint" role="status">{typeHint ?? ""}</p>
          </div>
          <label>
            Current class
            <select defaultValue={editing?.classLevel ?? ""} name="classLevel">
              <option value="">None</option>
              {Object.entries(clubClassLevelLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            Role (optional)
            {/* Left blank, youth save as "Pathfinder"; staff and adults stay blank (#424). */}
            <input defaultValue={editing?.role ?? ""} maxLength={60} name="role" placeholder={defaultRosterRole(formType)} />
          </label>
          <label>
            Gender
            <select {...fieldErrorProps("roster-gender-error", fieldErrors.gender)} defaultValue={editing?.gender ?? ""} id="roster-gender" name="gender" required>
              <option disabled value="">Choose one</option>
              {Object.entries(clubRosterGenderLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <FieldError id="roster-gender-error">{fieldErrors.gender}</FieldError>
          </label>
        </div>
        )}
        {canEditGuardians && (
          <RosterGuardianFields
            errors={guardianErrors}
            guardianState={guardianState}
            key={`${editing?.id ?? "new"}-${guardianRev}`}
            records={editing ? guardianMap?.[editing.id] : undefined}
          />
        )}
        {!contactsOnlyDialog && <p className="field-help">
          Birth dates are encrypted and shown only to your club&apos;s director and deputy. Registrars and event
          staff see age only. Don&apos;t enter medical or insurance information here.
        </p>}
        <div className="form-actions">
          {editing && !contactsOnlyDialog && (
            <button
              className="secondary-button roster-dialog-status-action"
              disabled={saving}
              onClick={() => confirmSetStatus(editing)}
              type="button"
            >
              <Power aria-hidden="true" size={14} /> {editing.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
            </button>
          )}
          <button className="secondary-button" disabled={saving} onClick={() => void requestClose()} type="button">Cancel</button>
          <SubmitButton className="primary-button" icon={editing ? <Save aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />} label={editing ? (contactsOnlyDialog ? "Save contacts" : "Save") : "Add to roster"} submitting={saving} submittingLabel={editing ? "Saving…" : "Adding…"} />
        </div>
        {error && <FormMessage message={error} tone="error" />}
        {/* A blocked save: Reload sits right under the dialog's message, scrolled into view and focused (#1445). */}
        {error && connectionLost && (
          <div ref={dialogNoticeRef} tabIndex={-1}>
            <ReloadButton />
          </div>
        )}
      </form>
      </section>
        </div>
      )}
      {honorsFor && honorsPopup && (
        <ClubMemberHonorsDialog
          canRecord={honorsPopup.canRecord}
          member={honorsFor}
          onClose={closeHonors}
          organizationId={organizationId}
        />
      )}
    </div>
  );
}

/** The roster is a live list (rule P2, #1445): if it breaks, a message and a Reload button replace it, never a blank or stale list. */
export function ClubRosterWorkspace(props: ComponentProps<typeof ClubRosterWorkspaceInner>) {
  return (
    <LiveListBoundary listName="roster">
      <ClubRosterWorkspaceInner {...props} />
    </LiveListBoundary>
  );
}
