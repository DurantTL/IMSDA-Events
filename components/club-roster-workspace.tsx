"use client";
import { SubmitButton } from "@/components/submit-button";
import { useConfirm } from "@/components/use-confirm";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Award, Eye, Pencil, Plus, Power, Save, Search, Trash2, UsersRound, X } from "lucide-react";
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
import { RosterGuardianFields } from "@/components/roster-guardian-fields";
import {
  applyRosterFilters,
  clearedRosterFilters,
  rosterColumns,
  rosterDetailsNeededItems,
  rosterDetailsSummary,
  rosterDetailsNeeded,
  rosterLabelDetail,
  rosterPersonLabels,
  rosterRowTools,
} from "@/modules/club-rosters/roster-view";
import type { RosterMemberRecord } from "@/modules/club-rosters/repository";

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
const complianceTone = { CLEAR: "green", FLAGGED: "gold", NOT_COMPLIANT: "coral", NO_RECORD: "gold" } as const;

/** A value that follows `value` after it has stopped changing for `delay` ms, so a polite status is not re-read on every keystroke. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Takes the named filter parameters out of the address (and nothing else, so `?year=` stays), without adding a history entry. */
function dropFilterParams(...names: string[]) {
  try {
    const url = new URL(window.location.href);
    const present = names.filter((name) => url.searchParams.has(name));
    if (present.length === 0) return;
    for (const name of present) url.searchParams.delete(name);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // A page without a usable address bar (a preview) simply keeps its address.
  }
}

export function ClubRosterWorkspace({
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
  detailsNeededFirst = false,
  headingActions,
  healthTab,
  healthEntryOnly,
  healthRecordFlags,
  guardians: initialGuardians,
  guardiansOnly = false,
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
  /** `?filter=details-needed` (#1167): open with the Details needed list already on. Search and filters are never saved. */
  detailsNeededFirst?: boolean;
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
}) {
  const [members, setMembers] = useState(initialMembers);
  const showHonors = Boolean(honorsPopup || honorsHref);
  const [honorsFor, setHonorsFor] = useState<RosterMemberRecord | null>(null);
  const [editing, setEditing] = useState<RosterMemberRecord | null>(null);
  /** The type picked in the dialog, so the Role placeholder shows the blank-role default (#424). */
  const [formType, setFormType] = useState<string>("YOUTH");
  const [formBirthDate, setFormBirthDate] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [birthDates, setBirthDates] = useState<Record<string, string> | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [complianceFilter, setComplianceFilter] = useState(initialComplianceFilter);
  /** Name search, the "Details needed" list and the optional extra columns (#1167). None of them is saved or sent anywhere. */
  const [query, setQuery] = useState("");
  const [detailsOnly, setDetailsOnly] = useState(detailsNeededFirst);
  const [showGender, setShowGender] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<RosterFormErrors>({});
  const [guardianMap, setGuardianMap] = useState(initialGuardians);
  const [guardianErrors, setGuardianErrors] = useState<GuardianFormErrors>({});
  const canEditGuardians = initialGuardians !== undefined && (!readOnly || guardiansOnly);
  const contactsOnlyDialog = guardiansOnly && readOnly;
  /** Whether the dialog has this member's current guardians (#510): "failed" leaves guardians untouched on save. */
  const [guardianState, setGuardianState] = useState<"ready" | "loading" | "failed">("ready");
  const [guardianRev, setGuardianRev] = useState(0);
  const guardianLoadToken = useRef(0);
  const base = `/api/attendee/clubs/${encodeURIComponent(organizationId)}/roster`;
  /** Reads and contact saves name the year on next year's roster, so the server answers for that year (#959). */
  const yearQuery = contactsOnlyDialog ? `?year=${encodeURIComponent(clubYear)}` : "";
  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditing(null);
  }, []);
  const { confirm: askConfirm, confirmDialog } = useConfirm();
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
    setEditing(member);
    setFormType(member?.attendeeType ?? "YOUTH");
    setFormBirthDate("");
    setNotice("");
    setError("");
    setFieldErrors({});
    setGuardianErrors({});
    setDialogOpen(true);
    // Re-read this member's guardians as the dialog opens, so a page left open
    // can't save over a co-leader's newer edit (#510). Until the answer is
    // in, the guardian fields are read-only and a save is held back.
    const token = ++guardianLoadToken.current;
    if (canEditGuardians && member) {
      setGuardianState("loading");
      fetch(`${base}${yearQuery}`)
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
  const announcedResult = useDebouncedValue(resultText, 300);
  function clearFilters() {
    const cleared = clearedRosterFilters();
    setQuery(cleared.query);
    setDetailsOnly(cleared.detailsOnly);
    setComplianceFilter(cleared.complianceFilter);
    // The address no longer says what the page is not showing.
    dropFilterParams("filter", "compliance");
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
  /** The Health link's words and status; its accessible name starts with exactly these. */
  const healthLinkText = (id: string) => `${healthEntryOnly ? "Enter health record" : "Health record"}${healthTab?.[id]?.status === "NEEDS_UPDATE" ? ": needs update" : healthTab?.[id]?.status === "NONE" ? ": none yet" : ""}`;
  const renderedOrder = sections.flatMap((section) => section.people.map((person) => person.id));
  /** Where focus goes when the row it was on leaves the list (saved out of the filter, removed): the next row's Edit, else the result line. */
  const focusRequest = useRef<{ id: string; order: string[] } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    const request = focusRequest.current;
    if (!request || dialogOpen) return;
    focusRequest.current = null;
    window.requestAnimationFrame(() => {
      const at = request.order.indexOf(request.id);
      const candidates = [...request.order.slice(at + 1), ...request.order.slice(0, Math.max(at, 0)).reverse()];
      for (const id of candidates) {
        const edit = document.getElementById(`roster-edit-${id}`);
        if (edit) {
          edit.focus();
          return;
        }
      }
      document.getElementById("roster-result-text")?.focus();
    });
  }, [focusTick, dialogOpen]);
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
  const rosterColumnCount = columns.length;

  async function call(url: string, method: string, body: unknown, success: string) {
    setSaving(true);
    setError("");
    setNotice("");
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
      if (success) setNotice(success);
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The roster could not be updated.");
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
    const firstInvalid = rosterFormFieldOrder.find((field) => errors[field]);
    if (firstInvalid) {
      const target = firstInvalid === "birthDate" ? "birthDateText" : firstInvalid;
      (formElement.elements.namedItem(target) as HTMLElement | null)?.focus();
      return;
    }
    const firstGuardianProblem = Object.keys(guardianProblems)[0];
    if (firstGuardianProblem) {
      (formElement.elements.namedItem(firstGuardianProblem) as HTMLElement | null)?.focus();
      return;
    }
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
      }, "Saved.")
      : await call(base, "POST", { ...details, birthDate }, "Added to the roster. Next: they can be chosen when the club registers for an event.");
    if (editing) rowChanged(editing, result?.members, "Saved.", true);
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
    const firstProblem = Object.keys(problems)[0];
    if (firstProblem) {
      (formElement.elements.namedItem(firstProblem) as HTMLElement | null)?.focus();
      return;
    }
    const result = await call(`${base}/${encodeURIComponent(editing.id)}${yearQuery}`, "PATCH", { guardians: slots }, "Saved.");
    if (result) closeDialog();
  }

  async function setStatus(member: RosterMemberRecord, status: "ACTIVE" | "INACTIVE") {
    return call(`${base}/${encodeURIComponent(member.id)}`, "PATCH", { status },
      status === "INACTIVE" ? "Marked inactive. They stay on file." : "Marked active.");
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
    rowChanged(member, result?.members, next === "INACTIVE" ? "Marked inactive. They stay on file." : "Marked active.", true);
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
      {notice && <div className="inline-notice success" role="status">{notice}</div>}
      {error && <div className="inline-notice error" role="alert">{error}</div>}

      <section className="public-manage-card">
        <div className="public-manage-card-heading club-roster-heading">
          <div>
            <p className="public-registration-eyebrow">Club year {clubYear}</p>
            <h2 id="club-roster-heading">Roster</h2>
          </div>
          <div className="club-roster-heading-actions">
            <span className="count-badge">{active.length} active</span>
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
            <button className="text-button" onClick={() => setComplianceFilter(null)} type="button">Clear filter</button>
          </p>
        )}
        <div className="roster-search-panel">
          <div className="roster-search-row">
            <label className="roster-search-field" htmlFor="roster-search">
              Search roster
              <span className="roster-search-input">
                <Search aria-hidden="true" size={16} />
                <input
                  autoComplete="off"
                  id="roster-search"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a person by name"
                  type="search"
                  value={query}
                />
              </span>
            </label>
            <div className="roster-filter-buttons">
              <button
                aria-describedby="roster-details-help"
                aria-pressed={detailsOnly}
                className="secondary-button roster-filter-button"
                onClick={() => {
                  if (detailsOnly) dropFilterParams("filter");
                  setDetailsOnly((current) => !current);
                }}
                type="button"
              >
                Details needed <span className="count-badge">{needDetailsCount}</span>
              </button>
              <button
                aria-pressed={showGender}
                className="secondary-button roster-filter-button"
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
          <div className="roster-result-line">
            <p id="roster-result-text" tabIndex={-1}>
              <strong>{visible.length} of {population.length}</strong> {population.length === 1 ? "person" : "people"} shown
              {detailsOnly ? " · Details needed" : ""}{query.trim() ? ` · Name contains "${query.trim()}"` : ""}
            </p>
            {/* The same result for screen readers, announced once typing pauses rather than on every key. */}
            <p aria-live="polite" className="sr-only" role="status">{announcedResult}</p>
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
            action={{ label: "Add to roster", onClick: () => openDialog(null) }}
            actionClass="secondary-button"
            canCreate={!readOnly}
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
          <div className="report-table-wrap scroll-cue card-box" data-scroll-cue>
            {/*
              One table for both sections (#435), not one per section: two
              separate tables size their columns independently, so the Staff
              table's columns drift out of step with the Members table's even
              though the headings match. A single table with a full-width
              section-title row keeps every column the same width all the way
              down. What a person still needs sits in its own Details column
              rather than the Name cell (which was stretching that column unevenly).
            */}
            <SortOrderNote>{`${sortOrderText(nameSortLabel, nameDirection)} Staff and Members are listed separately.`}</SortOrderNote>
            <table aria-labelledby="club-roster-heading" className="report-table roster-card-table">
              <thead>
                <tr>
                  {columns.map((column) => {
                    switch (column) {
                      case "name": return <SortableHeader active direction={nameDirection} key={column} label="Name" onSort={() => setNameDirection(flipDirection(nameDirection))} />;
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
              {/* One row group per section, so each section heading covers only its own rows. */}
                {sections.map((section) => (
                  <tbody key={section.key}>
                    <tr className="roster-section-row">
                      <th className="roster-section-heading" colSpan={rosterColumnCount} scope="rowgroup">
                        {section.title} <span className="count-badge">{section.people.length}</span>
                      </th>
                    </tr>
                    {section.people.length === 0 ? (
                      <tr className="roster-section-empty-row">
                        <td colSpan={rosterColumnCount}>{section.empty}</td>
                      </tr>
                    ) : (
                      section.people.map((member) => {
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
                                    <strong className="roster-member-name" translate="no">{member.lastName}, {member.firstName}</strong>
                                    {member.role && <span className="roster-member-role" translate="no">{`Role: ${member.role}`}</span>}
                                    {classHistoryBase && member.personId && (
                                      <Link className="text-button roster-class-history-link" href={`${classHistoryBase}/${encodeURIComponent(member.personId)}`}>
                                        Class history<span className="sr-only"> for {label}</span>
                                      </Link>
                                    )}
                                  </td>
                                );
                                case "age": return (
                                  <td data-label="Age" key={column} translate="no">
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
                                        <span className="status-chip gold roster-needs-details">{rosterDetailsSummary(needs)}</span>
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
                                    <div className="roster-row-action-set">
                                      {tools.primary === "edit" && (
                                        <button aria-label={`Edit ${label}`} className="secondary-button roster-edit-button" disabled={saving} id={`roster-edit-${member.id}`} onClick={() => openDialog(member)} type="button">
                                          <Pencil aria-hidden="true" size={14} /> Edit
                                        </button>
                                      )}
                                      {tools.primary === "contacts" && (
                                        <button aria-label={`Emergency contacts for ${label}`} className="secondary-button roster-edit-button" disabled={saving} id={`roster-edit-${member.id}`} onClick={() => openDialog(member)} type="button">
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
                                            <li className="actions-menu-note">A health record is on file; the director or a deputy can update it.</li>
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
                      })
                    )}
                  </tbody>
                ))}
            </table>
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
        onInput={(event) => {
          const name = (event.target as HTMLInputElement).name;
          const field = (name === "birthDateText" ? "birthDate" : name) as RosterFormField;
          setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
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
        {error && <div className="inline-notice error" role="alert">{error}</div>}
        {contactsOnlyDialog ? (
          <p className="field-help">Next year&apos;s roster. Only emergency contacts can be changed here; the rest of this person&apos;s details are edited once the club year starts.</p>
        ) : (
        <div className="form-grid two-column">
          <label>
            First name
            <input aria-describedby={fieldErrors.firstName ? "roster-firstName-error" : undefined} aria-invalid={fieldErrors.firstName ? true : undefined} autoComplete="off" defaultValue={editing?.firstName ?? ""} maxLength={80} name="firstName" required />
            {fieldErrors.firstName && <span className="roster-field-error" id="roster-firstName-error" role="alert">{fieldErrors.firstName}</span>}
          </label>
          <label>
            Last name
            <input aria-describedby={fieldErrors.lastName ? "roster-lastName-error" : undefined} aria-invalid={fieldErrors.lastName ? true : undefined} autoComplete="off" defaultValue={editing?.lastName ?? ""} maxLength={80} name="lastName" required />
            {fieldErrors.lastName && <span className="roster-field-error" id="roster-lastName-error" role="alert">{fieldErrors.lastName}</span>}
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
            <select aria-describedby={fieldErrors.gender ? "roster-gender-error" : undefined} aria-invalid={fieldErrors.gender ? true : undefined} defaultValue={editing?.gender ?? ""} name="gender" required>
              <option disabled value="">Choose one</option>
              {Object.entries(clubRosterGenderLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {fieldErrors.gender && <span className="roster-field-error" id="roster-gender-error" role="alert">{fieldErrors.gender}</span>}
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
