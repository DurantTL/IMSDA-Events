"use client";

import { useEffect, useMemo, useState } from "react";
import { AmendmentField } from "@/components/registration-amendment-editor";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { isFieldVisible, type RegistrationFormDefinition } from "@/modules/forms/definition";
import { formatCents } from "@/modules/payments/format-cents";
import { submitJson, unavailableMessage } from "@/lib/submit-json";
import {
  STAFF_DRAFT_FORM_CHANGED,
  STAFF_DRAFT_REGISTRANT_FILLS_IN,
  STAFF_DRAFT_ROSTER_NOTE,
  STAFF_DRAFT_SOURCES,
  STAFF_DRAFT_SOURCE_LABELS,
  STAFF_DRAFT_STATUS_LABELS,
  type StaffDraftCheckLines,
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
  registrantName: string | null;
  registrantEmail: string | null;
  updatedByName: string;
  updatedAt: string;
};

type Detail = {
  draft: StaffDraftRow & { handOffExpiresAt: string | null };
  responses: Record<string, unknown>;
  definition: RegistrationFormDefinition;
  plan: { rosterEnabled: boolean; sections: StaffDraftPlanSection[] };
  formChanged: boolean;
};

type CheckResult =
  | { ok: true; check: { registrationStatus: "SUBMITTED" | "WAITLISTED"; waitlistPosition: number | null; totalCents?: number; discountAmountCents?: number; promoCode: string | null; lineItems: Array<{ key: string; label: string; amountCents: number; pricingLabel?: string }>; pricingDate: string } }
  | { ok: false; kind: "NEEDS_ANSWERS"; message: string; lines: StaffDraftCheckLines }
  | { ok: false; kind: "UNAVAILABLE"; message: string };

type Responses = Record<string, unknown>;

const updatedFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

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
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [confirm, setConfirm] = useState<"send" | "discard" | null>(null);
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
      setDirty(false);
    } catch {
      setError("We could not reach the site. Try again.");
    } finally {
      setBusy("");
    }
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
    const result = await submitJson(`${base}/${encodeURIComponent(detail.draft.id)}`, { responses, source: detail.draft.source }, { method: "PATCH", fallbackMessage: "The draft could not be saved." });
    setBusy("");
    if (!result.ok) {
      setError(result.unavailable ? unavailableMessage(result) : bodyMessage(result.body, "The draft could not be saved."));
      return false;
    }
    if (announce) {
      setMessage(result.body.linkRevoked
        ? "Saved. The registrant's earlier link no longer works; send it again when you are ready."
        : "Saved.");
    }
    await refreshList();
    await open(detail.draft.id, true);
    return true;
  }

  async function runCheck() {
    if (!detail) return;
    if (dirty && !(await save(false))) return;
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

  // A draft opened with answers on screen warns before the page goes away.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const editable = detail && (detail.draft.status === "OPEN" || detail.draft.status === "HANDED_OFF");
  const sections = useMemo(() => detail?.plan.sections ?? [], [detail]);

  return (
    <div className={styles.stack}>
      <section className={styles.panel} aria-labelledby="staff-draft-start">
        <h2 id="staff-draft-start">Start a registration</h2>
        <p className={styles.note}>
          Enter what you know for {eventName}. Nothing is registered and nothing is charged. When you are ready, send the registrant a private link
          so they can check their answers, add the rest and submit it themselves.
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
            <button className="primary-button" type="button" disabled={busy !== "" || !formId} onClick={start}>
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
                  <span className={styles.rowTitle}>{row.registrantName ?? "Name not entered yet"}</span>
                  <p className={styles.rowMeta}>{row.registrantEmail ?? "Email not entered yet"}</p>
                  <p className={styles.rowMeta}>
                    {STAFF_DRAFT_SOURCE_LABELS[row.source]} · {row.formName} · {STAFF_DRAFT_STATUS_LABELS[row.status]} · updated {updatedFormat.format(new Date(row.updatedAt))} by {row.updatedByName}
                  </p>
                </div>
                <button className={`secondary-button ${styles.rowOpen}`} type="button" disabled={busy !== ""} onClick={() => open(row.id)}>
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
          <h2 id="staff-draft-edit">{detail.draft.registrantName ?? "New registration"} <span className={styles.chip}>{STAFF_DRAFT_STATUS_LABELS[detail.draft.status]}</span></h2>
          <p className={styles.note}>
            {STAFF_DRAFT_SOURCE_LABELS[detail.draft.source]} · {detail.draft.formName}. Answers marked &ldquo;{STAFF_DRAFT_REGISTRANT_FILLS_IN}&rdquo; are never kept in a draft.
          </p>
          {detail.plan.rosterEnabled && <p className={styles.note}>{STAFF_DRAFT_ROSTER_NOTE}</p>}
          {detail.formChanged && <p className="form-error" role="alert">{STAFF_DRAFT_FORM_CHANGED} Save the draft to move it to the new version, then check it.</p>}
          {detail.draft.status === "HANDED_OFF" && (
            <p className={styles.note}>The registrant has a private link{detail.draft.handOffExpiresAt ? ` that works until ${new Date(detail.draft.handOffExpiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}. Changing the answers withdraws it.</p>
          )}
          {detail.draft.status === "SUBMITTED" && <p className={styles.note}>The registrant has submitted this registration. It is a normal registration now.</p>}

          {sections.map((section) => (
            <fieldset key={section.id} className={styles.panel}>
              <legend className={styles.sectionTitle}>{section.title}</legend>
              <div className={styles.fieldGrid}>
                {section.fields.filter(({ field }) => isFieldVisible(field, responses)).map(({ field, editable: canType }) => (
                  canType ? (
                    <AmendmentField
                      key={field.id}
                      field={field}
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

          {editable && (
            <div className={styles.actions}>
              <button className="primary-button" type="button" disabled={busy !== ""} onClick={() => save()}>{busy === "save" ? "Saving…" : "Save"}</button>
              <button className="secondary-button" type="button" disabled={busy !== "" || detail.formChanged} onClick={runCheck}>{busy === "check" ? "Checking…" : "Check"}</button>
              <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => { setConfirmError(""); setConfirm("send"); }}>
                {detail.draft.status === "HANDED_OFF" ? "Send again" : "Send to registrant"}
              </button>
              <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => { setConfirmError(""); setConfirm("discard"); }}>Discard</button>
            </div>
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

function CheckView({ result }: { result: CheckResult }) {
  if (!result.ok && result.kind === "UNAVAILABLE") {
    return <div className={styles.result} role="status"><h3>Can&rsquo;t be registered right now</h3><p className={styles.note}>{result.message}</p></div>;
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
        {staffNeeds.length === 0 && registrantFills.length === 0 && <p className={styles.note}>{result.message}</p>}
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
              <span>{formatCents(line.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {typeof check.totalCents === "number"
        ? <p className={styles.total}>Total {formatCents(check.totalCents)}</p>
        : <p className={styles.note}>This event bills the church, so no total is shown.</p>}
      <p className={styles.note}>Nothing was saved and nothing was charged.</p>
    </div>
  );
}
