"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EVENT_ARCHIVE_EFFECTS } from "@/modules/events/archive";

/**
 * Archive or unarchive an event (#635). Reversible and non-destructive, so the
 * confirm button is the ordinary (not red) style, but the dialog still names
 * the event and says what archiving does. Mounted only while open, so every
 * opening starts clean.
 */
export function ArchiveEventDialog(props: {
  archived: boolean;
  eventId: string;
  eventName: string;
  onCancel: () => void;
  open: boolean;
}) {
  return props.open ? <ArchiveEventDialogBody {...props} /> : null;
}

function ArchiveEventDialogBody({ archived, eventId, eventName, onCancel, open }: {
  archived: boolean;
  eventId: string;
  eventName: string;
  onCancel: () => void;
  open: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const verb = archived ? "unarchive" : "archive";

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/events/${eventId}/${verb}`, { method: "POST" });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? `The event could not be ${verb}d.`);
      // Archived: the event leaves the pickers, so go to the list that still holds it. Unarchived: stay and refresh.
      if (archived) router.refresh();
      else router.push("/archived-events");
      onCancel();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `The event could not be ${verb}d.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      busy={busy}
      busyLabel={archived ? "Unarchiving…" : "Archiving…"}
      confirmLabel={archived ? "Unarchive event" : "Archive event"}
      error={error}
      onCancel={onCancel}
      onConfirm={() => void confirm()}
      open={open}
      title={archived ? `Unarchive ${eventName}?` : `Archive ${eventName}?`}
    >
      {archived ? (
        <p>
          This returns <strong translate="no">{eventName}</strong> to event pickers and the dashboard. If it is published,
          its public pages and registration are available again as before. Nothing else changes.
        </p>
      ) : (
        <p>
          This archives <strong translate="no">{eventName}</strong>. {EVENT_ARCHIVE_EFFECTS}
        </p>
      )}
    </ConfirmDialog>
  );
}
