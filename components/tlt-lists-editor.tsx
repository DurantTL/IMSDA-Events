"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { TltListEntry } from "@/modules/tlt-directory/repository";
import styles from "./tlt-directory.module.css";

type ListKey = "position" | "tag";

async function send(body: Record<string, string>) {
  const response = await fetch("/api/attendee/area-clubs/tlt-directory/lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(result.message ?? "That could not be saved.");
}

function Entry({ list, entry }: { list: ListKey; entry: TltListEntry }) {
  const router = useRouter();
  const [name, setName] = useState(entry.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(body: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      await send(body);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={styles.entry}>
      <form className={styles.entryRow} onSubmit={(event: FormEvent) => { event.preventDefault(); void run({ action: "rename", list, id: entry.id, name }); }}>
        <input aria-label={`Name of ${entry.name}`} maxLength={60} onChange={(event) => setName(event.target.value)} value={name} />
        <button className="secondary-button" disabled={busy || name.trim() === entry.name} type="submit">Rename</button>
        <button className="secondary-button" disabled={busy} onClick={() => void run({ action: entry.retired ? "restore" : "retire", list, id: entry.id })} type="button">
          {entry.retired ? "Restore" : "Retire"}
        </button>
      </form>
      <p className={styles.entryNote}>
        {entry.retired ? "Retired: not offered for new choices. " : ""}
        {entry.inUse === 0 ? "Not used yet." : `Used by ${entry.inUse} ${entry.inUse === 1 ? "TLT" : "TLTs"}; kept either way.`}
      </p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </li>
  );
}

function ListSection({ list, title, entries, addLabel }: { list: ListKey; title: string; entries: TltListEntry[]; addLabel: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await send({ action: "add", list, name });
      setName("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby={`tlt-list-${list}`}>
      <h3 id={`tlt-list-${list}`}>{title}</h3>
      <form className={styles.entryRow} onSubmit={(event) => void add(event)}>
        <input aria-label={addLabel} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder={addLabel} value={name} />
        <button className="primary-button" disabled={busy || !name.trim()} type="submit">Add</button>
      </form>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <ul className={styles.plain}>
        {entries.map((entry) => <Entry entry={entry} key={entry.id} list={list} />)}
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
