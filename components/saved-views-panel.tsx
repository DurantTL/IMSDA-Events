"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { GuardedLink } from "@/components/guarded-link";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { SAVED_VIEW_NAME_MAX, STALE_VIEW_NOTE, type SavedViewItem } from "@/modules/registrations/saved-views-domain";
import styles from "./saved-views-panel.module.css";

/** More views than this in one group fold the rest behind "Show all". */
const VISIBLE_PER_GROUP = 8;

/** The address a view opens: the list for this event with the view's own filters. The page checks them again. */
export function savedViewHref(eventId: string, query: string) {
  const params = new URLSearchParams(query);
  params.set("event", eventId);
  return `/people?${params.toString()}`;
}

/**
 * Saved views of the Registrations list (#1511). A view is only a link with filters in it: opening one runs the
 * list again under the opener's own permissions, so a shared view never shows anyone more than they could already
 * see. The server decides who may save, share or delete; the controls here only follow what it already told the page.
 */
export function SavedViewsPanel({
  eventId,
  views,
  currentQuery,
  canSave,
  canShare,
}: {
  eventId: string;
  views: SavedViewItem[];
  /** The page's canonical query (no page number): what "Save these filters" would store, and what marks the current view. */
  currentQuery: string;
  /** The page has filters, or a sort, worth keeping. */
  canSave: boolean;
  /** The viewer may share views with event staff (and remove other people's shared views). */
  canShare: boolean;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [name, setName] = useState("");
  const [shareNew, setShareNew] = useState(false);
  const [busy, setBusy] = useState(false);
  // Which control is working, so its own label can say so ("Saving…", "Deleting…").
  const [working, setWorking] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // A name typed and not yet saved (rule B6).
  useUnsavedChangesGuard(name.trim() !== "");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const own = views.filter((view) => view.isOwn);
  const shared = views.filter((view) => !view.isOwn);
  const base = `/api/events/${encodeURIComponent(eventId)}/registration-views`;

  async function send(url: string, init: RequestInit, failure: string, key: string) {
    setBusy(true);
    setWorking(key);
    setMessage(null);
    setNameError(false);
    try {
      const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? failure);
      }
      return true;
    } catch (caught) {
      setMessage({ tone: "error", text: notSavedMessage(caught instanceof Error ? caught.message : failure) });
      return false;
    } finally {
      setBusy(false);
      setWorking(null);
    }
  }

  /** After a change the list is redrawn: put focus on the panel's heading so it is not lost to the page. */
  function afterChange() {
    router.refresh();
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || name.trim() === "") return;
    const ok = await send(base, { method: "POST", body: JSON.stringify({ name, query: currentQuery, shared: canShare && shareNew }) }, "the view couldn't be saved.", "save");
    if (!ok) {
      setNameError(true);
      nameRef.current?.focus();
      return;
    }
    setName("");
    setShareNew(false);
    setMessage({ tone: "success", text: savedMessage() });
    afterChange();
  }

  async function toggleShared(view: SavedViewItem) {
    if (busy) return;
    const next = !view.shared;
    const ok = await send(`${base}/${encodeURIComponent(view.id)}`, { method: "PATCH", body: JSON.stringify({ shared: next }) }, "sharing couldn't be changed.", `${view.id}:share`);
    if (!ok) return;
    setMessage({ tone: "success", text: savedMessage(next ? "Event staff can now open this view." : "Only you can see this view now.") });
    afterChange();
  }

  async function remove(view: SavedViewItem) {
    if (busy) return;
    const confirmed = await confirm({
      title: `Delete ${view.name}`,
      body: view.shared ? "This removes the saved view for everyone on the event. No registrations change." : "This removes the saved view. No registrations change.",
      confirmLabel: `Delete ${view.name}`,
      destructive: true,
    });
    if (!confirmed) return;
    const ok = await send(`${base}/${encodeURIComponent(view.id)}`, { method: "DELETE" }, "the view couldn't be deleted.", `${view.id}:delete`);
    if (!ok) return;
    setMessage({ tone: "success", text: "Deleted." });
    afterChange();
  }

  function row(view: SavedViewItem) {
    const noteId = `saved-view-note-${view.id}`;
    const current = view.query === currentQuery;
    const mayChangeSharing = view.isOwn && canShare;
    const mayDelete = view.isOwn || canShare;
    return (
      <li className={styles.item} key={view.id}>
        <div className={styles.itemBody}>
          <GuardedLink aria-current={current ? "true" : undefined} aria-describedby={view.stale ? noteId : undefined} className={styles.link} href={savedViewHref(eventId, view.query)}>
            {view.name}
            {current ? <span className="status-chip green">Current view</span> : null}
            {view.isOwn && view.shared ? <span className="status-chip">Shared</span> : null}
          </GuardedLink>
          {view.ownerName ? <p className={styles.sharedBy}>Shared by {view.ownerName}</p> : null}
          {view.stale ? <p className={styles.note} id={noteId}>{STALE_VIEW_NOTE}</p> : null}
        </div>
        <div className={styles.actions}>
          {mayChangeSharing ? (
            <button aria-disabled={busy || undefined} className="secondary-button" onClick={() => void toggleShared(view)} type="button">
              {working === `${view.id}:share` ? "Saving…" : view.shared ? "Stop sharing" : "Share with event staff"}<span className="sr-only">: {view.name}</span>
            </button>
          ) : null}
          {mayDelete ? (
            <button aria-disabled={busy || undefined} className="secondary-button" onClick={() => void remove(view)} type="button">
              {working === `${view.id}:delete` ? "Deleting…" : "Delete"}<span className="sr-only"> {view.name}</span>
            </button>
          ) : null}
        </div>
      </li>
    );
  }

  function group(list: SavedViewItem[]) {
    const rest = list.slice(VISIBLE_PER_GROUP);
    return (
      <>
        <ul className={styles.list}>{list.slice(0, VISIBLE_PER_GROUP).map(row)}</ul>
        {rest.length > 0 ? (
          <details className={styles.more}>
            <summary>Show all {list.length}</summary>
            <ul className={styles.list}>{rest.map(row)}</ul>
          </details>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby="saved-views-title" className={styles.panel} data-testid="saved-views">
      <h2 className={styles.title} id="saved-views-title" ref={headingRef} tabIndex={-1}>Saved views</h2>
      {views.length === 0 ? <p className={styles.empty}>No saved views yet. Choose some filters, then save them here to open them again.</p> : null}
      {own.length > 0 ? (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Your views</h3>
          {group(own)}
        </div>
      ) : null}
      {shared.length > 0 ? (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Shared with event staff</h3>
          {group(shared)}
        </div>
      ) : null}
      {canSave ? (
        <form className={styles.saveForm} onSubmit={(event) => void save(event)}>
          <label className={styles.field}>
            Name for these filters
            <input aria-describedby={nameError ? "saved-views-message" : undefined} aria-invalid={nameError || undefined} autoComplete="off" maxLength={SAVED_VIEW_NAME_MAX} name="viewName" onChange={(event) => setName(event.target.value)} ref={nameRef} required value={name} />
          </label>
          {canShare ? (
            <label className={styles.check}>
              <input checked={shareNew} onChange={(event) => setShareNew(event.target.checked)} type="checkbox" />
              Share with event staff
            </label>
          ) : null}
          <button aria-busy={busy || undefined} aria-disabled={busy || name.trim() === "" || undefined} className="primary-button" type="submit">
            {working === "save" ? "Saving…" : "Save these filters"}
          </button>
        </form>
      ) : null}
      <div id="saved-views-message"><FormMessage message={message?.text ?? ""} tone={message?.tone ?? "success"} /></div>
      {confirmDialog}
    </section>
  );
}
