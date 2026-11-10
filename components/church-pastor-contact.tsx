"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { EmailInput } from "@/components/email-input";
import { notSavedMessage, savedMessage } from "@/components/form-message";
import { HeldButton, HeldSaveButton, SaveResult, type SaveResultState } from "@/components/organization-form-parts";
import styles from "@/components/organization-pages.module.css";
import { PhoneInput } from "@/components/phone-input";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { inlineFieldProblem, inlinePhoneProblem } from "@/lib/field-validation";
import type { PastorContactEntry } from "@/modules/organizations/contacts-repository";

function date(value: string) {
  return new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Office staff manage one church's pastor contact (#977): add or replace (the previous is ended and kept), end, and read the history. */
export function ChurchPastorContact({ organizationId, active, history }: { organizationId: string; active: PastorContactEntry | null; history: PastorContactEntry[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SaveResultState | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const base = useId();
  // The add or replace form starts blank and clears after a save, so any typed value is unsaved (#1468).
  useUnsavedChangesGuard(Boolean(name || email || phone));
  const [phoneTouched, setPhoneTouched] = useState(false);
  // The same phone check the server runs (#1193). The form starts blank, so a typed phone is always a new value.
  const phoneProblem = inlinePhoneProblem("Phone", phone, undefined, phoneTouched);
  const [emailTouched, setEmailTouched] = useState(false);
  const emailProblem = inlineFieldProblem("Email", "email", email, undefined, emailTouched);

  /** `slot` is where the result shows: beside the form for a save, beside the current pastor for End contact. */
  async function send(body: Record<string, unknown>, slot: "form" | "current", doneText: string) {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/admin/organizations/${encodeURIComponent(organizationId)}/pastor-contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof parsed.message === "string" ? parsed.message : "The change could not be saved.");
      router.refresh();
      setResult({ tone: "success", text: doneText, slot });
      return true;
    } catch (caught) {
      setResult({ tone: "error", text: notSavedMessage(caught instanceof Error ? caught.message : "The change could not be saved."), slot });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.stack}>
      <section aria-labelledby={`${base}-current`} className="panel pastor-contact-admin">
        <h2 className={styles.panelTitle} id={`${base}-current`}>Current pastor contact</h2>
        {active ? (
          <>
            <p className={styles.record}>
              <strong translate="no">{active.name}</strong>{active.email ? ` · ${active.email}` : ""}{active.phone ? ` · ${active.phone}` : ""}
            </p>
            <p className={styles.meta}>since {date(active.effectiveFrom)}</p>
            <div className={styles.actionRow}>
              <HeldButton held={busy} onAction={() => void send({ action: "end", contactId: active.id }, "current", savedMessage("Contact ended and kept in the history."))}>End contact</HeldButton>
            </div>
          </>
        ) : (
          <p className={styles.empty}>No pastor contact on file. Add the pastor below.</p>
        )}
        <SaveResult result={result} slot="current" />
      </section>
      <section aria-labelledby={`${base}-form`} className="panel">
        <h2 className={styles.panelTitle} id={`${base}-form`}>{active ? "Replace the pastor" : "Add a pastor"}</h2>
        <form
          className={`billing-contact-form ${styles.form}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setPhoneTouched(true);
            setEmailTouched(true);
            if (phoneProblem.blocking || emailProblem.blocking) return;
            void send({ action: "set", contact: { name, email: email || undefined, phone: phone || undefined } }, "form", savedMessage()).then((ok) => {
              if (ok) { setName(""); setEmail(""); setPhone(""); }
            });
          }}
        >
          <label htmlFor={`${base}-name`}>Name</label>
          <input autoComplete="off" id={`${base}-name`} maxLength={120} onChange={(event) => setName(event.target.value)} required value={name} />
          <label htmlFor={`${base}-email`}>Email (optional)</label>
          <EmailInput autoComplete="off" id={`${base}-email`} label="Email" maxLength={254} onBlur={() => setEmailTouched(true)} onValueChange={setEmail} showNow={emailTouched} value={email} />
          <label htmlFor={`${base}-phone`}>Phone (optional)</label>
          <PhoneInput autoComplete="off" id={`${base}-phone`} label="Phone" onBlur={() => setPhoneTouched(true)} onValueChange={setPhone} showNow={phoneTouched} value={phone} />
          {active && <p className={styles.note}>The current pastor is ended and kept in the history.</p>}
          <div className={styles.saveRow}>
            <HeldSaveButton held={busy} label="Save pastor" />
            <SaveResult result={result} slot="form" />
          </div>
        </form>
      </section>
      {history.length > 0 && (
        <details className={`panel ${styles.history}`} open>
          <summary>History ({history.length})</summary>
          <ul>
            {history.map((entry) => (
              <li key={entry.id}>
                <span translate="no">{entry.name}</span> · {date(entry.effectiveFrom)} to {entry.effectiveTo ? date(entry.effectiveTo) : "now"}
                {entry.createdByName ? ` · entered by ${entry.createdByName}` : ""}
                {entry.endReason ? ` · ${entry.endReason}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
