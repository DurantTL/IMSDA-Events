"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cardCell } from "@/components/table-card-labels";
import { featureFallbackMessage as fallbackMessage, performFeatureChange } from "@/modules/event-features/requests";
import type { FeatureRow } from "@/modules/event-features/model";

type Pending = { row: FeatureRow; next: boolean };

/**
 * The Event features table (#965). It renders the rows the server built and sends
 * each change to the request that already owns that switch: the module API, the
 * event settings update (built from the event as the server holds it at the moment
 * of the click, with its dates for the stale-write guard of #445), the general link
 * and team APIs (team rules likewise read fresh), publish and unpublish, and the
 * calendar API. Hiding a switch is never the protection: the server checks the
 * permission again on every request, and a refused change shows its message here.
 * Turning a feature off asks first.
 */
export function EventFeaturesTable({
  eventId,
  rows,
}: {
  eventId: string;
  rows: FeatureRow[];
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState("");

  async function apply(row: FeatureRow, next: boolean) {
    if (!row.action) return;
    // Event columns and teams are read fresh from the server first, so a field changed elsewhere since this page
    // loaded is never written back over.
    await performFeatureChange(row.action, next, { eventId, fetchImpl: fetch });
  }

  async function run(row: FeatureRow, next: boolean) {
    setBusyId(row.id);
    setDialogError("");
    setNotice("");
    setErrors((current) => {
      const { [row.id]: _cleared, ...rest } = current;
      void _cleared;
      return rest;
    });
    try {
      await apply(row, next);
      setPending(null);
      setNotice(`${row.title} is now ${next ? "on" : "off"}.`);
      startRefresh(() => router.refresh());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : fallbackMessage;
      if (pending) setDialogError(message);
      else setErrors((current) => ({ ...current, [row.id]: message }));
    } finally {
      setBusyId(null);
    }
  }

  function flip(row: FeatureRow) {
    const control = row.control;
    if (!control?.canChange || busyId || refreshing) return;
    const next = !control.on;
    const confirmation = next ? control.confirmOn : control.confirmOff;
    if (confirmation) {
      setDialogError("");
      setPending({ row, next });
      return;
    }
    void run(row, next);
  }

  const confirmation = pending ? (pending.next ? pending.row.control?.confirmOn : pending.row.control?.confirmOff) ?? null : null;

  return (
    <>
      <p aria-live="polite" className="quiet-copy event-features-notice" role="status">{notice}</p>
      <div className="report-table-wrap">
        <table className="report-table table-cards event-features-table" role="table">
          <caption className="sr-only">Event features</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">Feature</th>
              <th role="columnheader" scope="col">State</th>
              <th role="columnheader" scope="col">Switch</th>
              <th role="columnheader" scope="col"><span className="sr-only">Settings</span></th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((row) => {
              const control = row.control;
              const error = errors[row.id];
              return (
                <tr data-feature={row.id} data-state={row.state} key={row.id} role="row">
                  <th role="rowheader" scope="row">
                    {row.title}
                    <small className="quiet-copy event-feature-description">{row.description}</small>
                  </th>
                  <td {...cardCell("State")}>{row.stateLabel}</td>
                  <td {...cardCell("Switch")}>
                    {control ? (
                      control.canChange ? (
                        <button
                          aria-checked={control.on}
                          aria-label={`${row.title}: ${control.on ? "on" : "off"}. Press to turn ${control.on ? "off" : "on"}.`}
                          className="feature-switch"
                          data-on={control.on ? "true" : "false"}
                          disabled={busyId !== null || refreshing}
                          onClick={() => flip(row)}
                          role="switch"
                          type="button"
                        >
                          <span aria-hidden="true" className="feature-switch-track"><span className="feature-switch-thumb" /></span>
                          <span>{busyId === row.id ? "Saving…" : control.on ? "On" : "Off"}</span>
                        </button>
                      ) : (
                        <span className="feature-switch-readonly" data-read-only>
                          Read only
                          {control.reason ? <small className="quiet-copy"> {control.reason}</small> : null}
                        </span>
                      )
                    ) : (
                      <span className="quiet-copy">No switch</span>
                    )}
                    {row.request ? <> <Link className="text-button" href={row.request.href}>{row.request.label}</Link></> : null}
                    {error ? <p className="form-error" role="alert">{error}</p> : null}
                  </td>
                  <td {...cardCell(null)}>
                    {row.settings ? (
                      <Link aria-label={`${row.settings.label}: ${row.title}`} className="secondary-button" href={row.settings.href}>{row.settings.label}</Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        busy={busyId !== null}
        busyLabel="Saving…"
        confirmLabel={confirmation?.confirmLabel ?? "Confirm"}
        destructive={pending ? !pending.next : false}
        error={dialogError}
        onCancel={() => { setPending(null); setDialogError(""); }}
        onConfirm={() => { if (pending) void run(pending.row, pending.next); }}
        open={pending !== null && confirmation !== null}
        title={confirmation?.title ?? ""}
      >
        <p>{confirmation?.body}</p>
      </ConfirmDialog>
    </>
  );
}
