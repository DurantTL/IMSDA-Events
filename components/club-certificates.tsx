"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, Printer } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CodeValue, ExactValue } from "@/components/exact-value";
import { notSavedMessage } from "@/components/form-message";
import { conferenceDateFormat } from "@/modules/calendar/conference-format";
import { formatPersonName } from "@/lib/person-name";
import {
  CERTIFICATES_PRINT_MAX,
  certificateItemsParam,
  certificateKindLabels,
  formatCertificateCode,
  formatCompletionDate,
  type CertificateCandidate,
  type IssuedCertificateRow,
} from "@/modules/club-certificates/domain";
import styles from "@/components/club-certificates.module.css";

/**
 * The checkboxes, select all and the print link for the completions the page filtered to (#1696). Printing opens a page;
 * nothing is sent to anyone. The server re-checks every item the print page is asked for.
 */
export function ClubCertificatePicker({ organizationId, candidates, filtered = false }: { organizationId: string; candidates: CertificateCandidate[]; filtered?: boolean }) {
  const [picked, setPicked] = useState<string[]>([]);
  const shown = candidates.map((item) => item.key);
  const kept = picked.filter((key) => shown.includes(key));
  const tooMany = kept.length > CERTIFICATES_PRINT_MAX;
  const ready = kept.length > 0 && !tooMany;
  const href = `/account/clubs/${encodeURIComponent(organizationId)}/certificates/print?items=${certificateItemsParam(kept)}`;
  if (candidates.length === 0) {
    const base = `/account/clubs/${encodeURIComponent(organizationId)}`;
    return filtered
      ? <p className="inline-notice">No completed honors or classes match these filters. Change them, or clear the filters.</p>
      : <p className="inline-notice">{"Nothing has been completed yet. Record honors on your club's "}<Link href={`${base}/honors`}>Honors page</Link>{" and classes on "}<Link href={`${base}/class-tracking`}>Class tracking</Link>{", then come back here."}</p>;
  }
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.meta}>Certificates to print</legend>
      <div className={styles.actions}>
        <button className="secondary-button" onClick={() => setPicked(shown)} type="button">Select all</button>
        <button className="secondary-button" onClick={() => setPicked([])} type="button">Select none</button>
        <span aria-live="polite" className={styles.meta}>{`${kept.length} selected`}</span>
      </div>
      <ul className={styles.items}>
        {candidates.map((item) => {
          const inputId = `certificate-${item.key}`;
          return (
            <li className={styles.item} key={item.key}>
              <label htmlFor={inputId}>
                <input
                  checked={kept.includes(item.key)}
                  id={inputId}
                  onChange={(event) => setPicked((current) => (event.target.checked ? [...current.filter((key) => key !== item.key), item.key] : current.filter((key) => key !== item.key)))}
                  type="checkbox"
                />
                <span>{`${formatPersonName(item)}: ${item.title}`}<span className={styles.meta}>{` · ${certificateKindLabels[item.kind]} · ${formatCompletionDate(item.completedOn)}`}</span></span>
              </label>
            </li>
          );
        })}
      </ul>
      {tooMany && <p className="inline-notice" role="alert">{`Choose at most ${CERTIFICATES_PRINT_MAX} certificates at a time.`}</p>}
      <div className={styles.actions}>
        {ready
          ? <Link className="primary-button" href={href}><Printer aria-hidden="true" size={16} /> Print certificates</Link>
          : <button aria-disabled="true" className="primary-button" disabled type="button"><Printer aria-hidden="true" size={16} /> Print certificates</button>}
      </div>
    </fieldset>
  );
}

/** A stored instant as a long date in the conference time zone (Central), so an evening print is not shown as the next day. */
const issuedDate = (iso: string) => conferenceDateFormat({ dateStyle: "long" }).format(new Date(iso));

/** The person on a row, or a plain note when they were removed from the roster. */
function personLabel(row: IssuedCertificateRow) {
  return row.firstName === null && row.lastName === null ? "Removed from the roster" : formatPersonName(row);
}

function VoidButton({ organizationId, row }: { organizationId: string; row: IssuedCertificateRow }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function voidIt() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/certificates/${encodeURIComponent(row.id)}/void`, { method: "POST" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(result.message ?? "That could not be voided.");
      }
      setConfirming(false);
      router.refresh();
    } catch (caught) {
      setError(notSavedMessage(caught instanceof Error ? caught.message : "That could not be voided."));
    } finally {
      setBusy(false);
    }
  }
  const name = personLabel(row);
  return (
    <>
      <button className="secondary-button" onClick={() => { setError(""); setConfirming(true); }} type="button">
        <Ban aria-hidden="true" size={16} /> Void<span className="sr-only">{` ${formatCertificateCode(row.code)}, ${name}: ${row.title}`}</span>
      </button>
      <ConfirmDialog
        busy={busy}
        busyLabel="Voiding…"
        confirmLabel="Void certificate"
        destructive
        error={error}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void voidIt()}
        open={confirming}
        title={`Void certificate ${formatCertificateCode(row.code)}?`}
      >
        <p>{`This withdraws the certificate for ${name}: ${row.title}. Anyone who checks its number will be told it is no longer valid. The record is kept. If you print this completion again, it gets a new number.`}</p>
      </ConfirmDialog>
    </>
  );
}

/** The certificates this club has printed (#2052), newest first, each valid one with a Void button that asks first. */
export function PrintedCertificates({ organizationId, rows, total }: { organizationId: string; rows: IssuedCertificateRow[]; total: number }) {
  if (rows.length === 0) return <p className="inline-notice">No certificates have been printed yet. Each one you print gets a verification number and shows up here.</p>;
  return (
    <>
      <p className={styles.meta}>{total > rows.length ? `The latest ${rows.length} are listed; ${total} certificates have been printed in all.` : `${total} printed ${total === 1 ? "certificate" : "certificates"}.`}</p>
      <ul className={styles.issued}>
        {rows.map((row) => (
          <li className={styles.issuedItem} key={row.id}>
            <div className={styles.issuedText}>
              <CodeValue code={formatCertificateCode(row.code)} />
              <span><ExactValue>{personLabel(row)}</ExactValue>{": "}<ExactValue>{row.title}</ExactValue></span>
              <span className={styles.meta}>{`${certificateKindLabels[row.kind]} · completed ${formatCompletionDate(row.completedOn)} · printed ${issuedDate(row.issuedAt)}`}</span>
              <span className={row.voidedAt ? styles.voided : styles.valid}>{row.voidedAt ? `Voided on ${issuedDate(row.voidedAt)}` : "Valid"}</span>
            </div>
            {!row.voidedAt && <VoidButton organizationId={organizationId} row={row} />}
          </li>
        ))}
      </ul>
    </>
  );
}
