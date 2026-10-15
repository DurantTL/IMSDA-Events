"use client";

import { useConfirm } from "@/components/use-confirm";
import { useState } from "react";

/** Throws away a stored draft the builder cannot read (#712), so the form can be edited again. */
export function ClubFormDraftDiscard({ templateKey, message }: { templateKey: string; message?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function discard() {
    if (!(await askConfirm({
      title: "Discard the unreadable draft",
      body: <p>The saved draft can&apos;t be read, so it is removed and the form can be edited again. The published version is not changed.</p>,
      confirmLabel: "Discard draft",
      destructive: true,
    }))) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/club-forms/${encodeURIComponent(templateKey)}/draft`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        setError(result.message ?? "The draft could not be discarded.");
        return;
      }
      window.location.reload();
    } catch {
      setError("The draft could not be discarded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const { confirm: askConfirm, confirmDialog } = useConfirm();
  return (
    <div className="inline-notice error" role="alert">
      {confirmDialog}
      <p>{message ?? "The saved draft of this form can't be read, so it can't be edited or published. The published version is not affected."}</p>
      <button className="secondary-button" disabled={busy} onClick={() => void discard()} type="button">Discard draft</button>
      {error && <small className="club-report-problem">{error}</small>}
    </div>
  );
}
