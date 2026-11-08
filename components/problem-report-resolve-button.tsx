"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Marks one problem report resolved (#1483). The route allows system administrators only. */
export function ProblemReportResolveButton({ id, reference }: { id: string; reference: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function resolve() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/problem-reports/${encodeURIComponent(id)}`, { method: "PATCH" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? "The report could not be updated.");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The report could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button aria-label={`Mark ${reference} completed`} className="secondary-button" disabled={busy} onClick={resolve} type="button">
        {busy ? "Saving…" : "Mark completed"}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </>
  );
}
