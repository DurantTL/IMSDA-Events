"use client";

import Link from "next/link";
import { useState } from "react";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary, summaryMessage, useFormErrorSummary, type ErrorSummaryItem } from "@/components/form-error-summary";
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
type Values = Record<FieldKey, string>;
type Problems = Partial<Record<FieldKey, string>>;

const fieldId = (key: FieldKey) => `club-draft-reminder-${key}`;

function valuesOf(policy: ClubDraftReminderOverview["policy"]): Values {
  return {
    firstAfterDays: String(policy.firstAfterDays),
    repeatEveryDays: String(policy.repeatEveryDays),
    maxReminders: String(policy.maxReminders),
    staleAfterDays: String(policy.staleAfterDays),
  };
}

/** The same ranges and the one cross-field rule the server enforces, so each problem shows at its own field. */
function validate(values: Values, limits: ClubDraftReminderOverview["limits"]): Problems {
  const problems: Problems = {};
  for (const field of FIELDS) {
    const [min, max] = limits[field.key];
    const text = values[field.key].trim();
    const number = Number(text);
    if (text === "" || !Number.isInteger(number) || number < min || number > max) problems[field.key] = `must be a whole number from ${min} to ${max}.`;
  }
  if (!problems.staleAfterDays && !problems.firstAfterDays && Number(values.staleAfterDays) <= Number(values.firstAfterDays)) {
    problems.staleAfterDays = "must be more than the days before the first reminder, or a draft would expire before it is reminded.";
  }
  return problems;
}

function whenLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long", day: "numeric", year: "numeric" }).format(new Date(iso));
}

/**
 * Staff settings for reminders to clubs with an unsubmitted registration (#164), on the Scheduled emails page. Off until
 * turned on. The switch saves the saved numbers with only the switch changed, so turning off always works whatever is
 * typed in the boxes; Save timing saves the numbers. The preview is counts and dates only: no club name, no person, no
 * answer. The route checks access again.
 */
export function ClubDraftReminderSettings({ eventId, eventTimezone, initial }: { eventId: string; eventTimezone: string; initial: ClubDraftReminderOverview }) {
  const [overview, setOverview] = useState(initial);
  const [values, setValues] = useState<Values>(valuesOf(initial.policy));
  const [problems, setProblems] = useState<Problems>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary, clearField: clearSummaryField } = useFormErrorSummary();
  const enabled = overview.policy.enabled;

  // Typed numbers that are not saved yet. The switch saves on its own, so only the numbers count.
  useUnsavedChangesGuard(FIELDS.some((field) => values[field.key] !== String(overview.policy[field.key])));

  async function send(body: ClubDraftReminderOverview["policy"], done: string) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/club-draft-reminders`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { message?: string; overview?: ClubDraftReminderOverview };
      if (!response.ok || !result.overview) {
        setMessage({ tone: "error", text: notSavedMessage(result.message ?? "The change could not be saved.") });
        return false;
      }
      setOverview(result.overview);
      setMessage({ tone: "success", text: savedMessage(done) });
      return result.overview;
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggle() {
    clearSummary();
    await send({ ...overview.policy, enabled: !enabled }, !enabled ? "Reminders are on for this event." : "Reminders are off. Nothing will be sent.");
  }

  async function saveTiming() {
    const found = validate(values, overview.limits);
    setProblems(found);
    const items: ErrorSummaryItem[] = FIELDS.filter((field) => found[field.key]).map((field) => ({ targetId: fieldId(field.key), message: summaryMessage(field.label, found[field.key] as string) }));
    if (items.length > 0) {
      showSummary(items);
      return;
    }
    clearSummary();
    const saved = await send({
      enabled,
      firstAfterDays: Number(values.firstAfterDays),
      repeatEveryDays: Number(values.repeatEveryDays),
      maxReminders: Number(values.maxReminders),
      staleAfterDays: Number(values.staleAfterDays),
    }, "The timing is saved.");
    if (saved) setValues(valuesOf(saved.policy));
  }

  function edit(key: FieldKey, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setProblems((current) => ({ ...current, [key]: undefined }));
    clearSummaryField(fieldId(key));
  }

  const { counts, limits } = overview;
  return (
    <section className={styles.card} aria-labelledby="club-draft-reminders-heading">
      <h2 className={styles.heading} id="club-draft-reminders-heading">Reminders for unfinished club registrations</h2>
      <p className={styles.note}>
        A club director who started a registration and has not submitted it gets a short email to the club&apos;s director and deputy.
        It names the club and the event and links to the club&apos;s registration page. It never includes anything the club typed.
        Nothing is sent until it is turned on, and only from {overview.sendHours}.
      </p>
      <div className={styles.switchRow}>
        <span className={styles.state} data-testid="club-draft-reminder-state">{enabled ? "Reminders are on for this event." : "Reminders are off for this event."}</span>
        <button aria-busy={saving || undefined} className="secondary-button" disabled={saving} onClick={() => void toggle()} type="button">
          {saving ? "Saving…" : enabled ? "Turn off" : "Turn on"}
          <span className="sr-only"> the reminders for unfinished club registrations</span>
        </button>
      </div>
      {!overview.emailOn && (
        <p className={styles.note}>
          Email for this event is paused or not set up to send real email, so reminders are held until it is. A system administrator can change this under System management, then Email.
        </p>
      )}
      {!overview.registrationOpen && (
        <p className={styles.note}>
          Registration for this event is not open, so no reminders are sent. Registration dates are set in <Link href={`/more/event-settings?event=${encodeURIComponent(eventId)}`}>Event settings</Link>; ask your event administrator if you cannot open it.
        </p>
      )}
      <form noValidate onSubmit={(event) => { event.preventDefault(); void saveTiming(); }} aria-label="Reminder timing">
        {summaryItems.length > 0 && <FormErrorSummary items={summaryItems} ref={summaryRef} />}
        <fieldset className={styles.fields} disabled={saving}>
          <legend className="sr-only">Reminder timing</legend>
          {FIELDS.map((field) => (
            <div className={styles.field} key={field.key}>
              <label htmlFor={fieldId(field.key)}>{field.label}</label>
              <input
                {...fieldErrorProps(`${fieldId(field.key)}-error`, problems[field.key], `${fieldId(field.key)}-hint`)}
                id={fieldId(field.key)}
                inputMode="numeric"
                max={limits[field.key][1]}
                min={limits[field.key][0]}
                onChange={(event) => edit(field.key, event.target.value)}
                step={1}
                type="number"
                value={values[field.key]}
              />
              <span className={styles.hint} id={`${fieldId(field.key)}-hint`}>{field.hint} {limits[field.key][0]} to {limits[field.key][1]}.</span>
              <FieldError id={`${fieldId(field.key)}-error`}>{problems[field.key] ? `${field.label} ${problems[field.key]}` : undefined}</FieldError>
            </div>
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
