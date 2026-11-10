"use client";

import Link from "next/link";
import { useState } from "react";
import { ArchiveTemplateDialog } from "@/components/archive-template-dialog";
import type { EventTemplateRecord } from "@/modules/event-templates/repository";
import type { StarterTemplatesResult } from "@/modules/event-templates/starter-repository";
import { eventTemplateRowModel } from "@/components/event-template-list-model";
import styles from "./event-template-list.module.css";
import { pendingStarterEvents, starterEventTemplates } from "@/modules/event-templates/starters";

type EventTemplateListProps = {
  initialTemplates: EventTemplateRecord[];
};

export function EventTemplateList({ initialTemplates }: EventTemplateListProps) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<"GENERAL" | "CLUB">("GENERAL");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [addingStarters, setAddingStarters] = useState(false);
  const [archiving, setArchiving] = useState<EventTemplateRecord | null>(null);
  const [unarchivingId, setUnarchivingId] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [starterResult, setStarterResult] = useState<StarterTemplatesResult | null>(null);

  async function addStarterTemplates() {
    setAddingStarters(true);
    setError("");
    try {
      const response = await fetch("/api/event-templates/starters", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The starter templates could not be added.");
      setStarterResult(body as StarterTemplatesResult);
      const listResponse = await fetch("/api/event-templates", { cache: "no-store" });
      const listBody = await listResponse.json();
      if (listResponse.ok) setTemplates(listBody.templates);
    } catch (startersError) {
      setError(startersError instanceof Error ? startersError.message : "The starter templates could not be added.");
    } finally {
      setAddingStarters(false);
    }
  }

  async function createTemplate() {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/event-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, audience }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The template could not be created.");
      setTemplates((current) => [body.template, ...current]);
      setName("");
      setDescription("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The template could not be created.");
    } finally {
      setCreating(false);
    }
  }

  async function archiveTemplate(templateId: string) {
    setArchiveBusy(true);
    setArchiveError("");
    try {
      const response = await fetch(`/api/event-templates/${templateId}/archive`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The template could not be archived.");
      setTemplates((current) => current.map((template) => (template.id === templateId ? body.template : template)));
      setArchiving(null);
    } catch (archiveFailure) {
      setArchiveError(archiveFailure instanceof Error ? archiveFailure.message : "The template could not be archived.");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function unarchiveTemplate(templateId: string) {
    if (unarchivingId) return;
    setUnarchivingId(templateId);
    setError("");
    try {
      const response = await fetch(`/api/event-templates/${templateId}/unarchive`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The template could not be unarchived.");
      setTemplates((current) => current.map((template) => (template.id === templateId ? body.template : template)));
    } catch (unarchiveError) {
      setError(unarchiveError instanceof Error ? unarchiveError.message : "The template could not be unarchived.");
    } finally {
      setUnarchivingId(null);
    }
  }

  const active = templates.filter((template) => template.status !== "ARCHIVED");
  const archived = templates.filter((template) => template.status === "ARCHIVED");

  function renderRow(template: EventTemplateRecord, Heading: "h3" | "h4" = "h3") {
    const row = eventTemplateRowModel(template);
    return (
      <li className={styles.row} key={template.id}>
        <div className={styles.body}>
          <div className={styles.titleLine}>
            <Heading className={styles.name}>{template.name}</Heading>
            <span className={`status-chip ${row.statusChip.tone}`}>{row.statusChip.label}</span>
            <span className="status-chip neutral">{row.audienceLabel}</span>
          </div>
          <p className={styles.purpose}>{template.description || "No description."}</p>
          <p className={styles.meta}>{row.versionLine}. {row.provenanceLine}.</p>
          <p className={styles.meta}>{row.availabilityLine}</p>
        </div>
        <div className={`row-actions ${styles.actions}`}>
          <Link className="secondary-button" href={`/admin/event-templates/${template.id}`} aria-label={`Edit ${template.name}`}>Edit</Link>
          {template.status !== "ARCHIVED" ? (
            <button type="button" className="secondary-button" aria-label={`Archive ${template.name}`} onClick={() => { setArchiveError(""); setArchiving(template); }}>Archive</button>
          ) : (
            <button type="button" className="secondary-button" aria-label={`Unarchive ${template.name}`} disabled={unarchivingId !== null} onClick={() => unarchiveTemplate(template.id)}>{unarchivingId === template.id ? "Unarchiving…" : "Unarchive"}</button>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="page-stack template-list">
      {error ? <div className="inline-notice error" role="alert">{error}</div> : null}

      <section className="panel form-stack event-settings-panel dense-rows">
        <div className="section-heading"><div><h2>Templates</h2></div><span className="count-badge">{templates.length} {templates.length === 1 ? "template" : "templates"}</span></div>
        {templates.length === 0 ? (
          <div className="inline-notice" role="status">
            <p>No event templates yet. Add the starter templates below, or <Link href="/admin/event-templates/from-event">save an event as a template</Link>.</p>
          </div>
        ) : (
          <>
            <ul className={styles.rows}>{active.map((template) => renderRow(template))}</ul>
            {archived.length > 0 ? (
              <>
                <h3 className={styles.name}>Archived</h3>
                <ul className={styles.rows}>{archived.map((template) => renderRow(template, "h4"))}</ul>
              </>
            ) : null}
          </>
        )}
      </section>

      <section className="panel form-stack event-settings-panel">
        <div className="section-heading"><div><h2>Starter templates</h2></div></div>
        <p>Adds a published template for each real event that has a built-in form, ready to start an event from. Templates that already exist (even renamed, edited, or archived) are left alone.</p>
        <details className={styles.details}>
          <summary>What the starters include</summary>
          <p>
            Starter drafts added earlier are published too, unless someone has edited them. Templates set no
            capacity. Some forms (Women&apos;s Retreat, Man Camp, Spring Camporee, Camp Meeting) keep last year&apos;s
            prices, late-price dates and choice limits; Leadership Weekend keeps its 2026 lodging prices and late-price
            date; Hispanic Institute keeps its 2026 semester price; TLT Retreat is free; Honors Weekend, Fall Camporee and
            Outdoor School have a fee with no amount (it is flagged until you set it); the blank starters have no prices.
            Review each draft event before publishing it. Your own templates still need publishing by hand.
          </p>
          <ul className={styles.starterList}>
            {starterEventTemplates.map((starter) => (
              <li key={starter.starterKey}>{starter.name}</li>
            ))}
            {pendingStarterEvents.map((pending) => (
              <li key={pending.starterKey}>{pending.name} ({pending.note})</li>
            ))}
          </ul>
        </details>
        <div>
          <button type="button" className="secondary-button" disabled={addingStarters} onClick={addStarterTemplates}>
            {addingStarters ? "Adding…" : "Add starter templates"}
          </button>
        </div>
        {starterResult ? (
          <div className="inline-notice" role="status">
            {(starterResult.published ?? []).length > 0 ? <p>Published {starterResult.published.length} earlier draft{starterResult.published.length === 1 ? "" : "s"}: {starterResult.published.map((entry) => entry.name).join(", ")}.</p> : null}
            <p>Added {starterResult.added.length}: {starterResult.added.map((entry) => entry.name).join(", ") || "none"}.</p>
            <p>Skipped {starterResult.skipped.length} that already exist: {starterResult.skipped.map((entry) => `${entry.name}${entry.reason === "ARCHIVED" ? " (archived)" : ""}`).join(", ") || "none"}.</p>
            {starterResult.stillNeeded.length > 0 ? <p>Still needed: {starterResult.stillNeeded.map((entry) => `${entry.name} (${entry.note})`).join(", ")}.</p> : null}
          </div>
        ) : null}
      </section>

      <section className="panel form-stack event-settings-panel">
        <div className="section-heading"><div><h2>New template</h2></div></div>
        <p className="field-help">Starts an empty draft, version 1. Edit it, then publish it so Create event offers it.</p>
        <div className="form-grid two-column">
          <label>Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Weekend retreat" />
          </label>
          <label>Audience
            <select value={audience} onChange={(event) => setAudience(event.target.value as "GENERAL" | "CLUB")}>
              <option value="GENERAL">General</option>
              <option value="CLUB">Club</option>
            </select>
          </label>
        </div>
        <label>Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
        </label>
        <div>
          <button type="button" className="secondary-button" disabled={creating || name.trim().length < 2} onClick={createTemplate}>
            {creating ? "Creating…" : "Create template"}
          </button>
        </div>
      </section>

      <ArchiveTemplateDialog
        busy={archiveBusy}
        error={archiveError}
        name={archiving?.name ?? ""}
        onCancel={() => setArchiving(null)}
        onConfirm={() => { if (archiving) void archiveTemplate(archiving.id); }}
        open={archiving !== null}
      />
    </div>
  );
}
