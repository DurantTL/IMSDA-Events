"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { HeldButton, HeldSaveButton, SaveResult, type SaveResultState } from "@/components/organization-form-parts";
import styles from "@/components/organization-pages.module.css";
import { savedMessage, notSavedMessage } from "@/components/form-message";
import { PhoneInput, phoneBlocks } from "@/components/phone-input";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import type { BillingContactAdminEntry } from "@/modules/billing-responsibility/repository";

function date(value: string) {
  return new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Conference administrators manage one organization's billing contact (#165): add or replace
 * (the previous one is ended and kept), verify, end, and read the history. The route checks the
 * system administrator role again.
 */
export function OrganizationBillingContact({
  organizationId,
  active,
  history,
}: {
  organizationId: string;
  active: BillingContactAdminEntry | null;
  history: BillingContactAdminEntry[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SaveResultState | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roleLabel, setRoleLabel] = useState("Treasurer");
  const [savedRoleLabel, setSavedRoleLabel] = useState("Treasurer");
  const [attempted, setAttempted] = useState(false);
  const base = useId();
  // The form starts blank and clears after a save; the role keeps its saved value (#1468).
  useUnsavedChangesGuard(Boolean(name || email || phone) || roleLabel !== savedRoleLabel);

  /** `slot` is where the result shows: beside the form for a save, beside the current contact for Mark verified and End contact. */
  async function send(body: Record<string, unknown>, slot: "form" | "current", doneText: string) {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/admin/organizations/${encodeURIComponent(organizationId)}/billing-contact`, {
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
      <section aria-labelledby={`${base}-current`} className="panel billing-contact-admin">
        <h2 className={styles.panelTitle} id={`${base}-current`}>Current billing contact</h2>
        {active ? (
          <>
            <p className={styles.record}>
              <strong translate="no">{active.name}</strong> ({active.roleLabel}) · {active.email}{active.phone ? ` · ${active.phone}` : ""}
            </p>
            <p className={styles.meta}>{active.verifiedAt ? `Verified ${date(active.verifiedAt)}${active.verifiedByName ? ` by ${active.verifiedByName}` : ""}` : "Not verified"} · since {date(active.effectiveFrom)}</p>
            <span className={`billing-inline-action ${styles.actionRow}`}>
              {!active.verifiedAt && <HeldButton held={busy} onAction={() => void send({ action: "verify", contactId: active.id }, "current", savedMessage("Marked verified."))}>Mark verified</HeldButton>}
              <HeldButton held={busy} onAction={() => void send({ action: "end", contactId: active.id }, "current", savedMessage("Contact ended and kept in the history."))}>End contact</HeldButton>
            </span>
          </>
        ) : (
          <p className={styles.empty}>No billing contact on file. Add one below so there is somewhere to send invoices.</p>
        )}
        <SaveResult result={result} slot="current" />
      </section>
      <section aria-labelledby={`${base}-form`} className="panel">
        <h2 className={styles.panelTitle} id={`${base}-form`}>{active ? "Replace the contact" : "Add a billing contact"}</h2>
        <form
          className={`billing-contact-form ${styles.form}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setAttempted(true);
            // A saved contact is never edited in place, so its phone is always a new value (#871).
            if (phoneBlocks("Phone", phone)) {
              setResult({ tone: "error", text: notSavedMessage("Fix the highlighted phone number and save again."), slot: "form" });
              return;
            }
            void send({ action: "set", contact: { name, email, phone: phone || undefined, roleLabel } }, "form", savedMessage("The new contact starts unverified.")).then((ok) => {
              if (ok) { setName(""); setEmail(""); setPhone(""); setSavedRoleLabel(roleLabel); }
            });
          }}
        >
          <label htmlFor={`${base}-name`}>Name</label>
          <input autoComplete="off" id={`${base}-name`} maxLength={120} onChange={(event) => setName(event.target.value)} required value={name} />
          <label htmlFor={`${base}-role`}>Role</label>
          <input id={`${base}-role`} maxLength={80} onChange={(event) => setRoleLabel(event.target.value)} required value={roleLabel} />
          <label htmlFor={`${base}-email`}>Email</label>
          <input autoComplete="off" id={`${base}-email`} maxLength={160} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          <label htmlFor={`${base}-phone`}>Phone (optional)</label>
          <PhoneInput autoComplete="off" id={`${base}-phone`} label="Phone" onValueChange={setPhone} showNow={attempted} value={phone} />
          {active && <p className={styles.note}>The current contact is ended and kept in the history. The new one starts unverified.</p>}
          <div className={styles.saveRow}>
            <HeldSaveButton held={busy} label="Save contact" />
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
                <span translate="no">{entry.name}</span> ({entry.roleLabel}) · {date(entry.effectiveFrom)} to {entry.effectiveTo ? date(entry.effectiveTo) : "now"}
                {entry.verifiedAt ? ` · verified${entry.verifiedByName ? ` by ${entry.verifiedByName}` : ""}` : " · not verified"}
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
