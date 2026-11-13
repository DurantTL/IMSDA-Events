"use client";

import { useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import type { ClubDraftReminderOverview } from "@/modules/club-registrations/draft-reminders-domain";
import styles from "./club-draft-reminder-settings.module.css";

const FIELDS = [
  { key: "firstAfterDays", label: "Days before the first reminder", hint: "Counted from the last time the club edited its registration." },
  { key: "repeatEveryDays", label: "Days between reminders", hint: "Waits again from any edit the club makes." },
  { key: "maxReminders", label: "Most reminders per registration", hint: "No more than this, ever." },
  { key: "staleAfterDays", label: "Days until a draft expires", hint: "A registration not edited for this long is left alone." },
] as const;

type FieldKey = typeof FIELDS[number]["key"];

function whenLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long", day: "numeric", year: "numeric" }).format(new Date(iso));
}

/**
 * Staff settings for reminders to clubs with an unsubmitted registration (#164), on the Scheduled emails page. Off until
 * turned on. The preview is counts and dates only: no club name, no person, no answer. The route checks access again.
 */
export function ClubDraftReminderSettings({ eventId, eventTimezone, initial }: { eventId: string; eventTimezone: string; initial: ClubDraftReminderOverview }) {
  const [overview, setOverview] = useState(initial);
  const [enabled, setEnabled] = useState(initial.policy.enabled);
  const [values, setValues] = useState<Record<FieldKey, string>>({
    firstAfterDays: String(initial.policy.firstAfterDays),
    repeatEveryDays: String(initial.policy.repeatEveryDays),
    maxReminders: String(initial.policy.maxReminders),
    staleAfterDays: String(initial.policy.staleAfterDays),
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Typed numbers that are not saved yet. The switch saves on its own, so only the numbers count.
  useUnsavedChangesGuard(FIELDS.some((field) => values[field.key] !== String(overview.policy[field.key])));

  async function save(nextEnabled: boolean) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/club-draft-reminders`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: nextEnabled,
          firstAfterDays: Number(values.firstAfterDays),
          repeatEveryDays: Number(values.repeatEveryDays),
          maxReminders: Number(values.maxReminders),
          staleAfterDays: Number(values.staleAfterDays),
        }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string; overview?: ClubDraftReminderOverview };
      if (!response.ok || !result.overview) {
        setMessage({ tone: "error", text: notSavedMessage(result.message ?? "The change could not be saved.") });
        return;
      }
      setOverview(result.overview);
      setEnabled(result.overview.policy.enabled);
      setValues({
        firstAfterDays: String(result.overview.policy.firstAfterDays),
        repeatEveryDays: String(result.overview.policy.repeatEveryDays),
        maxReminders: String(result.overview.policy.maxReminders),
        staleAfterDays: String(result.overview.policy.staleAfterDays),
      });
      setMessage({ tone: "success", text: savedMessage(result.overview.policy.enabled ? "Reminders are on for this event." : "Reminders are off. Nothing will be sent.") });
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setSaving(false);
    }
  }

  const { counts, limits } = overview;
  return (
    <section className={styles.card} aria-labelledby="club-draft-reminders-heading">
      <h2 className={styles.heading} id="club-draft-reminders-heading">Reminders for unfinished club registrations</h2>
      <p className={styles.note}>
        A club director who started a registration and has not submitted it gets a short email to the club&apos;s director and deputy.
        It names the club and the event and links to the club&apos;s registration page. It never includes anything the club typed.
        Nothing is sent until it is turned on, and only between 9:00 and 19:00 in {eventTimezone}.
      </p>
      <div className={styles.switchRow}>
        <span className={styles.state} data-testid="club-draft-reminder-state">{enabled ? "Reminders are on for this event." : "Reminders are off for this event."}</span>
        <button
          aria-busy={saving || undefined}
          className="secondary-button"
          disabled={saving}
          onClick={() => void save(!enabled)}
          type="button"
        >
          {saving ? "Saving…" : enabled ? "Turn off" : "Turn on"}
          <span className="sr-only"> the reminders for unfinished club registrations</span>
        </button>
      </div>
      {!overview.emailOn && <p className={styles.note}>Email for this event is paused or not sending real email, so reminders are held until it is.</p>}
      {!overview.registrationOpen && <p className={styles.note}>Registration for this event is not open, so no reminders are sent.</p>}
      <form
        onSubmit={(event) => { event.preventDefault(); void save(enabled); }}
        aria-label="Reminder timing"
      >
        <fieldset className={styles.fields} disabled={saving}>
          <legend className="sr-only">Reminder timing</legend>
          {FIELDS.map((field) => (
            <label className={styles.field} key={field.key}>
              {field.label}
              <input
                inputMode="numeric"
                max={limits[field.key][1]}
                min={limits[field.key][0]}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                step={1}
                type="number"
                value={values[field.key]}
              />
              <span className={styles.hint}>{field.hint} {limits[field.key][0]} to {limits[field.key][1]}.</span>
            </label>
          ))}
        </fieldset>
        <div className={styles.actions}>
          <button aria-busy={saving || undefined} className="secondary-button" disabled={saving} type="submit">{saving ? "Saving…" : "Save timing"}</button>
        </div>
      </form>
      <FormMessage alwaysMounted message={message?.text ?? ""} tone={message?.tone ?? "success"} />
      <div className={styles.preview} aria-label="Preview">
        <p className={styles.note} data-testid="club-draft-reminder-preview">
          {overview.dueNow === 1 ? "1 club registration would get a reminder on the next run." : `${overview.dueNow} club registrations would get a reminder on the next run.`}
          {" "}{overview.drafts === 1 ? "1 registration is started and not submitted." : `${overview.drafts} registrations are started and not submitted.`}
          {overview.upcoming.length > 0 ? ` The next ones fall on ${overview.upcoming.map((iso) => whenLabel(iso, eventTimezone)).join(", ")}.` : ""}
        </p>
        <ul className={styles.stats} aria-label="Reminders so far">
          <li><strong>{counts.queued}</strong> queued</li>
          <li><strong>{counts.sent}</strong> sent</li>
          <li><strong>{counts.failed}</strong> failed</li>
          <li><strong>{counts.suppressed}</strong> suppressed</li>
          <li><strong>{counts.cancelled}</strong> cancelled</li>
        </ul>
      </div>
    </section>
  );
}
