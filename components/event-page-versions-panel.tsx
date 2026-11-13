"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { centralScheduleLabel } from "@/modules/events/content-schedule";
import type { EventContentSectionRecord } from "@/modules/events/content-repository";
import type { SanitizedHtml } from "@/modules/events/content-html";
import styles from "@/components/event-page-publishing.module.css";

type Version = {
  id: string;
  versionNumber: number;
  createdAt: string;
  source: "SAVE" | "SCHEDULED_PUBLISH" | "ROLLBACK";
  who: string | null;
  sectionCount: number;
  titles: string[];
};

const sourceLabels: Record<Version["source"], string> = {
  SAVE: "Changed and published",
  SCHEDULED_PUBLISH: "Published on schedule",
  ROLLBACK: "Restored from an earlier version",
};

/** The latest published versions of the page, each with a "Restore this version" behind a confirm step (#1514). */
export function EventPageVersionsPanel({
  eventId,
  refreshKey,
  dirty,
  onRestored,
}: {
  eventId: string;
  /** Changes when the page was just saved, so the list reloads. */
  refreshKey: number;
  /** Unsaved edits in the editor, which a restore replaces. */
  dirty: boolean;
  onRestored: (result: { sections: EventContentSectionRecord[]; sanitizedHtml?: Record<string, SanitizedHtml>; versionNumber: number }) => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<Version | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/${eventId}/content/versions`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message ?? "The published versions could not be loaded.");
        if (!cancelled) { setVersions(body.versions ?? []); setLoadError(""); }
      })
      .catch((caught) => { if (!cancelled) setLoadError(caught instanceof Error ? caught.message : "The published versions could not be loaded."); });
    return () => { cancelled = true; };
  }, [eventId, refreshKey]);

  async function restore(version: Version) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/events/${eventId}/content/versions/${version.id}/restore`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.sections) throw new Error(body.message ?? "The version could not be restored.");
      setPending(null);
      onRestored({ sections: body.sections, sanitizedHtml: body.sanitizedHtml, versionNumber: version.versionNumber });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The version could not be restored.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" id="event-content-versions" aria-labelledby="event-content-versions-title">
      <div className={styles.panelHead}>
        <h2 id="event-content-versions-title">Published versions</h2>
        <p>
          Each time what visitors see changes, the page is kept here. Restoring a version puts those published sections back.
          Sections that are not published stay as they are.
        </p>
      </div>
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      {versions !== null && versions.length === 0 && !loadError && (
        <p className={styles.hint}>No versions yet. The first one is kept the next time you publish a change.</p>
      )}
      {versions && versions.length > 0 && (
        <ul className={styles.versionList}>
          {versions.map((version, index) => (
            <li className={styles.versionItem} key={version.id}>
              <div className={styles.versionText}>
                <strong>
                  Version {version.versionNumber}{index === 0 ? " (current)" : ""} · {centralScheduleLabel(version.createdAt)}
                </strong>
                <span>
                  {sourceLabels[version.source]}{version.who ? ` by ${version.who}` : ""} · {version.sectionCount} published section{version.sectionCount === 1 ? "" : "s"}
                </span>
                {version.titles.length > 0 && <small>{version.titles.join(", ")}</small>}
              </div>
              {index > 0 && (
                <button className="secondary-button" type="button" onClick={() => { setError(""); setPending(version); }}>
                  <History size={15} aria-hidden="true" /> Restore this version
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        busy={busy}
        busyLabel="Restoring…"
        confirmLabel="Restore this version"
        error={error}
        onCancel={() => { setPending(null); setError(""); }}
        onConfirm={() => { if (pending) void restore(pending); }}
        open={pending !== null}
        title={pending ? `Restore version ${pending.versionNumber}?` : "Restore version?"}
      >
        <p>
          Visitors see this version straight away. Your sections that are not published stay as drafts.
          {dirty ? " You have unsaved edits in the editor; restoring replaces them." : ""}
        </p>
      </ConfirmDialog>
    </section>
  );
}
