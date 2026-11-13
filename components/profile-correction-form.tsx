"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary, summaryMessage, useFormErrorSummary } from "@/components/form-error-summary";
import { FormMessage, notSavedMessage, restoreFocusAfterSave, savedMessage } from "@/components/form-message";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import styles from "@/components/profile-correction-form.module.css";

type Values = { firstName: string; lastName: string; phone: string; shirtSize: string };
type FieldKey = keyof Values | "reason";

const fields: Array<{ key: keyof Values; label: string; type?: "tel"; autoComplete?: string }> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
  { key: "shirtSize", label: "Shirt size" },
];
const labels: Record<FieldKey, string> = { firstName: "First name", lastName: "Last name", phone: "Phone", shirtSize: "Shirt size", reason: "Reason for the correction" };

/** The field a server issue points at: ["corrected", "phone"] and ["reason"] both name one input. */
function fieldOfIssue(path: unknown): FieldKey | null {
  if (!Array.isArray(path)) return null;
  const last = path[path.length - 1];
  return typeof last === "string" && last in labels && path[0] !== "expected" ? last as FieldKey : null;
}

/**
 * A staff correction of one attendee's name, phone or shirt size (#1512). It sends the values it was loaded with, so the
 * server can refuse the correction if the profile has changed since, and a reason, which is kept with the change.
 */
export function ProfileCorrectionForm({ accountId, current }: { accountId: string; current: Values }) {
  const id = useId();
  const router = useRouter();
  const currentKey = JSON.stringify(current);
  const [seenKey, setSeenKey] = useState(currentKey);
  const [values, setValues] = useState<Values>(current);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>({ tone: "success", text: "" });
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary, clearField: clearSummaryField } = useFormErrorSummary();
  const buttonId = `${id}-save`;
  const inputId = (key: FieldKey) => `${id}-${key}`;

  // After a saved correction the page reloads the stored values; take them as the new starting point.
  if (currentKey !== seenKey) {
    setSeenKey(currentKey);
    setValues(current);
  }

  useUnsavedChangesGuard(reason.trim() !== "" || fields.some((field) => values[field.key] !== current[field.key]));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage({ tone: "success", text: "" });
    setErrors({});
    clearSummary();
    try {
      const response = await fetch("/api/people/profile-updates", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, reason, expected: current, corrected: values }),
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
      setMessage({ tone: "success", text: savedMessage("The old and new values are kept with the reason.") });
      setReason("");
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
    <details className={styles.details}>
      <summary className={styles.summary}>Correct name, phone or shirt size</summary>
      <form className={styles.form} noValidate aria-busy={busy} onSubmit={(event) => void submit(event)}>
        {summaryItems.length > 0 && <FormErrorSummary items={summaryItems} ref={summaryRef} />}
        <div className={styles.grid}>
          {fields.map((field) => (
            <label key={field.key} className={styles.label} htmlFor={inputId(field.key)}>
              {field.label}
              <input
                id={inputId(field.key)}
                className={styles.input}
                type={field.type ?? "text"}
                value={values[field.key]}
                onChange={(event) => { setValues((existing) => ({ ...existing, [field.key]: event.target.value })); clearError(field.key); }}
                autoComplete={field.autoComplete ?? "off"}
                {...fieldErrorProps(`${inputId(field.key)}-error`, errors[field.key])}
              />
              <FieldError id={`${inputId(field.key)}-error`}>{errors[field.key]}</FieldError>
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
        <p className={styles.help} id={`${id}-help`}>The reason and the old and new values are kept with the change. Address and emergency contact are not corrected here.</p>
        <div className={styles.actions}>
          <button id={buttonId} type="submit" className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save correction"}</button>
        </div>
        <FormMessage alwaysMounted tone={message.tone} message={message.text} />
      </form>
    </details>
  );
}
