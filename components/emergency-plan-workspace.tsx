"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Download, Plus, Printer, Trash2 } from "lucide-react";
import styles from "@/components/emergency-plan-workspace.module.css";
import {
  emergencyIssueTarget,
  emergencyLocationKindLabels,
  emergencyLocationKinds,
  emergencyProcedureKindLabels,
  emergencyProcedureKinds,
  type EmergencyPlanDraft,
} from "@/modules/emergency-plans/domain";

export type EmergencyPlanVersionRow = { versionNumber: number; publishedLabel: string };

type Props = {
  eventId: string;
  eventName: string;
  /** Null for read-only staff: the page sends them no draft content. */
  initialDraft: EmergencyPlanDraft | null;
  versions: EmergencyPlanVersionRow[];
  canEdit: boolean;
};

type EditableContact = Omit<EmergencyPlanDraft["contacts"][number], "escalationOrder"> & { escalationOrder: string };
type EditableDraft = Omit<EmergencyPlanDraft, "contacts"> & { contacts: EditableContact[] };
type FieldProblem = { fieldKey: string | null; message: string };

const toEditable = (draft: EmergencyPlanDraft): EditableDraft => ({ ...draft, contacts: draft.contacts.map((row) => ({ ...row, escalationOrder: String(row.escalationOrder) })) });
/** A blank order is sent as text so the server names the problem; anything else as the number it is. */
const toPayload = (draft: EditableDraft) => ({ ...draft, contacts: draft.contacts.map((row) => ({ ...row, escalationOrder: row.escalationOrder.trim() === "" ? "" : Number(row.escalationOrder) })) });

type ApiResult = { draft?: EmergencyPlanDraft; versionNumber?: number; message?: string; issues?: Array<{ message?: string; path?: Array<string | number> }> };

const blankLocation = { kind: "ASSEMBLY", name: "", description: "", capacityNote: "", directions: "", mapReference: null } as const;
const blankProcedure = { kind: "EVACUATION", title: "", body: "", items: [] } as const;

/**
 * Staff editor for the event emergency plan (#114): assembly locations and
 * shelters, procedures with steps, and contacts in escalation order. Saving
 * keeps a draft; Publish freezes it as the next numbered version. Staff
 * without CONFIGURE_EVENT get the read-only view and the print links.
 */
export function EmergencyPlanWorkspace({ eventId, eventName, initialDraft, versions: initialVersions, canEdit }: Props) {
  const uid = useId();
  const [draft, setDraft] = useState<EditableDraft>(() => toEditable(initialDraft ?? { locations: [], procedures: [], contacts: [] }));
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const focusKey = useRef<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [versions, setVersions] = useState(initialVersions);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const base = `/api/events/${encodeURIComponent(eventId)}/emergency-plan`;
  const eventQuery = `event=${encodeURIComponent(eventId)}`;

  function change(update: (current: EditableDraft) => EditableDraft) {
    setDraft(update);
    setDirty(true);
    setNotice("");
  }

  async function call(url: string, method: "PUT" | "POST", body?: unknown): Promise<ApiResult | null> {
    setBusy(true);
    setError("");
    setNotice("");
    setProblems([]);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const result = (await response.json().catch(() => ({}))) as ApiResult;
      if (!response.ok) {
        if (result.issues?.length) {
          const found = result.issues.map((issue) => {
            const target = emergencyIssueTarget(issue.path ?? []);
            const text = issue.message ?? "That could not be saved.";
            return { fieldKey: target.fieldKey, message: target.entry ? `${target.entry}: ${text}` : text };
          });
          setProblems(found);
          focusKey.current = found.find((problem) => problem.fieldKey)?.fieldKey ?? "summary";
          return null;
        }
        throw new Error(result.message ?? "That could not be saved.");
      }
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const result = await call(base, "PUT", toPayload(draft));
    if (result?.draft) {
      setDraft(toEditable(result.draft));
      setDirty(false);
      setNotice("Draft saved. It is not published until you publish it.");
    }
  }

  async function publish() {
    const result = await call(`${base}/publish`, "POST");
    if (result?.versionNumber) {
      setVersions([{ versionNumber: result.versionNumber, publishedLabel: "Just now" }, ...versions]);
      setNotice(`Published version ${result.versionNumber}. Print it from the list below.`);
    }
  }

  const field = (name: string) => `${uid}-${name}`;
  useEffect(() => {
    const key = focusKey.current;
    if (!key) return;
    focusKey.current = null;
    (key === "summary" ? summaryRef.current : document.getElementById(`${uid}-${key}`))?.focus();
  }, [problems, uid]);
  // Per-field message wiring: aria-invalid and aria-describedby on the input, the message right after it.
  const messageFor = (key: string) => problems.filter((problem) => problem.fieldKey === key).map((problem) => problem.message);
  const fp = (key: string) => (messageFor(key).length ? { "aria-invalid": true as const, "aria-describedby": `${uid}-${key}-error` } : {});
  const err = (key: string) => (messageFor(key).length ? <span className={styles.fieldError} id={`${uid}-${key}-error`}>{messageFor(key).join(" ")}</span> : null);
  const latest = versions[0];

  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Event safety</p>
          <h2>Emergency plan</h2>
          <p>
            Where to gather, where to shelter, what to do, and who to call for <span translate="no">{eventName}</span>. Procedural
            information only: never enter attendee, medical, custody or incident details here.
          </p>
        </div>
      </div>
      {notice && <div className="inline-notice success" role="status">{notice}</div>}
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {problems.length > 0 && (
        <div className="inline-notice error" ref={summaryRef} role="alert" tabIndex={-1}>
          <p><strong>{problems.length === 1 ? "1 thing needs fixing before this can be saved:" : `${problems.length} things need fixing before this can be saved:`}</strong></p>
          <ul>{problems.map((problem, index) => <li key={index}>{problem.message}</li>)}</ul>
        </div>
      )}
      {!canEdit && <p className="inline-notice" role="status">You can read and print the plan. Event administrators edit and publish it.</p>}

      {canEdit && (
        <>
          <section className={`panel ${styles.block}`} aria-labelledby={field("locations")}>
            <h3 id={field("locations")}>Assembly locations and shelters</h3>
            <p className={`field-help ${styles.help}`}>Informational only. These do not reserve space or link to lodging.</p>
            {draft.locations.map((location, index) => (
              <fieldset className={styles.item} key={index}>
                <legend className={styles.legend}>Location {index + 1}</legend>
                <label htmlFor={field(`loc-kind-${index}`)}>Type
                  <select id={field(`loc-kind-${index}`)} {...fp(`loc-kind-${index}`)} value={location.kind} onChange={(e) => change((d) => ({ ...d, locations: d.locations.map((row, i) => i === index ? { ...row, kind: e.target.value as typeof row.kind } : row) }))}>
                    {emergencyLocationKinds.map((kind) => <option key={kind} value={kind}>{emergencyLocationKindLabels[kind]}</option>)}
                  </select>
                </label>
                {err(`loc-kind-${index}`)}
                <label htmlFor={field(`loc-name-${index}`)}>Name
                  <input id={field(`loc-name-${index}`)} {...fp(`loc-name-${index}`)} maxLength={120} value={location.name} onChange={(e) => change((d) => ({ ...d, locations: d.locations.map((row, i) => i === index ? { ...row, name: e.target.value } : row) }))} />
                </label>
                {err(`loc-name-${index}`)}
                <label htmlFor={field(`loc-desc-${index}`)}>Description
                  <textarea id={field(`loc-desc-${index}`)} {...fp(`loc-desc-${index}`)} maxLength={600} rows={2} value={location.description} onChange={(e) => change((d) => ({ ...d, locations: d.locations.map((row, i) => i === index ? { ...row, description: e.target.value } : row) }))} />
                </label>
                {err(`loc-desc-${index}`)}
                <label htmlFor={field(`loc-cap-${index}`)}>Capacity note
                  <input id={field(`loc-cap-${index}`)} {...fp(`loc-cap-${index}`)} maxLength={200} value={location.capacityNote} onChange={(e) => change((d) => ({ ...d, locations: d.locations.map((row, i) => i === index ? { ...row, capacityNote: e.target.value } : row) }))} />
                </label>
                {err(`loc-cap-${index}`)}
                <label htmlFor={field(`loc-dir-${index}`)}>Directions
                  <textarea id={field(`loc-dir-${index}`)} {...fp(`loc-dir-${index}`)} maxLength={1000} rows={2} value={location.directions} onChange={(e) => change((d) => ({ ...d, locations: d.locations.map((row, i) => i === index ? { ...row, directions: e.target.value } : row) }))} />
                </label>
                {err(`loc-dir-${index}`)}
                <label htmlFor={field(`loc-map-${index}`)}>Map reference (optional)
                  <input id={field(`loc-map-${index}`)} {...fp(`loc-map-${index}`)} maxLength={500} placeholder="https://… or Grid C4" value={location.mapReference ?? ""} onChange={(e) => change((d) => ({ ...d, locations: d.locations.map((row, i) => i === index ? { ...row, mapReference: e.target.value } : row) }))} />
                </label>
                {err(`loc-map-${index}`)}
                <button className="secondary-button" type="button" onClick={() => change((d) => ({ ...d, locations: d.locations.filter((_, i) => i !== index) }))}><Trash2 aria-hidden="true" size={15} /> Remove location {index + 1}</button>
              </fieldset>
            ))}
            <button className="secondary-button" type="button" onClick={() => change((d) => ({ ...d, locations: [...d.locations, { ...blankLocation }] }))}><Plus aria-hidden="true" size={15} /> Add a location</button>
          </section>

          <section className={`panel ${styles.block}`} aria-labelledby={field("procedures")}>
            <h3 id={field("procedures")}>Procedures</h3>
            <p className={`field-help ${styles.help}`}>Plain text. Blank lines start a new paragraph. Add numbered steps for what to do first, second, third.</p>
            {draft.procedures.map((procedure, index) => (
              <fieldset className={styles.item} key={index}>
                <legend className={styles.legend}>Procedure {index + 1}</legend>
                <label htmlFor={field(`proc-kind-${index}`)}>Type
                  <select id={field(`proc-kind-${index}`)} {...fp(`proc-kind-${index}`)} value={procedure.kind} onChange={(e) => change((d) => ({ ...d, procedures: d.procedures.map((row, i) => i === index ? { ...row, kind: e.target.value as typeof row.kind } : row) }))}>
                    {emergencyProcedureKinds.map((kind) => <option key={kind} value={kind}>{emergencyProcedureKindLabels[kind]}</option>)}
                  </select>
                </label>
                {err(`proc-kind-${index}`)}
                <label htmlFor={field(`proc-title-${index}`)}>Title
                  <input id={field(`proc-title-${index}`)} {...fp(`proc-title-${index}`)} maxLength={120} value={procedure.title} onChange={(e) => change((d) => ({ ...d, procedures: d.procedures.map((row, i) => i === index ? { ...row, title: e.target.value } : row) }))} />
                </label>
                {err(`proc-title-${index}`)}
                <label htmlFor={field(`proc-body-${index}`)}>Overview
                  <textarea id={field(`proc-body-${index}`)} {...fp(`proc-body-${index}`)} maxLength={20000} rows={4} value={procedure.body} onChange={(e) => change((d) => ({ ...d, procedures: d.procedures.map((row, i) => i === index ? { ...row, body: e.target.value } : row) }))} />
                </label>
                {err(`proc-body-${index}`)}
                {procedure.items.map((item, itemIndex) => (
                  <div className={styles.step} key={itemIndex}>
                    <label htmlFor={field(`step-title-${index}-${itemIndex}`)}>Step {itemIndex + 1}
                      <input id={field(`step-title-${index}-${itemIndex}`)} {...fp(`step-title-${index}-${itemIndex}`)} maxLength={120} value={item.title} onChange={(e) => change((d) => ({ ...d, procedures: d.procedures.map((row, i) => i === index ? { ...row, items: row.items.map((s, j) => j === itemIndex ? { ...s, title: e.target.value } : s) } : row) }))} />
                    </label>
                    {err(`step-title-${index}-${itemIndex}`)}
                    <label htmlFor={field(`step-text-${index}-${itemIndex}`)}>Step {itemIndex + 1} detail
                      <input id={field(`step-text-${index}-${itemIndex}`)} {...fp(`step-text-${index}-${itemIndex}`)} maxLength={600} value={item.text} onChange={(e) => change((d) => ({ ...d, procedures: d.procedures.map((row, i) => i === index ? { ...row, items: row.items.map((s, j) => j === itemIndex ? { ...s, text: e.target.value } : s) } : row) }))} />
                    </label>
                    {err(`step-text-${index}-${itemIndex}`)}
                    <button className="secondary-button" type="button" onClick={() => change((d) => ({ ...d, procedures: d.procedures.map((row, i) => i === index ? { ...row, items: row.items.filter((_, j) => j !== itemIndex) } : row) }))}><Trash2 aria-hidden="true" size={15} /> Remove step {itemIndex + 1}</button>
                  </div>
                ))}
                <button className="secondary-button" type="button" onClick={() => change((d) => ({ ...d, procedures: d.procedures.map((row, i) => i === index ? { ...row, items: [...row.items, { title: "", text: "" }] } : row) }))}><Plus aria-hidden="true" size={15} /> Add a step</button>
                <button className="secondary-button" type="button" onClick={() => change((d) => ({ ...d, procedures: d.procedures.filter((_, i) => i !== index) }))}><Trash2 aria-hidden="true" size={15} /> Remove procedure {index + 1}</button>
              </fieldset>
            ))}
            <button className="secondary-button" type="button" onClick={() => change((d) => ({ ...d, procedures: [...d.procedures, { ...blankProcedure, items: [] }] }))}><Plus aria-hidden="true" size={15} /> Add a procedure</button>
          </section>

          <section className={`panel ${styles.block}`} aria-labelledby={field("contacts")}>
            <h3 id={field("contacts")}>Operational contacts</h3>
            <p className={`field-help ${styles.help}`}>Staff and officials to call, in the order to call them (1 first). Enter event contacts only, not attendees or guardians.</p>
            {draft.contacts.map((contact, index) => (
              <fieldset className={styles.item} key={index}>
                <legend className={styles.legend}>Contact {index + 1}</legend>
                <label htmlFor={field(`con-order-${index}`)}>Escalation order
                  <input id={field(`con-order-${index}`)} {...fp(`con-order-${index}`)} inputMode="numeric" value={contact.escalationOrder} onChange={(e) => change((d) => ({ ...d, contacts: d.contacts.map((row, i) => i === index ? { ...row, escalationOrder: e.target.value } : row) }))} />
                </label>
                {err(`con-order-${index}`)}
                <label htmlFor={field(`con-role-${index}`)}>Role
                  <input id={field(`con-role-${index}`)} {...fp(`con-role-${index}`)} maxLength={100} value={contact.role} onChange={(e) => change((d) => ({ ...d, contacts: d.contacts.map((row, i) => i === index ? { ...row, role: e.target.value } : row) }))} />
                </label>
                {err(`con-role-${index}`)}
                <label htmlFor={field(`con-name-${index}`)}>Name
                  <input id={field(`con-name-${index}`)} {...fp(`con-name-${index}`)} maxLength={120} value={contact.name} onChange={(e) => change((d) => ({ ...d, contacts: d.contacts.map((row, i) => i === index ? { ...row, name: e.target.value } : row) }))} />
                </label>
                {err(`con-name-${index}`)}
                <label htmlFor={field(`con-phone-${index}`)}>Phone
                  <input id={field(`con-phone-${index}`)} {...fp(`con-phone-${index}`)} inputMode="tel" maxLength={40} placeholder="(515) 555-0100" value={contact.phone} onChange={(e) => change((d) => ({ ...d, contacts: d.contacts.map((row, i) => i === index ? { ...row, phone: e.target.value } : row) }))} />
                </label>
                {err(`con-phone-${index}`)}
                <button className="secondary-button" type="button" onClick={() => change((d) => ({ ...d, contacts: d.contacts.filter((_, i) => i !== index) }))}><Trash2 aria-hidden="true" size={15} /> Remove contact {index + 1}</button>
              </fieldset>
            ))}
            <button className="secondary-button" type="button" onClick={() => change((d) => ({ ...d, contacts: [...d.contacts, { role: "", name: "", phone: "", escalationOrder: String(Math.max(0, ...d.contacts.map((row) => Number(row.escalationOrder) || 0)) + 1) }] }))}><Plus aria-hidden="true" size={15} /> Add a contact</button>
          </section>

          <div className={styles.actions}>
            <button className="primary-button" disabled={busy || !dirty} type="button" onClick={save}>Save draft</button>
            <button className="secondary-button" disabled={busy || dirty} type="button" onClick={publish}>Publish as version {(latest?.versionNumber ?? 0) + 1}</button>
            <a className="secondary-button" href={`/more/emergency-plan/print?${eventQuery}&draft=1`}>Preview draft</a>
            {dirty && <span className={styles.hint}>Save the draft before publishing.</span>}
          </div>
        </>
      )}

      {!canEdit && (
        <section className={`panel ${styles.block}`}>
          <h3>Printed copies</h3>
          <p>Print or download a published version below. The unpublished draft is for event administrators.</p>
        </section>
      )}

      <section className={`panel ${styles.block}`} aria-labelledby={field("versions")}>
        <h3 id={field("versions")}>Published versions</h3>
        {versions.length === 0 ? <p>Nothing is published yet. Publish the draft to get a version you can print.</p> : (
          <ul className={styles.versions}>
            {versions.map((version) => (
              <li className={styles.version} key={version.versionNumber}>
                <span><strong>Version {version.versionNumber}</strong>{version.versionNumber === latest?.versionNumber ? " (latest)" : ""}<br /><span className={styles.hint}>Published {version.publishedLabel}</span></span>
                <span className={styles.actions}>
                  <a className="secondary-button" href={`/more/emergency-plan/print?${eventQuery}&version=${version.versionNumber}`}><Printer aria-hidden="true" size={15} /> Print version {version.versionNumber}</a>
                  <a className="secondary-button" href={`${base}/export?version=${version.versionNumber}`}><Download aria-hidden="true" size={15} /> Download CSV for version {version.versionNumber}</a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
