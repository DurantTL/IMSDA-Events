"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AmendmentField } from "@/components/registration-amendment-editor";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { promoCodeField } from "@/modules/promo-codes/domain";
import { isFieldVisible, type RegistrationFormDefinition } from "@/modules/forms/definition";
import { planAttendeeRemoval, withoutAttendee } from "@/modules/forms/attendee-removal";
import { Money } from "@/components/exact-value";
import { savedMessage } from "@/components/form-message";
import { submitJson, unavailableMessage } from "@/lib/submit-json";
import {
  STAFF_DRAFT_FORM_CHANGED,
  STAFF_DRAFT_REGISTRANT_FILLS_IN,
  STAFF_DRAFT_ROSTER_NOTE,
  STAFF_DRAFT_SOURCES,
  STAFF_DRAFT_SOURCE_LABELS,
  STAFF_DRAFT_STATUS_TONES,
  staffDraftStatusDetail,
  staffDraftStatusWord,
  type StaffDraftAttendee,
  type StaffDraftCheckLines,
  type StaffDraftPlanField,
  type StaffDraftPlanSection,
  type StaffDraftSource,
  type StaffDraftStatus,
} from "@/modules/staff-registration-drafts/domain";
import styles from "./staff-registration-drafts.module.css";

export type StaffDraftRow = {
  id: string;
  formName: string;
  source: StaffDraftSource;
  status: StaffDraftStatus;
  /** The staff member who sent it themselves, or null when the registrant submitted it. */
  submittedByStaffName?: string | null;
  registrantName: string | null;
  registrantEmail: string | null;
  /** How many people staff entered on a roster form. */
  attendeeCount?: number;
  updatedByName: string;
  updatedAt: string;
};

type Detail = {
  draft: StaffDraftRow & { handOffExpiresAt: string | null };
  responses: Record<string, unknown>;
  attendees: StaffDraftAttendee[];
  definition: RegistrationFormDefinition;
  plan: {
    rosterEnabled: boolean;
    sections: StaffDraftPlanSection[];
    attendeeFields: StaffDraftPlanField[];
    roster: { attendeeLabel: string; addButtonLabel: string; minAttendees: number; maxAttendees: number };
  };
  formChanged: boolean;
};

type CheckResult =
  | { ok: true; registrantFills: string[]; check: { registrationStatus: "SUBMITTED" | "WAITLISTED"; waitlistPosition: number | null; totalCents?: number; discountAmountCents?: number; promoCode: string | null; lineItems: Array<{ key: string; label: string; amountCents: number; pricingLabel?: string }>; pricingDate: string } }
  | { ok: false; kind: "NEEDS_ANSWERS"; message: string; lines: StaffDraftCheckLines; rosterPending: boolean }
  | { ok: false; kind: "UNAVAILABLE"; message: string; code?: string; overridable?: boolean };

type Responses = Record<string, unknown>;

/** Central time, labeled (site rule B13). */
const updatedAtLabel = (iso: string) => formatInConferenceTime(iso, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const PROMO_HELP = "The promo code is checked when you select Check.";

function bodyMessage(body: Record<string, unknown>, fallback: string) {
  return typeof body.message === "string" && body.message ? body.message : fallback;
}

export function StaffRegistrationDrafts({
  eventId,
  eventName,
  initialDrafts,
  forms,
}: {
  eventId: string;
  eventName: string;
  initialDrafts: StaffDraftRow[];
  forms: Array<{ id: string; name: string }>;
}) {
  const base = `/api/events/${encodeURIComponent(eventId)}/staff-registration-drafts`;
  const [drafts, setDrafts] = useState(initialDrafts);
  const [formId, setFormId] = useState(forms[0]?.id ?? "");
  const [source, setSource] = useState<StaffDraftSource>("PHONE");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [responses, setResponses] = useState<Responses>({});
  const [attendees, setAttendees] = useState<StaffDraftAttendee[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [confirm, setConfirm] = useState<"send" | "discard" | "save-sent" | "leave" | null>(null);
  // What the confirm dialog will do next once the staff member agrees: save-then-check, or open/start another draft.
  const afterConfirm = useRef<(() => Promise<void>) | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [focusEditor, setFocusEditor] = useState(0);
  const [confirmError, setConfirmError] = useState("");

  async function refreshList() {
    const response = await fetch(base, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { drafts?: StaffDraftRow[] };
    if (body.drafts) setDrafts(body.drafts);
  }

  async function open(id: string, keepMessage = false) {
    setBusy("open");
    setError("");
    if (!keepMessage) setMessage("");
    setCheck(null);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await response.json() as Detail & { message?: string };
      if (!response.ok) {
        setError(bodyMessage(body as unknown as Record<string, unknown>, "That draft could not be opened."));
        return;
      }
      setDetail(body);
      setResponses(body.responses);
      setAttendees(body.attendees ?? []);
      setDirty(false);
      if (!keepMessage) setFocusEditor((count) => count + 1);
    } catch {
      setError("We could not reach the site. Try again.");
    } finally {
      setBusy("");
    }
  }

  /** Opening another draft, or starting one, while this one has unsaved answers asks first (site rule B6). */
  function guarded(action: () => Promise<void>) {
    if (dirty) {
      afterConfirm.current = action;
      setConfirmError("");
      setConfirm("leave");
      return;
    }
    void action();
  }

  async function start() {
    if (!formId) return;
    setBusy("start");
    setError("");
    setMessage("");
    const result = await submitJson(base, { formId, source }, { fallbackMessage: "The draft could not be started." });
    setBusy("");
    if (!result.ok) {
      setError(result.unavailable ? unavailableMessage(result) : bodyMessage(result.body, "The draft could not be started."));
      return;
    }
    const created = result.body.draft as { id: string };
    await refreshList();
    await open(created.id);
  }

  /** Saves what is on screen. Returns whether it is saved, so Check and Send never run on older answers. */
  async function save(announce = true) {
    if (!detail) return false;
    setBusy("save");
    setError("");
    const result = await submitJson(`${base}/${encodeURIComponent(detail.draft.id)}`, { responses, source: detail.draft.source, ...(detail.plan.rosterEnabled ? { attendees } : {}) }, { method: "PATCH", fallbackMessage: "The draft could not be saved." });
    setBusy("");
    if (!result.ok) {
      setError(result.unavailable ? unavailableMessage(result) : bodyMessage(result.body, "The draft could not be saved."));
      return false;
    }
    // A withdrawn link is always said, even from the save that runs before a check.
    if (result.body.linkRevoked) setMessage(savedMessage("The registrant's earlier link no longer works; send a new one when you are ready."));
    else if (announce) setMessage(savedMessage());
    await refreshList();
    await open(detail.draft.id, true);
    return true;
  }

  /** Saving real changes to a draft already sent stops its link, so it is confirmed first. */
  function saveWithConfirm(then?: () => Promise<void>) {
    if (dirty && detail?.draft.status === "HANDED_OFF") {
      afterConfirm.current = async () => { if (await save(!then)) await then?.(); };
      setConfirmError("");
      setConfirm("save-sent");
      return;
    }
    void (async () => { if (await save(!then)) await then?.(); })();
  }

  async function runCheck() {
    if (!detail) return;
    setBusy("check");
    setError("");
    setCheck(null);
    const result = await submitJson(`${base}/${encodeURIComponent(detail.draft.id)}/check`, {}, { fallbackMessage: "The check could not be run." });
    setBusy("");
    if (!result.ok) {
      setError(result.unavailable ? unavailableMessage(result) : bodyMessage(result.body, "The check could not be run."));
      return;
    }
    setCheck(result.body.result as CheckResult);
  }

  async function send() {
    if (!detail) return;
    setConfirmError("");
    setBusy("send");
    if (dirty) {
      const saved = await save(false);
      if (!saved) {
        setBusy("");
        setConfirmError("Save failed, so nothing was sent.");
        return;
      }
      setBusy("send");
    }
    const result = await submitJson(`${base}/${encodeURIComponent(detail.draft.id)}/hand-off`, {}, { fallbackMessage: "The link could not be sent." });
    setBusy("");
    if (!result.ok) {
      setConfirmError(result.unavailable ? unavailableMessage(result) : bodyMessage(result.body, "The link could not be sent."));
      return;
    }
    setConfirm(null);
    setMessage("The private link is on its way to the registrant.");
    await refreshList();
    await open(detail.draft.id, true);
  }

  async function discard() {
    if (!detail) return;
    setConfirmError("");
    setBusy("discard");
    const result = await submitJson(`${base}/${encodeURIComponent(detail.draft.id)}`, {}, { method: "DELETE", fallbackMessage: "The draft could not be discarded." });
    setBusy("");
    if (!result.ok) {
      setConfirmError(result.unavailable ? unavailableMessage(result) : bodyMessage(result.body, "The draft could not be discarded."));
      return;
    }
    setConfirm(null);
    setDetail(null);
    setCheck(null);
    setMessage("Discarded.");
    await refreshList();
  }

  // Leaving the page with unsaved answers warns first (site rule B6).
  useUnsavedChangesGuard(dirty);
  // After Open or Start, focus moves to the editor heading so a keyboard or screen reader user lands on the draft.
  useEffect(() => {
    if (focusEditor > 0) headingRef.current?.focus();
  }, [focusEditor]);

  const editable = detail && (detail.draft.status === "OPEN" || detail.draft.status === "HANDED_OFF");
  const sections = useMemo(() => detail?.plan.sections ?? [], [detail]);
  const promo = useMemo(() => (detail ? promoCodeField(detail.definition) : null), [detail]);

  return (
    <div className={styles.stack}>
      <section className={styles.panel} aria-labelledby="staff-draft-start">
        <h2 id="staff-draft-start">Start a registration</h2>
        <p className={styles.note}>
          Enter what you know for {eventName}. Nothing is registered and nothing is charged until it is sent. When you are ready, send the registrant a private link
          so they can check their answers, add the rest and submit it themselves, or finish it yourself.
        </p>
        {forms.length === 0 ? (
          <p className={styles.note}>This event has no published form to start from.</p>
        ) : (
          <div className={styles.startRow}>
            <label className={styles.fieldLabel}>
              <span>Form</span>
              <select value={formId} onChange={(event) => setFormId(event.target.value)}>
                {forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              <span>How did this come in?</span>
              <select value={source} onChange={(event) => setSource(event.target.value as StaffDraftSource)}>
                {STAFF_DRAFT_SOURCES.map((value) => <option key={value} value={value}>{STAFF_DRAFT_SOURCE_LABELS[value]}</option>)}
              </select>
            </label>
            <button className="primary-button" type="button" disabled={busy !== "" || !formId} onClick={() => guarded(start)}>
              {busy === "start" ? "Starting…" : "Start"}
            </button>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="staff-draft-list">
        <h2 id="staff-draft-list">Registrations staff started</h2>
        {drafts.length === 0 ? (
          <p className={styles.note}>None yet.</p>
        ) : (
          <ul className={styles.list}>
            {drafts.map((row) => (
              <li className={`${styles.row} ${detail?.draft.id === row.id ? styles.rowSelected : ""}`} key={row.id}>
                <div className={styles.rowCopy}>
                  <span className={styles.rowTitle}>{row.registrantName ?? "Name not entered yet"} <StaffDraftStatusChip status={row.status} /></span>
                  <p className={styles.rowMeta}>{row.registrantEmail ?? "Email not entered yet"}</p>
                  <p className={styles.rowMeta}>
                    {STAFF_DRAFT_SOURCE_LABELS[row.source]} · {row.formName}{row.attendeeCount ? ` · ${peopleCount(row.attendeeCount)}` : ""} · {staffDraftStatusDetail(row.status, row.submittedByStaffName)} · updated {updatedAtLabel(row.updatedAt)} by {row.updatedByName}
                  </p>
                </div>
                <button className={`secondary-button ${styles.rowOpen}`} type="button" disabled={busy !== ""} onClick={() => guarded(() => open(row.id))}>
                  Open<span className="sr-only"> the registration for {row.registrantName ?? "an unnamed registrant"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {message && <p className={styles.status} role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {detail && (
        <section className={styles.panel} aria-labelledby="staff-draft-edit">
          <h2 id="staff-draft-edit" ref={headingRef} tabIndex={-1}>{detail.draft.registrantName ?? "New registration"} <StaffDraftStatusChip status={detail.draft.status} /></h2>
          <p className={styles.note}>
            {STAFF_DRAFT_SOURCE_LABELS[detail.draft.source]} · {detail.draft.formName} · {staffDraftStatusDetail(detail.draft.status, detail.draft.submittedByStaffName)}. Answers marked &ldquo;{STAFF_DRAFT_REGISTRANT_FILLS_IN}&rdquo; are never kept in a draft.
          </p>
          {detail.plan.rosterEnabled && <p className={styles.note}>{STAFF_DRAFT_ROSTER_NOTE}</p>}
          {detail.formChanged && <p className="form-error" role="alert">{STAFF_DRAFT_FORM_CHANGED} Save the draft to move it to the new version, then check it.</p>}
          {detail.draft.status === "HANDED_OFF" && (
            <p className={styles.note}>The registrant has a private link{detail.draft.handOffExpiresAt ? ` that works until ${new Date(detail.draft.handOffExpiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}. Changing the answers withdraws it.</p>
          )}
          {detail.draft.status === "SUBMITTED" && (
            <p className={styles.note}>
              {detail.draft.submittedByStaffName
                ? `${detail.draft.submittedByStaffName} sent this registration for the registrant. It is a normal registration now.`
                : "The registrant has submitted this registration. It is a normal registration now."}
            </p>
          )}

          {sections.map((section) => (
            <fieldset key={section.id} className={styles.panel}>
              <legend className={styles.sectionTitle}>{section.title}</legend>
              <div className={styles.fieldGrid}>
                {section.fields.filter(({ field }) => isFieldVisible(field, responses)).map(({ field, editable: canType }) => (
                  canType ? (
                    <AmendmentField
                      key={field.id}
                      field={promo?.key === field.key ? { ...field, helpText: PROMO_HELP } : field}
                      values={responses}
                      locked={!editable}
                      onChange={(value) => { setResponses((current) => ({ ...current, [field.key]: value })); setDirty(true); }}
                    />
                  ) : (
                    <div className={styles.registrantFills} key={field.id}>
                      <small>{field.label}</small>
                      <strong>{STAFF_DRAFT_REGISTRANT_FILLS_IN}</strong>
                    </div>
                  )
                ))}
              </div>
            </fieldset>
          ))}

          {detail.plan.rosterEnabled && (
            <PeopleEditor
              plan={detail.plan}
              registrationResponses={responses}
              attendees={attendees}
              locked={!editable}
              onChange={(next) => { setAttendees(next); setDirty(true); }}
            />
          )}

          {editable && (
            <div className={styles.actions}>
              <button className="primary-button" type="button" disabled={busy !== ""} onClick={() => saveWithConfirm()}>{busy === "save" ? "Saving…" : "Save"}</button>
              <button className="secondary-button" type="button" disabled={busy !== "" || detail.formChanged} onClick={() => (dirty ? saveWithConfirm(runCheck) : void runCheck())}>{busy === "check" ? "Checking…" : "Check"}</button>
              <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => { setConfirmError(""); setConfirm("send"); }}>
                {detail.draft.status === "HANDED_OFF" ? "Send again" : "Send to registrant"}
              </button>
              <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => { setConfirmError(""); setConfirm("discard"); }}>Discard</button>
            </div>
          )}
          {editable && (
            <p className={styles.note}>
              <Link className={`secondary-button ${styles.finishLink}`} href={`/people/staff-drafts/${encodeURIComponent(detail.draft.id)}/finish?event=${encodeURIComponent(eventId)}`}>
                Finish for them
              </Link>{" "}
              Enter the rest yourself, such as the people attending and any acknowledgments, and send the registration now.
              {detail.draft.status === "HANDED_OFF" ? " Finishing it stops the registrant's link." : ""}
            </p>
          )}

          {check && <CheckView result={check} />}
        </section>
      )}

      <ConfirmDialog
        open={confirm === "send"}
        title={detail?.draft.status === "HANDED_OFF" ? "Send the link again?" : "Send the link to the registrant?"}
        confirmLabel={detail?.draft.status === "HANDED_OFF" ? "Send again" : "Send link"}
        busy={busy === "send"}
        busyLabel="Sending…"
        error={confirmError}
        onCancel={() => setConfirm(null)}
        onConfirm={send}
      >
        <p>
          One email with a private link goes to {detail?.draft.registrantEmail ?? "the registrant"}. It names you and the event and holds none of the answers.
          {detail?.draft.status === "HANDED_OFF" ? " The link sent before stops working." : ""} Nothing is registered until the registrant submits the form.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "save-sent"}
        title="Save changes to a sent draft?"
        confirmLabel="Save changes"
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); void afterConfirm.current?.(); }}
      >
        <p>If any answer changed, the link already sent to {detail?.draft.registrantEmail ?? "the registrant"} stops working. You can send a new one after.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "leave"}
        title="Leave without saving?"
        confirmLabel="Leave without saving"
        destructive
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); setDirty(false); void afterConfirm.current?.(); }}
      >
        <p>The answers you changed on this registration have not been saved.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "discard"}
        title="Discard this registration?"
        confirmLabel="Discard"
        destructive
        busy={busy === "discard"}
        busyLabel="Discarding…"
        error={confirmError}
        onCancel={() => setConfirm(null)}
        onConfirm={discard}
      >
        <p>The answers entered so far are deleted and any private link stops working. This can&rsquo;t be undone.</p>
      </ConfirmDialog>
    </div>
  );
}

function peopleCount(count: number) {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

function newClientId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `person-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The people attending on a roster form (#1510). Staff type only what a draft may keep about a person (name, attendee type,
 * shirt size, paid or limited choices); the other per-person questions are named once as the registrant's to fill in.
 */
function PeopleEditor({
  plan,
  registrationResponses,
  attendees,
  locked,
  onChange,
}: {
  plan: Detail["plan"];
  registrationResponses: Responses;
  attendees: StaffDraftAttendee[];
  locked: boolean;
  onChange: (next: StaffDraftAttendee[]) => void;
}) {
  const label = plan.roster.attendeeLabel;
  const typed = plan.attendeeFields.filter((entry) => entry.editable);
  const registrantOnly = plan.attendeeFields.filter((entry) => !entry.editable).map((entry) => entry.field.label);
  const atLimit = attendees.length >= plan.roster.maxAttendees;
  const newRow = useRef<string | null>(null);
  // After a removal, focus moves to the person who took its place (or the one before it), else to the add button.
  const removedAt = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (newRow.current) {
      // A new person's first field takes focus, so a keyboard user carries straight on.
      const row = listRef.current?.querySelector<HTMLElement>(`[data-person="${newRow.current}"] input, [data-person="${newRow.current}"] select`);
      row?.focus();
      newRow.current = null;
      return;
    }
    if (removedAt.current !== null) {
      const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-person]") ?? [];
      const next = rows[Math.min(removedAt.current, rows.length - 1)];
      const target = next?.querySelector<HTMLElement>("input, select, textarea, button") ?? addRef.current ?? listRef.current;
      target?.focus();
      removedAt.current = null;
    }
  }, [attendees.length]);

  function personName(attendee: StaffDraftAttendee, index: number) {
    const name = [attendee.responses.first_name, attendee.responses.last_name].filter((part) => typeof part === "string" && part.trim()).join(" ").trim();
    return name || `${label} ${index + 1}`;
  }

  function update(clientId: string, key: string, value: unknown) {
    onChange(attendees.map((attendee) => (attendee.clientId === clientId ? { ...attendee, responses: { ...attendee.responses, [key]: value } } : attendee)));
  }

  function add() {
    const clientId = newClientId();
    newRow.current = clientId;
    setAnnouncement("");
    onChange([...attendees, { clientId, responses: {} }]);
  }

  function remove(clientId: string) {
    const index = attendees.findIndex((attendee) => attendee.clientId === clientId);
    if (index === -1) return;
    removedAt.current = index;
    setAnnouncement(`Removed ${personName(attendees[index]!, index)}.`);
    onChange(withoutAttendee(attendees, clientId));
  }

  // A draft may hold fewer people than the form needs, so nothing blocks a removal; a person with answers asks first.
  function askRemove(clientId: string) {
    const plan = planAttendeeRemoval(attendees, clientId, 0, (attendee) => Object.values(attendee.responses).some((value) => value !== "" && value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)));
    if (plan === "remove") remove(clientId);
    else if (plan === "confirm") setPendingRemove(clientId);
  }

  const pendingIndex = pendingRemove ? attendees.findIndex((attendee) => attendee.clientId === pendingRemove) : -1;
  const pendingName = pendingIndex >= 0 ? personName(attendees[pendingIndex]!, pendingIndex) : label;

  return (
    <fieldset className={styles.panel}>
      <legend className={styles.sectionTitle}>People attending</legend>
      <p className={styles.note}>
        {attendees.length === 0 ? `No ${label.toLowerCase()} entered yet.` : peopleCount(attendees.length)}
        {plan.roster.minAttendees > 1 ? ` This form needs at least ${plan.roster.minAttendees}.` : ""}
      </p>
      {registrantOnly.length > 0 && (
        <p className={styles.note}>The registrant fills these in for each person: {registrantOnly.join(", ")}.</p>
      )}
      <div className={styles.people} ref={listRef}>
        {attendees.map((attendee, index) => {
          const values = { ...registrationResponses, ...attendee.responses };
          return (
            <fieldset className={styles.person} key={attendee.clientId} data-person={attendee.clientId}>
              <legend className={styles.personTitle}>{label} {index + 1}</legend>
              <div className={styles.fieldGrid}>
                {typed.filter(({ field }) => isFieldVisible(field, values)).map(({ field }) => (
                  <AmendmentField
                    key={field.id}
                    field={{ ...field, id: `${field.id}_${attendee.clientId}` }}
                    values={attendee.responses}
                    locked={locked}
                    onChange={(value) => update(attendee.clientId, field.key, value)}
                  />
                ))}
              </div>
              {!locked && (
                <button className={`secondary-button ${styles.personRemove}`} type="button" onClick={() => askRemove(attendee.clientId)}>
                  Remove<span className="sr-only"> {label.toLowerCase()} {index + 1}</span>
                </button>
              )}
            </fieldset>
          );
        })}
      </div>
      {!locked && (
        atLimit
          ? <p className={styles.note}>This form takes at most {plan.roster.maxAttendees}.</p>
          : <button className="secondary-button" type="button" onClick={add} ref={addRef}>{plan.roster.addButtonLabel}</button>
      )}
      <p className="sr-only" role="status">{announcement}</p>
      <ConfirmDialog
        open={pendingIndex >= 0}
        title={`Remove ${pendingName} and their answers?`}
        confirmLabel={`Remove ${pendingName}`}
        destructive
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => { const clientId = pendingRemove; setPendingRemove(null); if (clientId) remove(clientId); }}
      >
        <p>{`Everything entered for ${pendingName} is cleared when you save. Cancel keeps every answer.`}</p>
      </ConfirmDialog>
    </fieldset>
  );
}

/** The draft's status word on the shared chip (site rules B12 and L4); what happened to it is said in words beside it. */
function StaffDraftStatusChip({ status }: { status: StaffDraftStatus }) {
  return <span className={`status-chip ${STAFF_DRAFT_STATUS_TONES[status]}`}>{staffDraftStatusWord(status)}</span>;
}

function CheckView({ result }: { result: CheckResult }) {
  if (!result.ok && result.kind === "UNAVAILABLE") {
    return (
      <div className={styles.result} role="status">
        <h3>Can&rsquo;t be registered right now</h3>
        <p className={styles.note}>{result.message}</p>
        {result.overridable && <p className={styles.note}>Someone with Registration overrides can send this past the rule. Ask a system administrator.</p>}
      </div>
    );
  }
  if (!result.ok) {
    const { staffNeeds, registrantFills } = result.lines;
    return (
      <div className={styles.result} role="status">
        <h3>Still needed</h3>
        {staffNeeds.length > 0 && (
          <>
            <p className={styles.note}>You can still enter:</p>
            <ul>{staffNeeds.map((line) => <li key={line}>{line}</li>)}</ul>
          </>
        )}
        {registrantFills.length > 0 && (
          <>
            <p className={styles.note}>The registrant fills these in:</p>
            <ul>{registrantFills.map((line) => <li key={line}>{line}</li>)}</ul>
          </>
        )}
        {result.rosterPending && <p className={styles.note}>A price shows once people are added.</p>}
        {staffNeeds.length === 0 && registrantFills.length === 0 && !result.rosterPending && <p className={styles.note}>{result.message}</p>}
      </div>
    );
  }
  const { check } = result;
  return (
    <div className={styles.result} role="status">
      <h3>{check.registrationStatus === "WAITLISTED" ? `This would join the waitlist${check.waitlistPosition ? ` (place ${check.waitlistPosition})` : ""}` : "This would be registered"}</h3>
      {check.lineItems.length > 0 && (
        <ul className={styles.lines}>
          {check.lineItems.map((line) => (
            <li key={`${line.key}-${line.label}`}>
              <span>{line.label}{line.pricingLabel ? ` (${line.pricingLabel})` : ""}</span>
              <Money as="span" cents={line.amountCents} />
            </li>
          ))}
        </ul>
      )}
      {typeof check.totalCents === "number"
        ? <p className={styles.total}>Estimated total <Money cents={check.totalCents} /></p>
        : <p className={styles.note}>This event bills the church, so no total is shown.</p>}
      {result.registrantFills.length > 0 && (
        <>
          <p className={styles.note}>The registrant fills these in:</p>
          <ul>{result.registrantFills.map((line) => <li key={line}>{line}</li>)}</ul>
        </>
      )}
      <p className={styles.note}>This is an estimate. Answers the registrant gives, such as a birth date, a payment choice or add-ons like meals, can change the price. Nothing was saved and nothing was charged.</p>
    </div>
  );
}
