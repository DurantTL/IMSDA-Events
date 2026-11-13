"use client";

import Link from "next/link";
import { useState } from "react";
import { Printer } from "lucide-react";
import { formatPersonName } from "@/lib/person-name";
import {
  CERTIFICATES_PRINT_MAX,
  certificateItemsParam,
  certificateKindLabels,
  formatCompletionDate,
  type CertificateCandidate,
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
