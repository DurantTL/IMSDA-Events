"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  areaPauseDefinitions,
  type AreaPauseDefinition,
  type AreaPauseKey,
} from "@/modules/system-admin/area-pause-model";
import type { AreaPauseStatus } from "@/modules/system-admin/area-pause";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import styles from "./area-pauses-workspace.module.css";

const failedMessage = "The pause could not be saved.";

/**
 * System management > Pause an area (#1518): three switches, off by default. Pausing an area refuses changes in it
 * (the server does that, on every request) while its pages stay readable; resuming is one press. Pausing asks first.
 * The server checks the system administrator role on every request; nothing here is the protection.
 */
export function AreaPausesWorkspace({ initialPauses }: { initialPauses: AreaPauseStatus[] }) {
  const [pauses, setPauses] = useState(initialPauses);
  const [busyArea, setBusyArea] = useState<AreaPauseKey | null>(null);
  const [pending, setPending] = useState<AreaPauseDefinition | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [rowErrors, setRowErrors] = useState<Partial<Record<AreaPauseKey, string>>>({});
  const [notice, setNotice] = useState("");

  const pausedCount = areaPauseDefinitions.filter((definition) => pauses.find((entry) => entry.area === definition.key)?.paused).length;
  const statusOf = (area: AreaPauseKey) => pauses.find((entry) => entry.area === area);

  async function change(definition: AreaPauseDefinition, paused: boolean) {
    setBusyArea(definition.key);
    setNotice("");
    setDialogError("");
    setRowErrors((current) => ({ ...current, [definition.key]: undefined }));
    try {
      const response = await fetch("/api/admin/area-pauses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area: definition.key, paused }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.pauses)) {
        throw new Error(typeof result.message === "string" ? result.message : failedMessage);
      }
      setPauses(result.pauses);
      setPending(null);
      setNotice(`${definition.name} is now ${paused ? "paused" : "running"}.`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : failedMessage;
      if (pending) setDialogError(message);
      else setRowErrors((current) => ({ ...current, [definition.key]: message }));
    } finally {
      setBusyArea(null);
    }
  }

  function flip(definition: AreaPauseDefinition) {
    if (busyArea) return;
    if (statusOf(definition.key)?.paused) {
      void change(definition, false);
      return;
    }
    setDialogError("");
    setPending(definition);
  }

  return (
    <div className="page-stack">
      <p className={styles.summary} data-testid="pause-summary">
        <span className={`status-chip ${pausedCount > 0 ? "gold" : "green"}`}>{pausedCount > 0 ? `${pausedCount} of ${areaPauseDefinitions.length} paused` : "Nothing paused"}</span>
      </p>

      {notice && <p className="inline-notice" role="status">{notice}</p>}

      <ul className={styles.list}>
        {areaPauseDefinitions.map((definition) => {
          const status = statusOf(definition.key);
          const paused = status?.paused ?? false;
          const error = rowErrors[definition.key];
          return (
            <li className={`panel ${styles.row}`} data-area={definition.key} data-state={paused ? "paused" : "running"} key={definition.key}>
              <div className={styles.text}>
                <h2 className={styles.name}>{definition.name}</h2>
                <p className={styles.detail}>{definition.pauses}</p>
                <p className={styles.meta}>
                  {status?.updatedAt
                    ? `${paused ? "Paused" : "Resumed"} ${formatInConferenceTime(status.updatedAt, { dateStyle: "medium", timeStyle: "short" })}${status.updatedByName ? ` by ${status.updatedByName}` : ""}.`
                    : "Never paused."}
                </p>
                {error && <p className="form-error" role="alert">{error}</p>}
              </div>
              <button
                aria-checked={paused}
                aria-label={`${definition.name}: ${paused ? "paused" : "running"}. Press to ${paused ? "resume" : "pause"}.`}
                className={`feature-switch ${styles.switch}`}
                data-on={paused ? "true" : "false"}
                disabled={busyArea !== null}
                onClick={() => flip(definition)}
                role="switch"
                type="button"
              >
                <span aria-hidden="true" className="feature-switch-track"><span className="feature-switch-thumb" /></span>
                <span>{busyArea === definition.key ? "Saving…" : paused ? "Paused" : "Running"}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        busy={busyArea !== null}
        busyLabel="Pausing…"
        confirmLabel={pending ? `Pause ${pending.name.toLowerCase()}` : "Pause"}
        destructive
        error={dialogError}
        onCancel={() => { setPending(null); setDialogError(""); }}
        onConfirm={() => { if (pending) void change(pending, true); }}
        open={pending !== null}
        title={pending ? `Pause ${pending.name.toLowerCase()}?` : "Pause?"}
      >
        {pending && (
          <>
            <p>{pending.pauses}</p>
            <p>Visitors who try will see: &ldquo;{pending.message}&rdquo;</p>
            <p>Remember to resume it when you are done.</p>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
