"use client";

import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/lib/post-json";
import type { TemplateFromEventPreview } from "@/modules/event-templates/from-event-domain";
import styles from "./event-template-from-event.module.css";

export type TemplateSourceEventOption = { id: string; name: string; startsOn: string; endsOn: string };
export type TemplateTargetOption = { id: string; name: string; audience: "GENERAL" | "CLUB"; hasDraft: boolean };

type Props = {
  events: TemplateSourceEventOption[];
  templates: TemplateTargetOption[];
};

type Preview = TemplateFromEventPreview & { fingerprint: string };
type Failure = { message: string; stale: boolean };
type Saved = { templateId: string; versionNumber: number; alreadySaved: boolean; kept: Array<{ key: string; label: string; count: number }> };

export function EventTemplateFromEvent({ events, templates }: Props) {
  const [sourceEventId, setSourceEventId] = useState(events[0]?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<"NEW" | "NEW_VERSION">("NEW");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [releaseNote, setReleaseNote] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  const availableTemplates = templates.filter((template) => !preview || template.audience === preview.source.audience);
  const targetTemplate = availableTemplates.find((template) => template.id === templateId);
  const complete = Boolean(preview)
    && releaseNote.trim().length >= 3
    && (mode === "NEW" ? name.trim().length >= 2 : Boolean(targetTemplate) && !targetTemplate?.hasDraft);

  async function loadPreview(targetTemplateId = "") {
    setBusy(true);
    setFailure(null);
    setSaved(null);
    try {
      const { ok, body } = await postJson("/api/event-templates/from-event/preview", { sourceEventId, ...(targetTemplateId ? { targetTemplateId } : {}) }, "The preview could not be prepared.");
      if (!ok) {
        setFailure({ message: typeof body.message === "string" ? body.message : "The preview could not be prepared.", stale: false });
        setPreview(null);
      } else {
        const next = body.preview as Preview;
        setPreview(next);
        if (!targetTemplateId) {
          setRequestKey(crypto.randomUUID());
          setTemplateId("");
        }
        if (!name) setName(`${next.source.name} template`);
      }
    } catch (error) {
      setFailure({ message: error instanceof Error ? error.message : "The preview could not be prepared.", stale: false });
    }
    setBusy(false);
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    setFailure(null);
    try {
      const { ok, body } = await postJson("/api/event-templates/from-event", {
        sourceEventId: preview.source.id,
        fingerprint: preview.fingerprint,
        target: mode === "NEW" ? { mode, name, description } : { mode, templateId },
        releaseNote,
        requestKey,
      }, "The event could not be saved as a template.", undefined, { idempotent: true });
      if (!ok) {
        setFailure({
          message: typeof body.message === "string" ? body.message : "The event could not be saved as a template.",
          stale: body.error === "SOURCE_CHANGED",
        });
      } else {
        const template = body.template as { id: string };
        setSaved({ templateId: template.id, versionNumber: Number(body.versionNumber), alreadySaved: body.alreadySaved === true, kept: Array.isArray(body.kept) ? (body.kept as Saved["kept"]) : [] });
      }
    } catch (error) {
      setFailure({ message: error instanceof Error ? error.message : "The event could not be saved as a template.", stale: false });
    }
    setBusy(false);
  }

  if (events.length === 0) return <p>There are no events to save as a template yet.</p>;

  if (saved) {
    return (
      <section className="panel form-stack event-settings-panel" aria-live="polite">
        <h2 className={styles.heading}>Saved as a draft</h2>
        <p>
          Version {saved.versionNumber} was saved as a draft{saved.alreadySaved ? " earlier (this request had already been saved)" : ""}.
          Open the template to review it, then publish it when it is ready. Nothing is applied to any event until then.
        </p>
        {saved.kept.length > 0 ? <p>Kept from the current template version: {saved.kept.map((entry) => entry.label).join(", ")}.</p> : null}
        <Link className={`primary-button ${styles.resultLink}`} href={`/admin/event-templates/${saved.templateId}`}>Open the template</Link>
      </section>
    );
  }

  return (
    <div className={styles.root}>
      {failure ? (
        <div className="inline-notice error" role="alert">
          <p>{failure.message}</p>
          {failure.stale ? <button type="button" className="secondary-button" onClick={() => loadPreview(mode === "NEW_VERSION" ? templateId : "")} disabled={busy}>Preview again</button> : null}
        </div>
      ) : null}

      <section className="panel form-stack event-settings-panel">
        <h2 className={styles.heading}>Choose an event</h2>
        <label className={styles.label}>Event to save
          <select value={sourceEventId} onChange={(event) => { setSourceEventId(event.target.value); setPreview(null); }}>
            {events.map((event) => <option key={event.id} value={event.id}>{event.name} ({event.startsOn} to {event.endsOn})</option>)}
          </select>
        </label>
        <div className={styles.actions}>
          <button type="button" className="secondary-button" onClick={() => loadPreview(mode === "NEW_VERSION" ? templateId : "")} disabled={busy || !sourceEventId}>
            {busy && !preview ? "Preparing the preview..." : preview ? "Refresh the preview" : "Preview what will be copied"}
          </button>
        </div>
      </section>

      {preview ? (
        <>
          <section className="panel form-stack event-settings-panel" aria-live="polite">
            <h2 className={styles.heading}>What will be copied from {preview.source.name}</h2>
            <p className={`field-help ${styles.hint}`}>Only configuration is copied, as a draft template version. Nothing is copied unless it is listed here.</p>
            <ul className={styles.domainList}>
              {preview.domains.map((domain) => (
                <li key={domain.key} className={styles.domain}>
                  <span><strong>{domain.label}</strong><span className={styles.count}>{domain.count === 0 ? "nothing to copy" : domain.count}</span></span>
                  {domain.items.length > 0 ? <ul className={styles.names}>{domain.items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : null}
                  {domain.notes.map((note) => <p key={note} className={styles.note}>{note}</p>)}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel form-stack event-settings-panel">
            <h2 className={styles.heading}>What will not be copied</h2>
            <ul className={styles.exclusionList}>
              {preview.exclusions.map((entry) => (
                <li key={entry.key} className={styles.exclusion}>
                  <span><strong>{entry.label}</strong>{entry.count === null ? null : <span className={styles.count}>{entry.count}</span>}</span>
                  <p className={styles.note}>{entry.reason}</p>
                  {entry.details.length > 0 ? <ul className={styles.details}>{entry.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul> : null}
                </li>
              ))}
            </ul>
            <p className={styles.note}>Never copied, whatever the event holds:</p>
            <ul className={styles.plainList}>
              {preview.neverCopied.map((entry) => <li key={entry}>{entry}</li>)}
            </ul>
          </section>

          <section className="panel form-stack event-settings-panel">
            <h2 className={styles.heading}>Save it</h2>
            <label className={styles.choice}>
              <input type="radio" name="template-target" checked={mode === "NEW"} onChange={() => { setMode("NEW"); if (templateId) loadPreview(); }} />
              A new template
            </label>
            <label className={styles.choice}>
              <input type="radio" name="template-target" checked={mode === "NEW_VERSION"} onChange={() => setMode("NEW_VERSION")} />
              A new version of an existing template
            </label>
            {mode === "NEW" ? (
              <>
                <label className={styles.label}>Template name
                  <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
                </label>
                <label className={styles.label}>Description (optional)
                  <textarea value={description} maxLength={2000} rows={3} onChange={(event) => setDescription(event.target.value)} />
                </label>
              </>
            ) : (
              <label className={styles.label}>Template
                <select value={templateId} onChange={(event) => { setTemplateId(event.target.value); loadPreview(event.target.value); }}>
                  <option value="">Choose a template</option>
                  {availableTemplates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}{template.hasDraft ? " (has a draft)" : ""}</option>
                  ))}
                </select>
                <span className={`field-help ${styles.hint}`}>Only templates for {preview.source.audience === "CLUB" ? "club" : "general"} events are listed. A template that already has a draft cannot take another: publish it or edit it in the template editor first, or save as a new template.</span>
              </label>
            )}
            {mode === "NEW_VERSION" ? (
              <p className={`field-help ${styles.hint}`}>A new version keeps the template&apos;s own report selections, form templates, registration deadline and starter identity from its current version. The event adds its forms alongside.</p>
            ) : null}
            {mode === "NEW_VERSION" && targetTemplate?.hasDraft ? (
              <p className="inline-notice error" role="alert">This template already has a draft. Publish it or edit it in the template editor first, or save as a new template.</p>
            ) : null}
            <label className={styles.label}>Release note (required)
              <textarea value={releaseNote} maxLength={2000} rows={3} onChange={(event) => setReleaseNote(event.target.value)} />
              <span className={`field-help ${styles.hint}`}>Say why this version is being saved. It is kept with the version.</span>
            </label>
            <div className={styles.actions}>
              <button type="button" className="primary-button" onClick={save} disabled={busy || !complete}>
                {busy ? "Saving..." : "Save as a draft template version"}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
