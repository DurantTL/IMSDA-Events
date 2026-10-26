"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
        <p className="inline-notice success" role="status">{success}</p>
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
      setSuccess(`${clubName} was approved. The club director invite was emailed.`);
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
