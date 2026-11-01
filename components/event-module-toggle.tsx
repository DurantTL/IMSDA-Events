"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirm } from "@/components/use-confirm";

/**
 * "Enable" / "Turn off" for one event module (#741 slice 2). Only the Event
 * modules page renders it, and only for a system administrator; the route and
 * service check the role again, so hiding the button is never the protection.
 * Turning a module off hides its entry points and never deletes its data.
 */
export function EventModuleToggle({
  eventId,
  moduleKey,
  title,
  enabled,
}: {
  eventId: string;
  moduleKey: string;
  title: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const [error, setError] = useState("");

  async function toggle() {
    if (enabled && !(await confirm({
      title: `Turn off ${title}?`,
      body: <p>Its pages and links are hidden for this event. The data is kept, and you can turn it back on from Event modules.</p>,
      confirmLabel: `Turn off ${title}`,
      destructive: true,
    }))) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/modules/${encodeURIComponent(moduleKey)}`,
        { method: enabled ? "DELETE" : "PUT" },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message ?? "The module could not be changed.");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The module could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="event-module-toggle">
      {confirmDialog}
      <button
        className={enabled ? "secondary-button" : "primary-button"}
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={`${enabled ? "Turn off" : "Enable"} ${title}`}
      >
        {busy ? "Saving…" : enabled ? "Turn off" : "Enable"}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
