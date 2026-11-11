"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SortableHeader, SortOrderNote } from "@/components/list-sort";
import { cardCell } from "@/components/table-card-labels";
import type { SortDirection } from "@/lib/list-sort";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import {
  REMINDER_MAX_PEOPLE,
  REMINDER_RECENT_DAYS,
  expiryOrMissingText,
  isReminderState,
  reminderFilterLabels,
  type ReminderFilter,
  type SterlingActionRow,
} from "@/modules/background-checks/reminders-domain";
import styles from "./sterling-follow-up.module.css";

type Selection = { rosterMemberIds: string[] } | { filter: ReminderFilter; all: true };
type PreviewMessage = { key: string; to: { email: string; name: string }; label: string; about: string[]; subject: string; bodyText: string };
type Preview = {
  fingerprint: string;
  selected: number;
  directorOnly: number;
  recipients: Array<{ key: string; name: string; email: string; label: string }>;
  messages: PreviewMessage[];
  noRecipient: Array<{ rosterMemberId: string; name: string; clubName: string }>;
  recentlyReminded: Array<{ rosterMemberId: string; name: string; clubName: string; remindedAt: string }>;
};
type SendResult = { people: number; directorEmails: number; volunteerEmails: number; noRecipient: number };
type SortColumn = { href: string; active: boolean; direction: SortDirection };

function dateText(iso: string) {
  return formatInConferenceTime(iso, { month: "long", day: "numeric", year: "numeric" });
}

const emptyText: Record<ReminderFilter, string> = {
  expiring: "Nobody is expiring soon. Choose Not current or All to see other people.",
  "not-current": "Nobody is missing a current check. Choose Expiring soon or All to see other people.",
  all: "No active adults or staff are on this year's club rosters yet. Rosters come from club imports and from directors.",
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * "People to follow up" (#1844): the filtered list with a checkbox per person, and the reminder flow behind Send
 * reminder. The preview shows exactly what would be sent; nothing goes out until Send is pressed in it, and a recent
 * reminder asks for a second, deliberate confirmation.
 */
export function SterlingFollowUp({ rows, filter, reminderTotal, columns, sortNote }: {
  rows: SterlingActionRow[];
  filter: ReminderFilter;
  /** Of those, how many a reminder can go about (everyone but the people whose check is current). */
  reminderTotal: number;
  columns: Record<"name" | "club" | "expires", SortColumn>;
  sortNote: string | null;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [allInFilter, setAllInFilter] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewFor, setPreviewFor] = useState<Selection | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<Preview["recentlyReminded"] | null>(null);
  const [done, setDone] = useState<SendResult | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const selectable = rows.filter((row) => isReminderState(row.state));
  const allPageSelected = selectable.length > 0 && selectable.every((row) => picked.has(row.rosterMemberId));
  const selectedCount = allInFilter ? reminderTotal : picked.size;
  const hasMoreThanPage = reminderTotal > selectable.length;
  const overCap = reminderTotal > REMINDER_MAX_PEOPLE;
  const canSelectAllInFilter = hasMoreThanPage && !overCap && !allInFilter;
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (done) resultRef.current?.focus();
  }, [done]);

  function toggle(id: string) {
    setAllInFilter(false);
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setAllInFilter(false);
    setPicked(allPageSelected ? new Set() : new Set(selectable.map((row) => row.rosterMemberId)));
  }

  function clearSelection() {
    setAllInFilter(false);
    setPicked(new Set());
  }

  async function post(url: string, body: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
  }

  async function openPreview() {
    if (loading || selectedCount === 0) return;
    const selection: Selection = allInFilter ? { filter, all: true } : { rosterMemberIds: [...picked] };
    setLoading(true);
    setError("");
    setDone(null);
    try {
      const { ok, data } = await post("/api/admin/background-checks/reminders/preview", { selection });
      if (!ok) throw new Error(data.message ?? "The preview couldn't be built.");
      setPreview(data.preview as Preview);
      setPreviewFor(selection);
      setRecent(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The preview couldn't be built.");
    } finally {
      setLoading(false);
    }
  }

  function closePreview() {
    setPreview(null);
    setPreviewFor(null);
    setRecent(null);
    setError("");
    // Back to the button that opened the preview.
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  async function send(confirmRecent: boolean) {
    if (!preview || !previewFor) return;
    setSending(true);
    setError("");
    try {
      const { ok, data } = await post("/api/admin/background-checks/reminders", { selection: previewFor, fingerprint: preview.fingerprint, confirmRecent });
      if (!ok) {
        if (data.error === "RECENTLY_REMINDED" && Array.isArray(data.details?.recentlyReminded)) {
          setRecent(data.details.recentlyReminded);
          return;
        }
        throw new Error(data.message ?? "The reminders couldn't be sent.");
      }
      setDone(data.result as SendResult);
      closePreview();
      clearSelection();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The reminders couldn't be sent.");
    } finally {
      setSending(false);
    }
  }

  // The first Send press sends what was previewed. If the server finds a recent reminder it refuses, and only a second, deliberate press ("Send anyway") sends it again.
  const needsConfirm = recent !== null;
  const shownRecent = recent ?? preview?.recentlyReminded ?? [];

  return (
    <div>
      {done && (
        <div className="inline-notice" ref={resultRef} role="status" tabIndex={-1}>
          <strong>Reminders sent.</strong>{" "}
          {plural(done.people, "person", "people")} covered: {plural(done.directorEmails, "email", "emails")} to club directors and {plural(done.volunteerEmails, "email", "emails")} to volunteers.
          {done.noRecipient > 0 && <> {plural(done.noRecipient, "person has", "people have")} no email to send to and {done.noRecipient === 1 ? "was" : "were"} left out.</>}
        </div>
      )}
      {error && !preview && <div className="inline-notice error" role="alert">{error}</div>}

      <div className={styles.toolbar}>
        <button aria-busy={loading || undefined} aria-disabled={selectedCount === 0 || loading || undefined} className={`primary-button ${styles.sendTrigger}`} onClick={() => void openPreview()} ref={triggerRef} type="button">
          <Mail aria-hidden="true" size={16} /> {loading ? "Preparing the preview…" : "Send reminder"}
        </button>
        {selectable.length > 0 && (
          <label className={styles.selectPage}>
            <input checked={allInFilter || allPageSelected} disabled={allInFilter} onChange={togglePage} type="checkbox" />
            <span>Select everyone on this page</span>
          </label>
        )}
        {canSelectAllInFilter && (
          <button className="secondary-button" onClick={() => setAllInFilter(true)} type="button">Select all {reminderTotal} in this filter</button>
        )}
        {selectedCount > 0 && <button className="secondary-button" onClick={clearSelection} type="button">Clear selection</button>}
        <p role="status">
          {selectedCount === 0
            ? "Choose people to remind."
            : `${plural(selectedCount, "person", "people")} selected${allInFilter ? ` (all in ${reminderFilterLabels[filter]})` : ""}.`}
        </p>
      </div>
      {overCap && hasMoreThanPage && (
        <p className="field-help">
          This filter has {reminderTotal} people, more than the {REMINDER_MAX_PEOPLE} one reminder can cover. Sort by club and select a page at a time to send in smaller groups.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="report-empty">{emptyText[filter]}</p>
      ) : (
        <div className="report-table-wrap">
          {sortNote && <SortOrderNote>{sortNote}</SortOrderNote>}
          <table className="report-table table-cards" role="table">
            <caption className="sr-only">People to follow up on Sterling Volunteers</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col"><span className="sr-only">Select</span></th>
                <SortableHeader active={columns.name.active} direction={columns.name.direction} href={columns.name.href} label="Name" />
                <SortableHeader active={columns.club.active} direction={columns.club.direction} href={columns.club.href} label="Club" />
                <th role="columnheader" scope="col">Role</th>
                <th role="columnheader" scope="col">Status</th>
                <SortableHeader active={columns.expires.active} direction={columns.expires.direction} href={columns.expires.href} label="Expires or missing" />
                <th role="columnheader" scope="col">Reminded</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {rows.map((row) => (
                <tr key={row.rosterMemberId} role="row">
                  <td {...cardCell(null)}>
                    {isReminderState(row.state) ? (
                      <label className={styles.check}>
                        <input checked={allInFilter || picked.has(row.rosterMemberId)} disabled={allInFilter} onChange={() => toggle(row.rosterMemberId)} type="checkbox" />
                        <span className="sr-only">Select {row.name}</span>
                      </label>
                    ) : <span className="sr-only">Current, no reminder needed</span>}
                  </td>
                  <th role="rowheader" scope="row">
                    <Link className="report-record-link" href={row.personHref} translate="no">{row.name}</Link>
                    {!row.hasOwnEmail && isReminderState(row.state) && <span className={styles.noEmail}> No email of their own</span>}
                  </th>
                  <td {...cardCell("Club")}>{row.clubName}</td>
                  <td {...cardCell("Role")}>{row.role}</td>
                  <td {...cardCell("Status")}>{row.statusText}</td>
                  <td {...cardCell("Expires or missing")}>{expiryOrMissingText(row)}</td>
                  <td {...cardCell("Reminded")}>{row.lastRemindedAt ? `Reminded on ${dateText(row.lastRemindedAt)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="field-help">
        Reminders go to the club&apos;s director(s), and to the volunteer too when an email is on file. You see everything that will be sent before anything goes out.
      </p>

      <ConfirmDialog
        busy={sending}
        busyLabel="Sending…"
        confirmDisabled={(preview?.messages.length ?? 0) === 0}
        confirmLabel={needsConfirm ? "Send anyway" : "Send"}
        error={error}
        onCancel={closePreview}
        onConfirm={() => void send(needsConfirm)}
        open={preview !== null}
        title={needsConfirm ? "Some of these people were reminded recently" : "Send this reminder?"}
      >
        {preview && (
          <div className={styles.previewBody}>
            {shownRecent.length > 0 && (
              <section aria-label="Reminded recently">
                <h3>Reminded in the last {REMINDER_RECENT_DAYS} days</h3>
                <ul>
                  {shownRecent.map((person) => (
                    <li key={person.rosterMemberId}><span translate="no">{person.name}</span> ({person.clubName}), reminded on {dateText(person.remindedAt)}</li>
                  ))}
                </ul>
                {recent !== null && <p>Press Send anyway to remind them again, or Cancel to go back.</p>}
              </section>
            )}
            <p>
              {plural(preview.selected - preview.noRecipient.length, "person", "people")} will be reminded through {plural(preview.messages.length, "email", "emails")}.
              {preview.directorOnly > 0 && <> {plural(preview.directorOnly, "person", "people")} will be reached through their club director only.</>}
            </p>
            {preview.noRecipient.length > 0 && (
              <section aria-label="No email to send to">
                <h3>No email to send to ({preview.noRecipient.length})</h3>
                <p>These people have no club director with an email and no email of their own, so nothing is sent for them.</p>
                <ul>
                  {preview.noRecipient.map((person) => <li key={person.rosterMemberId}><span translate="no">{person.name}</span> ({person.clubName})</li>)}
                </ul>
              </section>
            )}
            <section aria-label="Who gets what">
              <h3>Who gets what</h3>
              {preview.messages.length === 0 && <p>Nothing would be sent.</p>}
              {preview.messages.map((message, index) => (
                <details className={styles.message} key={message.key} open={index === 0}>
                  <summary><span><span translate="no">{message.to.name || message.to.email}</span> ({message.label})</span></summary>
                  <p>To: <span translate="no">{message.to.email}</span>. Subject: {message.subject}</p>
                  <pre>{message.bodyText}</pre>
                </details>
              ))}
            </section>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
