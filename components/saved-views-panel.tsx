"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { GuardedLink } from "@/components/guarded-link";
import { useConfirm } from "@/components/use-confirm";
import { SAVED_VIEW_NAME_MAX, STALE_VIEW_NOTE, type SavedViewItem } from "@/modules/registrations/saved-views-domain";
import styles from "./saved-views-panel.module.css";

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
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const own = views.filter((view) => view.isOwn);
  const shared = views.filter((view) => !view.isOwn);
  const base = `/api/events/${encodeURIComponent(eventId)}/registration-views`;

  async function send(url: string, init: RequestInit, failure: string) {
    setBusy(true);
    setMessage(null);
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
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const ok = await send(base, { method: "POST", body: JSON.stringify({ name, query: currentQuery, shared: canShare && shareNew }) }, "the view couldn't be saved.");
    if (!ok) return;
    setName("");
    setShareNew(false);
    setMessage({ tone: "success", text: savedMessage() });
    router.refresh();
  }

  async function toggleShared(view: SavedViewItem) {
    const next = !view.shared;
    const ok = await send(`${base}/${encodeURIComponent(view.id)}`, { method: "PATCH", body: JSON.stringify({ shared: next }) }, "sharing couldn't be changed.");
    if (!ok) return;
    setMessage({ tone: "success", text: savedMessage(next ? "Event staff can now open this view." : "Only you can see this view now.") });
    router.refresh();
  }

  async function remove(view: SavedViewItem) {
    const confirmed = await confirm({
      title: `Delete ${view.name}`,
      body: view.shared ? "This removes the saved view for everyone on the event. No registrations change." : "This removes the saved view. No registrations change.",
      confirmLabel: `Delete ${view.name}`,
      destructive: true,
    });
    if (!confirmed) return;
    const ok = await send(`${base}/${encodeURIComponent(view.id)}`, { method: "DELETE" }, "the view couldn't be deleted.");
    if (!ok) return;
    setMessage({ tone: "success", text: "Deleted." });
    router.refresh();
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
            {current ? <span className={styles.tag}>Showing now</span> : null}
            {view.isOwn && view.shared ? <span className={styles.tag}>Shared</span> : null}
          </GuardedLink>
          {view.ownerName ? <p className={styles.sharedBy}>Shared by {view.ownerName}</p> : null}
          {view.stale ? <p className={styles.note} id={noteId}>{STALE_VIEW_NOTE}</p> : null}
        </div>
        <div className={styles.actions}>
          {mayChangeSharing ? (
            <button className="secondary-button" disabled={busy} onClick={() => void toggleShared(view)} type="button">
              {view.shared ? "Stop sharing" : "Share with event staff"}<span className="sr-only">: {view.name}</span>
            </button>
          ) : null}
          {mayDelete ? (
            <button className="secondary-button" disabled={busy} onClick={() => void remove(view)} type="button">
              Delete<span className="sr-only"> {view.name}</span>
            </button>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <section aria-labelledby="saved-views-title" className={styles.panel} data-testid="saved-views">
      <h2 className={styles.title} id="saved-views-title">Saved views</h2>
      {views.length === 0 ? <p className={styles.empty}>No saved views yet. Choose some filters, then save them here to open them again.</p> : null}
      {own.length > 0 ? (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Your views</h3>
          <ul className={styles.list}>{own.map(row)}</ul>
        </div>
      ) : null}
      {shared.length > 0 ? (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Shared with event staff</h3>
          <ul className={styles.list}>{shared.map(row)}</ul>
        </div>
      ) : null}
      {canSave ? (
        <form className={styles.saveForm} onSubmit={(event) => void save(event)}>
          <label className={styles.field}>
            Name for these filters
            <input autoComplete="off" maxLength={SAVED_VIEW_NAME_MAX} name="viewName" onChange={(event) => setName(event.target.value)} required value={name} />
          </label>
          {canShare ? (
            <label className={styles.check}>
              <input checked={shareNew} onChange={(event) => setShareNew(event.target.checked)} type="checkbox" />
              Share with event staff
            </label>
          ) : null}
          <button aria-busy={busy || undefined} className="primary-button" disabled={busy || name.trim() === ""} type="submit">
            {busy ? "Saving…" : "Save these filters"}
          </button>
        </form>
      ) : null}
      <FormMessage message={message?.text ?? ""} tone={message?.tone ?? "success"} />
      {confirmDialog}
    </section>
  );
}
