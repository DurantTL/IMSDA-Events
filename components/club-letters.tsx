"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary, summaryMessage, useFormErrorSummary } from "@/components/form-error-summary";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { formatPersonName } from "@/lib/person-name";
import {
  CLUB_LETTER_KINDS,
  LETTERS_PER_CLUB_MAX,
  LETTER_BODY_MAX,
  LETTER_PLACEHOLDERS,
  LETTER_TITLE_MAX,
  PRINT_PEOPLE_MAX,
  clubLetterKindLabels,
  placeholderProblem,
  type ClubLetterKindValue,
  type ClubLetterView,
} from "@/modules/club-letters/domain";
import type { ClubLetterPerson } from "@/modules/club-letters/repository";
import styles from "./club-letters.module.css";

/**
 * The letters page (#1708): the club's templates with add, change and delete, the list of placeholders, and the print
 * step that picks a template and the people to fill it in for. Printing opens a page; nothing is sent to anyone. The
 * routes check the role and the feature again and record every change.
 */

const dateText = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", dateStyle: "medium" });

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

type FieldKey = "title" | "body";

function LetterForm({
  organizationId, letter, idBase, submitLabel, onDone,
}: { organizationId: string; letter?: ClubLetterView; idBase: string; submitLabel: string; onDone?: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<ClubLetterKindValue>(letter?.kind ?? "LETTER");
  const [title, setTitle] = useState(letter?.title ?? "");
  const [body, setBody] = useState(letter?.body ?? "");
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const [saved, setSaved] = useState("");
  const base = `/api/attendee/clubs/${encodeURIComponent(organizationId)}/letters`;
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary, clearField: clearSummaryField } = useFormErrorSummary();
  const dirty = kind !== (letter?.kind ?? "LETTER") || title !== (letter?.title ?? "") || body !== (letter?.body ?? "");
  useUnsavedChangesGuard(dirty, "You have an unsaved letter. Leave this page and discard it?");
  const labels: Record<FieldKey, string> = { title: "Title", body: "Text" };
  const fieldId = (key: string) => `${idBase}-${key}`;

  function report(found: Partial<Record<FieldKey, string>>) {
    setErrors(found);
    showSummary((Object.keys(found) as FieldKey[]).map((key) => ({ targetId: fieldId(key), message: summaryMessage(labels[key], found[key]!) })));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed("");
    setSaved("");
    clearSummary();
    const found: Partial<Record<FieldKey, string>> = {};
    if (!title.trim()) found.title = "Enter a title.";
    if (!body.trim()) found.body = "Enter the text of the letter.";
    else if (placeholderProblem(body)) found.body = placeholderProblem(body)!;
    if (Object.keys(found).length > 0) {
      report(found);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await request(letter ? `${base}/${encodeURIComponent(letter.id)}` : base, { method: letter ? "PATCH" : "POST", body: JSON.stringify({ kind, title, body }) });
      if (!letter) { setTitle(""); setBody(""); setKind("LETTER"); }
      setSaved(savedMessage());
      router.refresh();
      onDone?.();
    } catch (caught) {
      const mapped: Partial<Record<FieldKey, string>> = {};
      if (caught instanceof RequestError) {
        for (const issue of caught.issues) {
          const key = issue.path?.[0];
          if ((key === "title" || key === "body") && !mapped[key]) mapped[key] = issue.message ?? "Check this field.";
        }
      }
      if (Object.keys(mapped).length > 0) report(mapped);
      else setFailed(notSavedMessage(caught instanceof Error ? caught.message : "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  const id = fieldId;
  return (
    <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
      {summaryItems.length > 0 ? <FormErrorSummary items={summaryItems} ref={summaryRef} /> : null}
      <div className={styles.field}>
        <label htmlFor={id("kind")}>Type</label>
        <select id={id("kind")} onChange={(event) => setKind(event.target.value as ClubLetterKindValue)} value={kind}>
          {CLUB_LETTER_KINDS.map((item) => <option key={item} value={item}>{clubLetterKindLabels[item]}</option>)}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor={id("title")}>Title</label>
        <input id={id("title")} {...fieldErrorProps(id("title-error"), errors.title)} maxLength={LETTER_TITLE_MAX} onChange={(event) => { setTitle(event.target.value); setErrors((c) => ({ ...c, title: undefined })); clearSummaryField(id("title")); }} value={title} />
        <FieldError id={id("title-error")}>{errors.title}</FieldError>
      </div>
      <div className={styles.field}>
        <label htmlFor={id("body")}>Text</label>
        <textarea id={id("body")} {...fieldErrorProps(id("body-error"), errors.body, id("body-help"))} maxLength={LETTER_BODY_MAX} onChange={(event) => { setBody(event.target.value); setErrors((c) => ({ ...c, body: undefined })); clearSummaryField(id("body")); }} value={body} />
        <small className={styles.help} id={id("body-help")}>Plain text. Put a placeholder such as {"{first_name}"} where each person&apos;s details go.</small>
        <FieldError id={id("body-error")}>{errors.body}</FieldError>
      </div>
      <div>
        <SubmitButton icon={letter ? <Pencil aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />} label={submitLabel} submitting={busy} submittingLabel="Saving…" />
        <FormMessage message={failed || saved} tone={failed ? "error" : "success"} />
      </div>
    </form>
  );
}

function LetterCard({ organizationId, letter }: { organizationId: string; letter: ClubLetterView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await request(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/letters/${encodeURIComponent(letter.id)}`, { method: "DELETE" });
      setConfirming(false);
      router.refresh();
    } catch (caught) {
      setError(notSavedMessage(caught instanceof Error ? caught.message : "That could not be deleted."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <h4 className={styles.cardTitle}>{letter.title}</h4>
        <p className={styles.meta}>{`${clubLetterKindLabels[letter.kind]} · Updated ${dateText(letter.updatedAt)}`}</p>
      </div>
      <div className={styles.actions}>
        <button aria-expanded={editing} className="secondary-button" onClick={() => setEditing((current) => !current)} type="button">
          <Pencil aria-hidden="true" size={16} /> {editing ? "Close" : "Edit"}<span className="sr-only">{` ${letter.title}`}</span>
        </button>
        <button className="secondary-button" onClick={() => { setError(""); setConfirming(true); }} type="button">
          <Trash2 aria-hidden="true" size={16} /> Delete<span className="sr-only">{` ${letter.title}`}</span>
        </button>
      </div>
      {editing && <LetterForm idBase={`letter-${letter.id}`} letter={letter} onDone={() => setEditing(false)} organizationId={organizationId} submitLabel="Save changes" />}
      <ConfirmDialog
        busy={busy}
        busyLabel="Deleting…"
        confirmLabel={`Delete ${letter.kind === "CERTIFICATE" ? "certificate" : "letter"}`}
        destructive
        error={error}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void remove()}
        open={confirming}
        title={`Delete ${letter.title}?`}
      >
        <p>This deletes the template from your club. The change is recorded, but the template cannot be brought back; you would write it again.</p>
      </ConfirmDialog>
    </li>
  );
}

function PrintStep({ organizationId, letters, people }: { organizationId: string; letters: ClubLetterView[]; people: ClubLetterPerson[] }) {
  const [templateId, setTemplateId] = useState(letters[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const chosen = letters.some((letter) => letter.id === templateId) ? templateId : (letters[0]?.id ?? "");
  const tooMany = picked.length > PRINT_PEOPLE_MAX;
  const ready = Boolean(chosen) && picked.length > 0 && !tooMany;
  const href = `/account/clubs/${encodeURIComponent(organizationId)}/letters/${encodeURIComponent(chosen)}/print?people=${picked.map(encodeURIComponent).join(",")}`;
  if (letters.length === 0) return <p className="inline-notice">Add a letter or certificate above, then come back here to print it for your people.</p>;
  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="letters-print-template">Letter or certificate</label>
        <select id="letters-print-template" onChange={(event) => setTemplateId(event.target.value)} value={chosen}>
          {letters.map((letter) => <option key={letter.id} value={letter.id}>{`${letter.title} (${clubLetterKindLabels[letter.kind]})`}</option>)}
        </select>
      </div>
      {people.length === 0
        ? <p className="inline-notice">Nobody is on this year&apos;s roster yet.</p>
        : (
          <fieldset className={styles.fieldset}>
            <legend className={styles.meta}>People to print for</legend>
            <div className={styles.actions}>
              <button className="secondary-button" onClick={() => setPicked(people.map((person) => person.personId))} type="button">Select all</button>
              <button className="secondary-button" onClick={() => setPicked([])} type="button">Select none</button>
              <span aria-live="polite" className={styles.meta}>{`${picked.length} selected`}</span>
            </div>
            <ul className={styles.people}>
              {people.map((person) => {
                const inputId = `letters-person-${person.personId}`;
                return (
                  <li className={styles.person} key={person.personId}>
                    <label htmlFor={inputId}>
                      <input
                        checked={picked.includes(person.personId)}
                        id={inputId}
                        onChange={(event) => setPicked((current) => (event.target.checked ? [...current, person.personId] : current.filter((item) => item !== person.personId)))}
                        type="checkbox"
                      />
                      {formatPersonName(person)}<span className={styles.meta}>{` · ${person.typeLabel}`}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}
      {tooMany && <p className="inline-notice" role="alert">{`Choose at most ${PRINT_PEOPLE_MAX} people at a time.`}</p>}
      <div className={styles.actions}>
        {ready
          ? <Link className="primary-button" href={href}><Printer aria-hidden="true" size={16} /> Open print view</Link>
          : <button aria-disabled="true" className="primary-button" disabled type="button"><Printer aria-hidden="true" size={16} /> Open print view</button>}
      </div>
    </div>
  );
}

export function ClubLetters({ organizationId, letters, people }: { organizationId: string; letters: ClubLetterView[]; people: ClubLetterPerson[] }) {
  return (
    <>
      <section aria-labelledby="letters-templates-heading" className={styles.section}>
        <h3 className={styles.sectionTitle} id="letters-templates-heading">Your letters and certificates</h3>
        {letters.length === 0
          ? <p className="inline-notice">Nothing written yet.</p>
          : <ul className={styles.list}>{letters.map((letter) => <LetterCard key={letter.id} letter={letter} organizationId={organizationId} />)}</ul>}
        {letters.length >= LETTERS_PER_CLUB_MAX
          ? <p className="inline-notice">{`A club can keep ${LETTERS_PER_CLUB_MAX} letters and certificates. Delete one to add another.`}</p>
          : (
            <details className={styles.add}>
              <summary><Plus aria-hidden="true" size={16} /> Add a letter or certificate</summary>
              <LetterForm idBase="letter-new" organizationId={organizationId} submitLabel="Add" />
            </details>
          )}
      </section>
      <section aria-labelledby="letters-placeholders-heading" className={styles.section}>
        <h3 className={styles.sectionTitle} id="letters-placeholders-heading">Placeholders</h3>
        <p className={styles.help}>Type these exactly, with the braces. Each is filled in for the person when you print. Nothing else can be filled in.</p>
        <ul className={styles.placeholders}>
          {LETTER_PLACEHOLDERS.map((item) => <li key={item.key}><code>{`{${item.key}}`}</code>{` ${item.label}`}</li>)}
        </ul>
      </section>
      <section aria-labelledby="letters-print-heading" className={styles.section}>
        <h3 className={styles.sectionTitle} id="letters-print-heading">Print</h3>
        <p className={styles.help}>Pick a template and the people to fill it in for. The print view opens with one page each; use your browser&apos;s Print, then choose Save as PDF if you want a file. Nothing is emailed.</p>
        <PrintStep letters={letters} organizationId={organizationId} people={people} />
      </section>
    </>
  );
}
