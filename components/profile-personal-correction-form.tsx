"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneInput } from "@/components/phone-input";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary, summaryMessage, useFormErrorSummary } from "@/components/form-error-summary";
import { FormMessage, notSavedMessage, restoreFocusAfterSave, savedMessage } from "@/components/form-message";
import styles from "@/components/profile-correction-form.module.css";

type Values = {
  mailingLine1: string;
  mailingLine2: string;
  mailingCity: string;
  mailingRegion: string;
  mailingPostalCode: string;
  mailingCountry: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
};
type FieldKey = keyof Values | "reason" | "personRequested";

const fields: Array<{ key: keyof Values; label: string; maxLength: number }> = [
  { key: "mailingLine1", label: "Address line 1", maxLength: 200 },
  { key: "mailingLine2", label: "Address line 2", maxLength: 200 },
  { key: "mailingCity", label: "City", maxLength: 200 },
  { key: "mailingRegion", label: "State or region", maxLength: 200 },
  { key: "mailingPostalCode", label: "ZIP or postal code", maxLength: 200 },
  { key: "mailingCountry", label: "Country", maxLength: 200 },
  { key: "emergencyContactName", label: "Emergency contact name", maxLength: 120 },
  { key: "emergencyContactRelationship", label: "Emergency contact relationship", maxLength: 80 },
  { key: "emergencyContactPhone", label: "Emergency contact phone", maxLength: 40 },
];
const labels: Record<FieldKey, string> = {
  ...Object.fromEntries(fields.map((field) => [field.key, field.label])) as Record<keyof Values, string>,
  reason: "Reason for the correction",
  personRequested: "The person asked for this change",
};

/** The field a server issue points at: ["corrected", "emergencyContactPhone"] and ["reason"] both name one input. */
function fieldOfIssue(path: unknown): FieldKey | null {
  if (!Array.isArray(path)) return null;
  const last = path[path.length - 1];
  return typeof last === "string" && last in labels && path[0] !== "expected" ? last as FieldKey : null;
}

/**
 * A system administrator's correction of one account's address and emergency contact (#1512). The current values are
 * not on the page until the correction is opened: opening it fetches that one account's values (an audited read), and
 * closing it or saving drops them again. The correction needs a reason and the statement that the person asked for it.
 */
export function ProfilePersonalCorrectionForm({ accountId }: { accountId: string }) {
  const id = useId();
  const router = useRouter();
  const [loaded, setLoaded] = useState<Values | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [personRequested, setPersonRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>({ tone: "success", text: "" });
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary, clearField: clearSummaryField } = useFormErrorSummary();
  const buttonId = `${id}-save`;
  const inputId = (key: FieldKey) => `${id}-${key}`;

  function discard() {
    setLoaded(null);
    setValues(null);
    setReason("");
    setPersonRequested(false);
    setErrors({});
    clearSummary();
  }

  async function load() {
    setLoading(true);
    setMessage({ tone: "success", text: "" });
    try {
      const response = await fetch(`/api/people/profile-updates/personal?accountId=${encodeURIComponent(accountId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as { message?: string; values?: Values };
      if (!response.ok || !body.values) {
        setMessage({ tone: "error", text: notSavedMessage(body.message ?? "The current details could not be loaded.") });
        return;
      }
      setLoaded(body.values);
      setValues(body.values);
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setLoading(false);
    }
  }

  function onToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open) {
      if (!loaded && !loading) void load();
    } else {
      discard();
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!loaded || !values) return;
    setBusy(true);
    setMessage({ tone: "success", text: "" });
    setErrors({});
    clearSummary();
    try {
      const response = await fetch("/api/people/profile-updates/personal", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, reason, personRequested, expected: loaded, corrected: values }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; issues?: Array<{ path?: unknown; message?: string }> };
      if (!response.ok) {
        const found = (body.issues ?? []).flatMap((issue) => {
          const key = fieldOfIssue(issue.path);
          return key && issue.message ? [{ key, text: issue.message }] : [];
        });
        if (found.length > 0) {
          setErrors(Object.fromEntries(found.map((item) => [item.key, item.text])));
          showSummary(found.map((item) => ({ targetId: inputId(item.key), message: summaryMessage(labels[item.key], item.text) })));
        } else {
          setMessage({ tone: "error", text: notSavedMessage(body.message ?? "The correction could not be saved.") });
        }
        return;
      }
      // The values are dropped from the page once saved; opening the correction again loads them afresh.
      discard();
      if (detailsRef.current) detailsRef.current.open = false;
      setMessage({ tone: "success", text: savedMessage("The old and new values are kept with the reason.") });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("Check your connection and try again.") });
    } finally {
      setBusy(false);
      restoreFocusAfterSave(buttonId);
    }
  }

  function clearError(key: FieldKey) {
    setErrors((existing) => {
      if (!existing[key]) return existing;
      const rest = { ...existing };
      delete rest[key];
      return rest;
    });
    clearSummaryField(inputId(key));
  }

  return (
    <>
    <details className={styles.details} ref={detailsRef} onToggle={onToggle}>
      <summary className={styles.summary}>Correct address or emergency contact</summary>
      {loading ? <p className={styles.loading} role="status">Loading the current details…</p> : null}
      {loaded && values ? (
        <form className={styles.form} noValidate aria-busy={busy} onSubmit={(event) => void submit(event)}>
          {summaryItems.length > 0 && <FormErrorSummary items={summaryItems} ref={summaryRef} />}
          <div className={styles.grid}>
            {fields.map((field) => (
              <label key={field.key} className={styles.label} htmlFor={inputId(field.key)}>
                {field.label}
                {field.key === "emergencyContactPhone" ? (
                  <PhoneInput
                    id={inputId(field.key)}
                    className={styles.input}
                    label={field.label}
                    stored={loaded.emergencyContactPhone}
                    value={values.emergencyContactPhone}
                    onValueChange={(phone) => { setValues((existing) => (existing ? { ...existing, emergencyContactPhone: phone } : existing)); clearError(field.key); }}
                    error={errors[field.key]}
                    errorId={`${inputId(field.key)}-error`}
                  />
                ) : (
                  <>
                    <input
                      id={inputId(field.key)}
                      className={styles.input}
                      type="text"
                      value={values[field.key]}
                      maxLength={field.maxLength}
                      onChange={(event) => { setValues((existing) => (existing ? { ...existing, [field.key]: event.target.value } : existing)); clearError(field.key); }}
                      autoComplete="off"
                      {...fieldErrorProps(`${inputId(field.key)}-error`, errors[field.key])}
                    />
                    <FieldError id={`${inputId(field.key)}-error`}>{errors[field.key]}</FieldError>
                  </>
                )}
              </label>
            ))}
          </div>
          <label className={styles.label} htmlFor={inputId("reason")}>
            Reason for the correction
            <input
              id={inputId("reason")}
              className={styles.input}
              value={reason}
              onChange={(event) => { setReason(event.target.value); clearError("reason"); }}
              maxLength={500}
              required
              autoComplete="off"
              {...fieldErrorProps(`${inputId("reason")}-error`, errors.reason, `${id}-help`)}
            />
            <FieldError id={`${inputId("reason")}-error`}>{errors.reason}</FieldError>
          </label>
          <label className={styles.check} htmlFor={inputId("personRequested")}>
            <input
              id={inputId("personRequested")}
              type="checkbox"
              checked={personRequested}
              onChange={(event) => { setPersonRequested(event.target.checked); clearError("personRequested"); }}
              required
              {...fieldErrorProps(`${inputId("personRequested")}-error`, errors.personRequested)}
            />
            The person asked for this change
          </label>
          <FieldError id={`${inputId("personRequested")}-error`}>{errors.personRequested}</FieldError>
          <p className={styles.help} id={`${id}-help`}>The reason, the confirmation that the person asked, and the old and new values are kept with the change.</p>
          <div className={styles.actions}>
            <button id={buttonId} type="submit" className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save correction"}</button>
          </div>
        </form>
      ) : null}
    </details>
    <FormMessage alwaysMounted tone={message.tone} message={message.text} />
    </>
  );
}
