"use client";

import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import type { RegistrationSignatures, SignatureRecordView, SignatureSummary } from "@/modules/signatures/domain";
import styles from "@/components/registration-signatures-panel.module.css";

function formatSignedAt(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" }).format(date);
}

function isFullRecord(signature: SignatureSummary | SignatureRecordView): signature is SignatureRecordView {
  return "signedText" in signature;
}

/**
 * The typed-name signatures on a registration (#1265), loaded from the staff route. The route decides what comes back: every
 * staff member who manages the registration gets who signed and when; the signed text and IP address arrive only for someone
 * with VIEW_SENSITIVE_DATA. This component only shows what it was given.
 */
export function RegistrationSignaturesPanel({
  eventId,
  registrationId,
  timeZone,
  attendeeNames,
}: {
  eventId: string;
  registrationId: string;
  timeZone: string;
  /** Attendee id to display name, for attendee-level signature fields. */
  attendeeNames: Record<string, string>;
}) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; data: RegistrationSignatures }>({ status: "loading" });
  useEffect(() => {
    let live = true;
    fetch(`/api/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(registrationId)}/signatures`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("not ok");
        return await response.json() as RegistrationSignatures;
      })
      .then((data) => { if (live) setState({ status: "ready", data }); })
      .catch(() => { if (live) setState({ status: "error" }); });
    return () => { live = false; };
  }, [eventId, registrationId]);

  if (state.status === "loading") return null;
  if (state.status === "error") return <p className="quiet-copy" role="status">Signatures could not be loaded.</p>;
  if (state.data.signatures.length === 0) return null;
  return (
    <section className="registration-related-panel registration-signatures" aria-labelledby={`registration-signatures-${registrationId}`} data-testid="registration-signatures">
      <header>
        <span><PenLine aria-hidden="true" size={17} /></span>
        <div><p className="eyebrow">Staff-only</p><h3 id={`registration-signatures-${registrationId}`}>Signatures</h3></div>
        <strong>{state.data.signatures.length}</strong>
      </header>
      <div className="registration-related-list">
        {state.data.signatures.map((signature) => (
          <article key={signature.id} className={styles.registrationSignatureRecord}>
            <p>
              <strong>{signature.fieldLabel}</strong>
              {signature.registrationAttendeeId && attendeeNames[signature.registrationAttendeeId] ? ` · ${attendeeNames[signature.registrationAttendeeId]}` : ""}
            </p>
            <p>Signed by <strong translate="no">{signature.signerName}</strong> on {formatSignedAt(signature.signedAt, timeZone)}</p>
            {isFullRecord(signature) ? (
              <>
                <p className="quiet-copy">{`IP address: ${signature.ipAddress ?? "not recorded"}`}</p>
                <details>
                  <summary>Text that was signed</summary>
                  <p className={styles.registrationSignatureText}>{signature.signedText}</p>
                </details>
              </>
            ) : null}
          </article>
        ))}
        {!state.data.canViewRecord && <p className="quiet-copy">The signed text and IP address need sensitive-data access.</p>}
      </div>
    </section>
  );
}
