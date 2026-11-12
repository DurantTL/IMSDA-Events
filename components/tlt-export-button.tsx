"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { fileNameFromDisposition } from "@/components/export-link";
import styles from "./tlt-directory.module.css";

/** The CSV download for the filters on screen (#1686). A POST, because every download is audited. */
export function TltExportButton({ filters }: { filters: Record<string, string> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/attendee/area-clubs/tlt-directory/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(result.message ?? "The download could not be made.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFromDisposition(response.headers.get("Content-Disposition")) ?? "tlt-directory.csv";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The download could not be made.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="secondary-button" disabled={busy} onClick={() => void download()} type="button">
        <Download aria-hidden="true" size={15} /> {busy ? "Preparing download…" : "Download CSV"}
      </button>
      {error ? <span className={styles.error} role="alert">{error}</span> : null}
    </>
  );
}
