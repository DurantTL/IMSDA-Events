"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary, summaryMessage, useFormErrorSummary } from "@/components/form-error-summary";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { formatPersonName } from "@/lib/person-name";
import {
  NAD_CERTIFICATIONS,
  SIGNED_OFF_BY_MAX,
  STAFF_TRAINING_KINDS,
  WORKSHOP_CODE_MAX,
  WORKSHOP_TITLE_MAX,
  staffTrainingKindLabels,
  type StaffTrainingKind,
  type StaffTrainingRecordView,
} from "@/modules/staff-training/domain";
import type { StaffTrainingPerson } from "@/modules/staff-training/repository";
import styles from "./club-staff-training.module.css";

/**
 * The staff training page's list (#1697): one card per adult on this year's roster with what they hold, newest first, a
 * form to add a certification or a workshop, and a button to remove a record. The routes check the role and the feature
 * again and record every change.
 */

const dateText = (iso: string) => new Date(`${iso}T12:00:00.000Z`).toLocaleDateString("en-US", { timeZone: "UTC", dateStyle: "medium" });

class RequestError extends Error {
  constructor(message: string, readonly issues: Array<{ path?: unknown[]; message?: string }> = []) {
    super(message);
  }
}

async function request(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const result = await response.json().catch(() => ({})) as { message?: string; issues?: Array<{ path?: unknown[]; message?: string }> };
  if (!response.ok) throw new RequestError(result.message ?? "That could not be saved.", result.issues);
}

function RecordRow({ organizationId, person, record }: { organizationId: string; person: string; record: StaffTrainingRecordView }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await request(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/staff-training/${encodeURIComponent(record.id)}`, { method: "DELETE" });
      setConfirming(false);
      router.refresh();
    } catch (caught) {
      // The dialog is open: show the failure there, where the person is looking.
      setError(notSavedMessage(caught instanceof Error ? caught.message : "That could not be removed."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={styles.record}>
      <span className={styles.recordText}>
        <span className={styles.recordTitle}>{record.label}</span>
        {record.kind === "WORKSHOP" && <span className={styles.recordMeta}>Workshop</span>}
        <span className={styles.recordMeta}>
          {`Completed ${dateText(record.completedOn)}`}{record.signedOffBy ? ` · Signed off by ${record.signedOffBy}` : ""}
        </span>
      </span>
      <button aria-label={`Remove ${record.label} for ${person}`} className={`secondary-button ${styles.removeButton}`} onClick={() => { setError(""); setConfirming(true); }} type="button">
        <Trash2 aria-hidden="true" size={16} /> Remove
      </button>
      <ConfirmDialog
        busy={busy}
        busyLabel="Removing…"
        confirmLabel="Remove record"
        destructive
        error={error}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void remove()}
        open={confirming}
        title={`Remove ${record.label} for ${person}?`}
      >
        <p>This deletes the record from your club&apos;s staff training. The change is recorded, but the record itself cannot be brought back; you would add it again.</p>
      </ConfirmDialog>
    </li>
  );
}

type FieldKey = "certificationKey" | "workshopCode" | "workshopTitle" | "completedOn" | "signedOffBy";
const FIELD_LABELS: Record<FieldKey, string> = {
  certificationKey: "Certification",
  workshopCode: "Workshop code",
  workshopTitle: "Workshop title",
  completedOn: "Date completed",
  signedOffBy: "Signed off by",
};

function AddRecordForm({ organizationId, person }: { organizationId: string; person: StaffTrainingPerson }) {
  const router = useRouter();
  const idBase = `staff-training-${person.personId}`;
  const fieldId = (key: FieldKey | "kind") => `${idBase}-${key}`;
  const [kind, setKind] = useState<StaffTrainingKind>("CERTIFICATION");
  const [values, setValues] = useState<Record<FieldKey, string>>({ certificationKey: "", workshopCode: "", workshopTitle: "", completedOn: "", signedOffBy: "" });
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const [saved, setSaved] = useState("");
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary, clearField: clearSummaryField } = useFormErrorSummary();
  const dirty = Object.values(values).some((value) => value.trim() !== "");
  useUnsavedChangesGuard(dirty, "You have an unsaved training record. Leave this page and discard it?");

  function set(key: FieldKey, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    clearSummaryField(fieldId(key));
  }

  /** The fields that matter for this kind, with what is wrong with each (empty means ready to send). */
  function clientProblems() {
    const found: Partial<Record<FieldKey, string>> = {};
    if (kind === "CERTIFICATION") {
      if (!values.certificationKey) found.certificationKey = "Choose a certification.";
    } else {
      if (!values.workshopCode.trim()) found.workshopCode = "Enter a workshop code.";
      if (!values.workshopTitle.trim()) found.workshopTitle = "Enter a workshop title.";
    }
    if (!values.completedOn) found.completedOn = "Enter the date completed.";
    return found;
  }

  function report(found: Partial<Record<FieldKey, string>>) {
    setErrors(found);
    showSummary((Object.keys(found) as FieldKey[]).map((key) => ({ targetId: fieldId(key), message: summaryMessage(FIELD_LABELS[key], found[key]!) })));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed("");
    setSaved("");
    clearSummary();
    const found = clientProblems();
    if (Object.keys(found).length > 0) {
      report(found);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await request(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/staff-training`, {
        method: "POST",
        body: JSON.stringify({
          personId: person.personId,
          kind,
          completedOn: values.completedOn,
          signedOffBy: values.signedOffBy,
          ...(kind === "CERTIFICATION" ? { certificationKey: values.certificationKey } : { workshopCode: values.workshopCode, workshopTitle: values.workshopTitle }),
        }),
      });
      setValues({ certificationKey: "", workshopCode: "", workshopTitle: "", completedOn: "", signedOffBy: "" });
      setSaved(savedMessage());
      router.refresh();
    } catch (caught) {
      // A server problem that names a field goes to that field; anything else shows under the button.
      const mapped: Partial<Record<FieldKey, string>> = {};
      if (caught instanceof RequestError) {
        for (const issue of caught.issues) {
          const key = issue.path?.[0];
          if (typeof key === "string" && key in FIELD_LABELS && !mapped[key as FieldKey]) mapped[key as FieldKey] = issue.message ?? "Check this field.";
        }
      }
      if (Object.keys(mapped).length > 0) report(mapped);
      else setFailed(notSavedMessage(caught instanceof Error ? caught.message : "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  const props = (key: FieldKey) => ({
    id: fieldId(key),
    ...fieldErrorProps(`${fieldId(key)}-error`, errors[key]),
  });
  const error = (key: FieldKey) => <FieldError id={`${fieldId(key)}-error`}>{errors[key]}</FieldError>;

  return (
    <details className={styles.add}>
      <summary>
        <Plus aria-hidden="true" size={16} /> Add a record
        <span className="sr-only">{` for ${formatPersonName(person)}`}</span>
      </summary>
      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        {summaryItems.length > 0 ? <FormErrorSummary items={summaryItems} ref={summaryRef} /> : null}
        <div className={styles.field}>
          <label htmlFor={fieldId("kind")}>Type of record</label>
          <select id={fieldId("kind")} onChange={(event) => { setKind(event.target.value as StaffTrainingKind); setErrors({}); clearSummary(); }} value={kind}>
            {STAFF_TRAINING_KINDS.map((item) => <option key={item} value={item}>{staffTrainingKindLabels[item]}</option>)}
          </select>
        </div>
        {kind === "CERTIFICATION" ? (
          <div className={styles.field}>
            <label htmlFor={fieldId("certificationKey")}>Certification</label>
            <select {...props("certificationKey")} onChange={(event) => set("certificationKey", event.target.value)} value={values.certificationKey}>
              <option value="">Choose a certification</option>
              {NAD_CERTIFICATIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
            {error("certificationKey")}
          </div>
        ) : (
          <>
            <div className={styles.field}>
              <label htmlFor={fieldId("workshopCode")}>Workshop code</label>
              <input {...props("workshopCode")} maxLength={WORKSHOP_CODE_MAX} onChange={(event) => set("workshopCode", event.target.value)} value={values.workshopCode} />
              {error("workshopCode")}
            </div>
            <div className={styles.field}>
              <label htmlFor={fieldId("workshopTitle")}>Workshop title</label>
              <input {...props("workshopTitle")} maxLength={WORKSHOP_TITLE_MAX} onChange={(event) => set("workshopTitle", event.target.value)} value={values.workshopTitle} />
              {error("workshopTitle")}
            </div>
          </>
        )}
        <div className={styles.field}>
          <label htmlFor={fieldId("completedOn")}>Date completed</label>
          <input {...props("completedOn")} onChange={(event) => set("completedOn", event.target.value)} type="date" value={values.completedOn} />
          {error("completedOn")}
        </div>
        <div className={styles.field}>
          <label htmlFor={fieldId("signedOffBy")}>Signed off by (optional)</label>
          <input {...props("signedOffBy")} maxLength={SIGNED_OFF_BY_MAX} onChange={(event) => set("signedOffBy", event.target.value)} value={values.signedOffBy} />
          {error("signedOffBy")}
        </div>
        <div>
          <SubmitButton icon={<Plus aria-hidden="true" size={16} />} label="Add record" submitting={busy} submittingLabel="Saving…" />
          <FormMessage message={failed || saved} tone={failed ? "error" : "success"} />
        </div>
      </form>
    </details>
  );
}

export function ClubStaffTraining({ organizationId, people }: { organizationId: string; people: StaffTrainingPerson[] }) {
  if (people.length === 0) {
    return <p className="inline-notice">No adults are on this year&apos;s roster yet. Add an adult or staff member to the roster, then record their training here.</p>;
  }
  return (
    <ul className={styles.people}>
      {people.map((person) => {
        const name = formatPersonName(person);
        return (
          <li className={styles.person} key={person.personId}>
            <h3 className={styles.name}>{name}</h3>
            <p className={styles.type}>{person.typeLabel}</p>
            {person.records.length === 0
              ? <p className={styles.none}>No certifications or workshops recorded.</p>
              : (
                <ul aria-label={`Training records for ${name}`} className={styles.records}>
                  {person.records.map((record) => <RecordRow key={record.id} organizationId={organizationId} person={name} record={record} />)}
                </ul>
              )}
            <AddRecordForm organizationId={organizationId} person={person} />
          </li>
        );
      })}
    </ul>
  );
}
