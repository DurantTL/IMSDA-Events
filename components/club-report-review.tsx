"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

/**
 * "Mark reviewed" and its undo for one submitted monthly record (#1246). Shown to Clubs Administrators and system
 * administrators only; the route checks again. `compact` is the button alone, for a list row.
 */
export function ClubReportReview({
  organizationId,
  month,
  clubName,
  reviewed,
  compact = false,
}: {
  organizationId: string;
  month: string;
  clubName: string;
  reviewed: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function change(next: boolean) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/club-reports/${encodeURIComponent(organizationId)}/${encodeURIComponent(month)}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewed: next }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        setError(result.message ?? "The change could not be saved.");
        return;
      }
      router.refresh();
    } catch {
      setError("The change could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={compact ? "club-report-review compact" : "club-report-review"}>
      <button
        className={reviewed ? "secondary-button" : "primary-button"}
        disabled={saving}
        onClick={() => void change(!reviewed)}
        type="button"
      >
        {!reviewed && <CheckCircle2 aria-hidden="true" size={15} />}
        {reviewed ? "Undo reviewed" : "Mark reviewed"}
        <span className="sr-only"> for {clubName}</span>
      </button>
      {error && <small className="club-report-problem" role="alert">{error}</small>}
    </div>
  );
}
