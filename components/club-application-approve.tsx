"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Approve one pending new club application from the Clubs Administrator dashboard (#1226). It posts to the same route
 * the applications page uses, so the same `decideNewClubApplication` runs and writes the same audit. There is no second
 * approval path; the server checks the role again on every call.
 */
export async function postApproveDecision(applicationId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(`/api/admin/club-applications/${encodeURIComponent(applicationId)}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });
  const result = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(result.message ?? "The decision could not be saved.");
}

const AnnounceContext = createContext<(message: string) => void>(() => undefined);

/**
 * Wraps the New clubs section. A refresh after Approve removes the approved row, so the status message lives here, in
 * a live region that stays, and focus moves to the section heading (`headingId`, tabIndex -1) instead of being lost.
 */
export function NewClubsRegion({ headingId, children }: { headingId: string; children?: ReactNode }) {
  const [message, setMessage] = useState("");
  const announce = (text: string) => {
    setMessage(text);
    if (typeof document !== "undefined") document.getElementById(headingId)?.focus();
  };
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <p className="field-help" role="status" aria-live="polite" data-testid="new-clubs-status" style={{ margin: "4px 0 0" }}>{message}</p>
    </AnnounceContext.Provider>
  );
}

type ViewProps = {
  clubName: string;
  directorEmail: string;
  confirming: boolean;
  busy: boolean;
  error: string | null;
  success: string | null;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
};

/** The markup only: the button, then the inline confirm that appears after the first click. */
export function ClubApplicationApproveView({ clubName, directorEmail, confirming, busy, error, success, onAsk, onCancel, onConfirm }: ViewProps) {
  return (
    <div className="nca-decision">
      {success ? (
        <p className="inline-notice success">{success}</p>
      ) : confirming ? (
        <>
          <p>
            Approving creates the club and emails <strong translate="no">{directorEmail}</strong> the club director invite. It can&apos;t be undone from here.
          </p>
          <div className="nca-actions button-pair">
            <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">Cancel</button>
            <button className="primary-button" disabled={busy} onClick={onConfirm} type="button">Approve and send invite</button>
          </div>
        </>
      ) : (
        <button className="primary-button" disabled={busy} onClick={onAsk} type="button" aria-label={`Approve ${clubName}`}>Approve</button>
      )}
      {error && <p className="inline-notice error" role="alert">{error}</p>}
    </div>
  );
}

export function ClubApplicationApprove({ applicationId, clubName, directorEmail }: { applicationId: string; clubName: string; directorEmail: string }) {
  const router = useRouter();
  const announce = useContext(AnnounceContext);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await postApproveDecision(applicationId);
      setConfirming(false);
      const text = `${clubName} was approved. The club director invite was emailed.`;
      setSuccess(text);
      announce(text);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decision could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ClubApplicationApproveView
      busy={busy}
      clubName={clubName}
      confirming={confirming}
      directorEmail={directorEmail}
      error={error}
      onAsk={() => { setConfirming(true); setError(null); }}
      onCancel={() => setConfirming(false)}
      onConfirm={() => void approve()}
      success={success}
    />
  );
}
