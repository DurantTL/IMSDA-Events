"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, Save, Send, Undo2 } from "lucide-react";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import {
  publicClubFormsLimits,
  type PublicClubFormSettingItem,
  type PublicClubFormsSettings,
} from "@/modules/club-forms/public-index-settings-domain";
import styles from "./public-club-forms-settings.module.css";

type Props = {
  initial: PublicClubFormsSettings;
  /** The fixed list: each form's id, its name and the groups, from the code. Names are not editable. */
  forms: { id: string; name: string }[];
  groups: { id: string; title: string }[];
  hasDraft: boolean;
  draftUpdatedAt: string | null;
  publishedAt: string | null;
  /** Whether the draft differs from what is live. */
  draftDiffers: boolean;
};

const when = (iso: string | null) => (iso ? formatInConferenceTime(iso, { dateStyle: "medium", timeStyle: "short" }) : "");

async function send(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(result.message ?? "That could not be saved. Try again.");
  return result;
}

/** Changes after a save, publish or discard refresh, so the editor starts again from what is stored. */
export const editorResetKey = (draftUpdatedAt: string | null, publishedAt: string | null) => `${draftUpdatedAt}|${publishedAt}`;

/**
 * Which forms the public Club forms page lists, in what group and order, with what line, plus its intro (#1562). The
 * editor is remounted from the stored values after every refresh (so a discard shows the stored page again); the
 * confirmation message lives out here so it survives that remount.
 */
export function PublicClubFormsSettings(props: Props) {
  const [message, setMessage] = useState("");
  return <Editor {...props} key={editorResetKey(props.draftUpdatedAt, props.publishedAt)} message={message} setMessage={setMessage} />;
}

function Editor({ initial, forms, groups, hasDraft, draftUpdatedAt, publishedAt, draftDiffers, message, setMessage }: Props & { message: string; setMessage: (message: string) => void }) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [intro, setIntro] = useState(initial.intro);
  const [items, setItems] = useState<PublicClubFormSettingItem[]>(initial.items);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const names = new Map(forms.map((form) => [form.id, form.name]));

  function change(next: PublicClubFormSettingItem[]) {
    setItems(next);
    setDirty(true);
  }

  function update(id: string, patch: Partial<PublicClubFormSettingItem>) {
    change(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  /** Moves a form past its neighbour in the same group. */
  function shift(id: string, delta: -1 | 1) {
    const index = items.findIndex((item) => item.id === id);
    const groupId = items[index]?.groupId;
    let target = index + delta;
    while (target >= 0 && target < items.length && items[target].groupId !== groupId) target += delta;
    if (target < 0 || target >= items.length) return;
    const copy = [...items];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    change(copy);
  }

  /** A form moved to another group lands last in it. */
  function regroup(id: string, groupId: string) {
    const moving = items.find((item) => item.id === id);
    if (!moving) return;
    change([...items.filter((item) => item.id !== id), { ...moving, groupId }]);
  }

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const save = () => send("/api/admin/club-forms/public-page", "PUT", { intro, items }).then(() => { setDirty(false); router.refresh(); return "Draft saved. Visitors do not see it until you publish."; });

  // Rule B6: leaving with unsaved edits asks first; saving clears `dirty`, so the question stops.
  useUnsavedChangesGuard(dirty);

  const canPreview = hasDraft && !dirty;

  return (
    <div className={styles.workspace}>
      {confirmDialog}
      <p className={styles.stateBar} role="status">
        {hasDraft ? `Draft saved ${when(draftUpdatedAt)}.` : "No draft."} {publishedAt ? `Published ${when(publishedAt)}.` : "Nothing published yet: visitors see the built-in page."}
        {dirty && " You have unsaved changes."}
      </p>
      <div className={styles.actions}>
        <button className="primary-button" disabled={busy || !dirty} onClick={() => void run(save)} type="button"><Save aria-hidden="true" size={14} /> Save draft</button>
        {canPreview
          ? <a className="secondary-button" href="/admin/club-forms/public-page/preview" rel="noreferrer" target="_blank"><Eye aria-hidden="true" size={14} /> Preview as the public sees it</a>
          : <button className="secondary-button" disabled type="button"><Eye aria-hidden="true" size={14} /> Preview as the public sees it</button>}
        <button
          className="secondary-button"
          disabled={busy || dirty || !hasDraft || !draftDiffers}
          onClick={() => void run(async () => {
            if (!(await confirm({ title: "Publish the Club forms page?", body: <p>Visitors will see these changes right away.</p>, confirmLabel: "Publish" }))) return "";
            await send("/api/admin/club-forms/public-page/publish", "POST");
            router.refresh();
            return "Published. The public Club forms page is updated.";
          })}
          type="button"
        ><Send aria-hidden="true" size={14} /> Publish</button>
        <button
          className="secondary-button"
          disabled={busy || !hasDraft}
          onClick={() => void run(async () => {
            if (!(await confirm({ title: "Discard the draft?", body: <p>The published page is not changed.</p>, confirmLabel: "Discard draft" }))) return "";
            await send("/api/admin/club-forms/public-page", "DELETE");
            router.refresh();
            return "Draft discarded.";
          })}
          type="button"
        ><Undo2 aria-hidden="true" size={14} /> Discard draft</button>
      </div>
      {dirty && <p className={styles.note}>Save the draft to preview or publish it.</p>}
      <p aria-live="polite" className={`${styles.status} ${error ? styles.error : ""}`} role="status">{error || message}</p>

      <label className={styles.intro}>
        Intro text (under &ldquo;Before you begin&rdquo;)
        <textarea maxLength={publicClubFormsLimits.intro} onChange={(event) => { setIntro(event.target.value); setDirty(true); }} rows={3} value={intro} />
        <span className={styles.note}>{intro.length} of {publicClubFormsLimits.intro} characters.</span>
      </label>

      {groups.map((group) => {
        const inGroup = items.filter((item) => item.groupId === group.id);
        return (
          <section aria-labelledby={`pcf-group-${group.id}`} className={styles.group} key={group.id}>
            <h2 id={`pcf-group-${group.id}`}>{group.title}</h2>
            {inGroup.length === 0 && <p className={styles.note}>No forms in this group. It is left off the page.</p>}
            <ul className={styles.list}>
              {inGroup.map((item, position) => {
                const name = names.get(item.id) ?? item.id;
                return (
                  <li className={`${styles.item} ${item.shown ? "" : styles.hiddenItem}`} key={item.id}>
                    <div className={styles.itemHead}>
                      <h3>{name}{item.shown ? "" : " (hidden)"}</h3>
                      <div className={styles.rowButtons}>
                        <button aria-label={`Move ${name} up`} className="secondary-button" disabled={position === 0} onClick={() => shift(item.id, -1)} type="button"><ArrowUp aria-hidden="true" size={14} /></button>
                        <button aria-label={`Move ${name} down`} className="secondary-button" disabled={position === inGroup.length - 1} onClick={() => shift(item.id, 1)} type="button"><ArrowDown aria-hidden="true" size={14} /></button>
                      </div>
                    </div>
                    <div className={styles.fields}>
                      <label className={`${styles.check} ${styles.wide}`}>
                        <input checked={item.shown} onChange={(event) => update(item.id, { shown: event.target.checked })} type="checkbox" />
                        Show on the public page
                      </label>
                      <label>
                        Group
                        <select onChange={(event) => regroup(item.id, event.target.value)} value={item.groupId}>
                          {groups.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
                        </select>
                      </label>
                      <label className={styles.wide}>
                        Short description shown to the public
                        <textarea maxLength={publicClubFormsLimits.description} onChange={(event) => update(item.id, { description: event.target.value })} rows={2} value={item.description} />
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className={styles.note}>Hiding a form only removes it from this page. Whether a form is on, open or closed is still set under Club forms, and a form that is off, closed or sent by private link never gets a public link here.</p>
    </div>
  );
}
