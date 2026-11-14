"use client";

import { ScopedToolSwitch } from "@/components/scoped-tool-switch";
import styles from "@/components/recognitions-workspace.module.css";

/** Turns Recognitions on or off for the event (#1683). The server decides who may, and off keeps every mark. */
export function RecognitionsSwitch({ eventId, enabled }: { eventId: string; enabled: boolean }) {
  return (
    <ScopedToolSwitch
      enabled={enabled}
      endpoint={`/api/events/${encodeURIComponent(eventId)}/recognitions/settings`}
      formClassName={styles.form}
      helpClassName={styles.help}
      offHelp="Turning Recognitions off hides this page. Everything already marked is kept."
      toolName="Recognitions"
    />
  );
}
