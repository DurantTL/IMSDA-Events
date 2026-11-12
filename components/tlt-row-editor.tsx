"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { TLT_STATUSES, TLT_YEARS, tltStatusLabels } from "@/modules/tlt-directory/domain";
import styles from "./tlt-directory.module.css";

type Option = { id: string; name: string };

/**
 * One TLT's four editable fields (#1686): TLT year, position type, status and help-area tags, and nothing else. Retired
 * options are offered only where the TLT already has them, so saving never silently drops one.
 */
export function TltRowEditor({ personId, tltYear, positionTypeId, status, tagIds, positions, tags }: {
  personId: string;
  tltYear: number | null;
  positionTypeId: string | null;
  status: string | null;
  tagIds: string[];
  positions: Option[];
  tags: Option[];
}) {
  const router = useRouter();
  const [year, setYear] = useState(tltYear === null ? "" : String(tltYear));
  const [position, setPosition] = useState(positionTypeId ?? "");
  const [state, setState] = useState(status ?? "");
  const [picked, setPicked] = useState(new Set(tagIds));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const base = `${personId}`;
  const dirty = year !== (tltYear === null ? "" : String(tltYear))
    || position !== (positionTypeId ?? "")
    || state !== (status ?? "")
    || picked.size !== tagIds.length
    || tagIds.some((id) => !picked.has(id));
  useUnsavedChangesGuard(dirty);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/attendee/area-clubs/tlt-directory/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, tltYear: year ? Number(year) : null, positionTypeId: position || null, status: state || null, tagIds: [...picked] }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "That could not be saved.");
      setMessage(savedMessage());
      router.refresh();
    } catch (caught) {
      setError(notSavedMessage(caught instanceof Error ? caught.message : "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className={`${styles.edit} ${styles.noPrint}`}>
      <summary>Edit year, position, status and tags</summary>
      <form className={styles.form} onSubmit={(event) => void save(event)}>
        <label className={styles.field}>TLT year
          <select onChange={(event) => setYear(event.target.value)} value={year}>
            <option value="">Not set</option>
            {TLT_YEARS.map((value) => <option key={value} value={value}>Year {value}</option>)}
          </select>
        </label>
        <label className={styles.field}>Position type
          <select onChange={(event) => setPosition(event.target.value)} value={position}>
            <option value="">Not set</option>
            {positions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        <label className={styles.field}>Status
          <select onChange={(event) => setState(event.target.value)} value={state}>
            <option value="">Not set</option>
            {TLT_STATUSES.map((value) => <option key={value} value={value}>{tltStatusLabels[value]}</option>)}
          </select>
        </label>
        <fieldset className={styles.tagFieldset}>
          <legend>Help-area tags</legend>
          {tags.length === 0 ? <p className={styles.status}>No tags yet. Add some under Manage lists.</p> : null}
          {tags.map((tag) => (
            <label className={styles.check} key={tag.id}>
              <input
                checked={picked.has(tag.id)}
                id={`${base}-${tag.id}`}
                onChange={(event) => setPicked((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(tag.id); else next.delete(tag.id);
                  return next;
                })}
                type="checkbox"
              />
              {tag.name}
            </label>
          ))}
        </fieldset>
        <div>
          <SubmitButton label="Save" submitting={busy} submittingLabel="Saving…" />
        </div>
        <FormMessage message={error || message} tone={error ? "error" : "success"} />
      </form>
    </details>
  );
}
