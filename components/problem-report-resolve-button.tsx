"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useProblemReportAnnouncer } from "@/components/problem-reports-status";

/** Marks one problem report resolved (#1483). The route allows system administrators only. */
export function ProblemReportResolveButton({ id, reference }: { id: string; reference: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const announce = useProblemReportAnnouncer();

  async function resolve() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/problem-reports/${encodeURIComponent(id)}`, { method: "PATCH" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? "The report could not be updated.");
      }
      announce(`${reference} marked completed.`);
      router.refresh();
      // The completed report's row stays in the list as "Completed"; the button is gone, so focus goes to the heading.
      document.getElementById("problem-reports-heading")?.focus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The report could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  // The live region is the page's own (ProblemReportsStatusProvider), which survives the refresh that removes this button.
  return (
    <>
      <button aria-label={`Mark ${reference} completed`} className="secondary-button" disabled={busy} onClick={resolve} type="button">
        {busy ? "Saving…" : "Mark completed"}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </>
  );
}
