"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
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

async function request(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const result = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(result.message ?? "That could not be saved.");
}

function RecordRow({ organizationId, person, record }: { organizationId: string; person: string; record: StaffTrainingRecordView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  async function remove() {
    setBusy(true);
    setFailed("");
    try {
      await request(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/staff-training/${encodeURIComponent(record.id)}`, { method: "DELETE" });
      router.refresh();
    } catch (caught) {
      setFailed(notSavedMessage(caught instanceof Error ? caught.message : "That could not be removed."));
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
      <button aria-busy={busy || undefined} aria-label={`Remove ${record.label} for ${person}`} className={`secondary-button ${styles.removeButton}`} disabled={busy} onClick={() => void remove()} type="button">
        <Trash2 aria-hidden="true" size={16} /> {busy ? "Removing…" : "Remove"}
      </button>
      {failed && <FormMessage message={failed} tone="error" />}
    </li>
  );
}

function AddRecordForm({ organizationId, person }: { organizationId: string; person: StaffTrainingPerson }) {
  const router = useRouter();
  const idBase = `staff-training-${person.personId}`;
  const [kind, setKind] = useState<StaffTrainingKind>("CERTIFICATION");
  const [certificationKey, setCertificationKey] = useState("");
  const [workshopCode, setWorkshopCode] = useState("");
  const [workshopTitle, setWorkshopTitle] = useState("");
  const [completedOn, setCompletedOn] = useState("");
  const [signedOffBy, setSignedOffBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const [saved, setSaved] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed("");
    setSaved("");
    try {
      await request(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/staff-training`, {
        method: "POST",
        body: JSON.stringify({
          personId: person.personId,
          kind,
          completedOn,
          signedOffBy,
          ...(kind === "CERTIFICATION" ? { certificationKey } : { workshopCode, workshopTitle }),
        }),
      });
      setCertificationKey("");
      setWorkshopCode("");
      setWorkshopTitle("");
      setCompletedOn("");
      setSignedOffBy("");
      setSaved(savedMessage());
      router.refresh();
    } catch (caught) {
      setFailed(notSavedMessage(caught instanceof Error ? caught.message : "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className={styles.add}>
      <summary>
        <Plus aria-hidden="true" size={16} /> Add a record
        <span className="sr-only">{` for ${formatPersonName(person)}`}</span>
      </summary>
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <label className={styles.field} htmlFor={`${idBase}-kind`}>
          Type of record
          <select id={`${idBase}-kind`} onChange={(event) => setKind(event.target.value as StaffTrainingKind)} value={kind}>
            {STAFF_TRAINING_KINDS.map((item) => <option key={item} value={item}>{staffTrainingKindLabels[item]}</option>)}
          </select>
        </label>
        {kind === "CERTIFICATION" ? (
          <label className={styles.field} htmlFor={`${idBase}-certification`}>
            Certification
            <select id={`${idBase}-certification`} onChange={(event) => setCertificationKey(event.target.value)} required value={certificationKey}>
              <option value="">Choose a certification</option>
              {NAD_CERTIFICATIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
        ) : (
          <>
            <label className={styles.field} htmlFor={`${idBase}-code`}>
              Workshop code
              <input id={`${idBase}-code`} maxLength={WORKSHOP_CODE_MAX} onChange={(event) => setWorkshopCode(event.target.value)} required value={workshopCode} />
            </label>
            <label className={styles.field} htmlFor={`${idBase}-title`}>
              Workshop title
              <input id={`${idBase}-title`} maxLength={WORKSHOP_TITLE_MAX} onChange={(event) => setWorkshopTitle(event.target.value)} required value={workshopTitle} />
            </label>
          </>
        )}
        <label className={styles.field} htmlFor={`${idBase}-date`}>
          Date completed
          <input id={`${idBase}-date`} onChange={(event) => setCompletedOn(event.target.value)} required type="date" value={completedOn} />
        </label>
        <label className={styles.field} htmlFor={`${idBase}-signed`}>
          Signed off by (optional)
          <input id={`${idBase}-signed`} maxLength={SIGNED_OFF_BY_MAX} onChange={(event) => setSignedOffBy(event.target.value)} value={signedOffBy} />
        </label>
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
