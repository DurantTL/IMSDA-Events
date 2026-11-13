"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/components/profile-correction-form.module.css";

type Values = { firstName: string; lastName: string; phone: string; shirtSize: string };

const fields: Array<{ key: keyof Values; label: string; autoComplete?: string }> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "phone", label: "Phone" },
  { key: "shirtSize", label: "Shirt size" },
];

/**
 * A staff correction of one attendee's name, phone or shirt size (#1512). It sends the values it was loaded with, so the
 * server can refuse the correction if the profile has changed since, and a reason, which is kept with the change.
 */
export function ProfileCorrectionForm({ accountId, current }: { accountId: string; current: Values }) {
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState<Values>(current);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/people/profile-updates", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, reason, expected: current, corrected: values }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        setMessage(body.message ?? "The correction could not be saved.");
        return;
      }
      setMessage("Correction saved.");
      setReason("");
      router.refresh();
    } catch {
      setMessage("The correction could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className={styles.details}>
      <summary className={styles.summary}>Correct name, phone or shirt size</summary>
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <div className={styles.grid}>
          {fields.map((field) => (
            <label key={field.key} className={styles.label} htmlFor={`${id}-${field.key}`}>
              {field.label}
              <input
                id={`${id}-${field.key}`}
                className={styles.input}
                value={values[field.key]}
                onChange={(event) => setValues((existing) => ({ ...existing, [field.key]: event.target.value }))}
                autoComplete="off"
              />
            </label>
          ))}
        </div>
        <label className={styles.label} htmlFor={`${id}-reason`}>
          Reason for the correction
          <input
            id={`${id}-reason`}
            className={styles.input}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            required
            autoComplete="off"
          />
        </label>
        <p className={styles.help}>The reason and the old and new values are kept with the change. Address and emergency contact are not corrected here.</p>
        <div className={styles.actions}>
          <button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save correction"}</button>
          <p className={styles.status} role="status" aria-live="polite">{message}</p>
        </div>
      </form>
    </details>
  );
}
