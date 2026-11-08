"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Marks one problem report resolved (#1483). The route allows system administrators only. */
export function ProblemReportResolveButton({ id, reference }: { id: string; reference: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function resolve() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/problem-reports/${encodeURIComponent(id)}`, { method: "PATCH" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? "The report could not be updated.");
      }
      setDone(true);
      router.refresh();
      // The completed report's row stays in the list as "Completed"; the button is gone, so focus goes to the heading.
      document.getElementById("problem-reports-heading")?.focus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The report could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  // The polite live region is always in the page; the message fills it once the change is saved.
  return (
    <>
      <span className="sr-only" role="status">{done ? `${reference} marked completed.` : ""}</span>
      <button aria-label={`Mark ${reference} completed`} className="secondary-button" disabled={busy} onClick={resolve} type="button">
        {busy ? "Saving…" : "Mark completed"}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </>
  );
}
