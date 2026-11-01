"use client";

import { SetupChecklistPanel } from "@/components/setup-checklist-panel";
import type { SetupChecklist } from "@/modules/events/setup-checklist";

/**
 * "Set up this event" on the Dashboard (#743). The server has already decided which steps this viewer may act on
 * (`buildSetupChecklist`), so every link here opens for them. It disappears once nothing is left, and staff can
 * collapse it (remembered per browser, never required). The look is the shared checklist (#1435).
 */
export function EventSetupChecklist({
  eventId,
  checklist,
}: {
  eventId: string;
  checklist: SetupChecklist;
}) {
  return (
    <SetupChecklistPanel
      checklist={{ ...checklist, trackedCount: checklist.steps.length }}
      eyebrow="Setup"
      storageKey={`imsda-events:setup-checklist-collapsed:${eventId}`}
      title="Set up this event"
    />
  );
}
