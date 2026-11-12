"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary, summaryMessage, useFormErrorSummary, type ErrorSummaryItem } from "@/components/form-error-summary";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { SubmitButton, submitButtonState } from "@/components/submit-button";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import type { TltListEntry } from "@/modules/tlt-directory/repository";
import styles from "./tlt-directory.module.css";

type ListKey = "position" | "tag";

class SendError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

async function send(body: Record<string, string>) {
  const response = await fetch("/api/attendee/area-clubs/tlt-directory/lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { message?: string; error?: string };
  if (!response.ok) throw new SendError(result.message ?? "That could not be saved.", result.error ?? "");
}

const errorText = (caught: unknown) => (caught instanceof Error ? caught.message : "That could not be saved.");

function Entry({ list, entry, onProblem, onClear }: {
  list: ListKey;
  entry: TltListEntry;
  onProblem: (item: ErrorSummaryItem) => void;
  onClear: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(entry.name);
  const [busy, setBusy] = useState<"rename" | "retire" | null>(null);
  const [fieldError, setFieldError] = useState("");
  const [saved, setSaved] = useState("");
  const [failed, setFailed] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const inputId = `tlt-${list}-${entry.id}-name`;
  const errorId = `${inputId}-error`;
  useUnsavedChangesGuard(name !== entry.name);

  async function run(kind: "rename" | "retire", body: Record<string, string>) {
    setBusy(kind);
    setFieldError("");
    setFailed("");
    setSaved("");
    onClear();
    try {
      await send(body);
      setSaved(savedMessage());
      setConfirming(false);
      router.refresh();
    } catch (caught) {
      if (confirming && kind === "retire") {
        // The confirm dialog is open: show the failure there, where the person is looking.
        setConfirmError(notSavedMessage(errorText(caught)));
      } else if (caught instanceof SendError && (caught.code === "NAME_TAKEN" || caught.code === "INVALID_TLT_REQUEST")) {
        setFieldError(caught.message);
        onProblem({ targetId: inputId, message: summaryMessage(`Name of ${entry.name}`, caught.message) });
      } else {
        setFailed(notSavedMessage(errorText(caught)));
      }
    } finally {
      setBusy(null);
    }
  }
  const retire = submitButtonState({ submitting: busy === "retire", disabled: busy === "rename", label: entry.retired ? "Restore" : "Retire", submittingLabel: "Saving…" });
  return (
    <li className={styles.entry}>
      <form className={styles.entryRow} onSubmit={(event: FormEvent) => { event.preventDefault(); void run("rename", { action: "rename", list, id: entry.id, name }); }}>
        <label className="sr-only" htmlFor={inputId}>Name of {entry.name}</label>
        <input {...fieldErrorProps(errorId, fieldError)} id={inputId} maxLength={60} onChange={(event) => { setName(event.target.value); setFieldError(""); }} value={name} />
        <SubmitButton className="secondary-button" disabled={busy === "retire" || name.trim() === entry.name} label="Rename" submitting={busy === "rename"} submittingLabel="Saving…" />
        <button aria-busy={retire.ariaBusy || undefined} className="secondary-button" disabled={retire.disabled} onClick={() => { if (entry.retired) void run("retire", { action: "restore", list, id: entry.id }); else { setConfirmError(""); setConfirming(true); } }} type="button">
          {retire.label}
        </button>
      </form>
      <FieldError id={errorId}>{fieldError}</FieldError>
      <p className={styles.entryNote}>
        {entry.retired ? "Retired: not offered for new choices. " : ""}
        {entry.inUse === 0 ? "Not used yet." : `Used by ${entry.inUse} ${entry.inUse === 1 ? "TLT" : "TLTs"}; kept either way.`}
      </p>
      <FormMessage message={failed || saved} tone={failed ? "error" : "success"} />
      <ConfirmDialog
        busy={busy === "retire"}
        busyLabel="Retiring…"
        confirmLabel="Retire"
        destructive
        error={confirmError}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void run("retire", { action: "retire", list, id: entry.id })}
        open={confirming}
        title={`Retire ${entry.name}?`}
      >
        <p>
          {list === "position" ? "This position type" : "This tag"} will no longer be offered for new choices.
          {entry.inUse > 0 ? ` ${entry.inUse} ${entry.inUse === 1 ? "TLT keeps" : "TLTs keep"} it.` : ""} Nothing is deleted, and you can restore it later.
        </p>
      </ConfirmDialog>
    </li>
  );
}

function ListSection({ list, title, entries, addLabel }: { list: ListKey; title: string; entries: TltListEntry[]; addLabel: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [saved, setSaved] = useState("");
  const [failed, setFailed] = useState("");
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary, clearField: clearSummaryField } = useFormErrorSummary();
  const inputId = `tlt-${list}-new-name`;
  const errorId = `${inputId}-error`;
  useUnsavedChangesGuard(name.trim() !== "");

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFieldError("");
    setFailed("");
    setSaved("");
    clearSummary();
    try {
      await send({ action: "add", list, name });
      setName("");
      setSaved(savedMessage());
      router.refresh();
    } catch (caught) {
      if (caught instanceof SendError && (caught.code === "NAME_TAKEN" || caught.code === "INVALID_TLT_REQUEST")) {
        setFieldError(caught.message);
        showSummary([{ targetId: inputId, message: summaryMessage(addLabel, caught.message) }]);
      } else {
        setFailed(notSavedMessage(errorText(caught)));
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby={`tlt-list-${list}`}>
      <h3 id={`tlt-list-${list}`}>{title}</h3>
      {summaryItems.length > 0 ? <FormErrorSummary items={summaryItems} ref={summaryRef} /> : null}
      <form className={styles.entryRow} onSubmit={(event) => void add(event)}>
        <label className="sr-only" htmlFor={inputId}>{addLabel}</label>
        <input {...fieldErrorProps(errorId, fieldError)} id={inputId} maxLength={60} onChange={(event) => { setName(event.target.value); setFieldError(""); clearSummaryField(inputId); }} placeholder={addLabel} value={name} />
        <SubmitButton disabled={!name.trim()} label="Add" submitting={busy} submittingLabel="Saving…" />
      </form>
      <FieldError id={errorId}>{fieldError}</FieldError>
      <FormMessage message={failed || saved} tone={failed ? "error" : "success"} />
      <ul className={styles.plain}>
        {entries.map((entry) => (
          <Entry entry={entry} key={entry.id} list={list} onClear={clearSummary} onProblem={(item) => showSummary([item])} />
        ))}
      </ul>
    </section>
  );
}

/** The two managed lists (#1686): add, rename, retire, restore. Nothing is deleted, so a list entry in use is kept. */
export function TltListsEditor({ positions, tags }: { positions: TltListEntry[]; tags: TltListEntry[] }) {
  return (
    <div className={styles.listsGrid}>
      <ListSection addLabel="New position type" entries={positions} list="position" title="Position types" />
      <ListSection addLabel="New help-area tag" entries={tags} list="tag" title="Help-area tags" />
    </div>
  );
}
