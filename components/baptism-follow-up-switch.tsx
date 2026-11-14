"use client";

import { ScopedToolSwitch } from "@/components/scoped-tool-switch";
import styles from "@/components/baptism-follow-up.module.css";

/** Turns Baptism follow-up on or off for the event (#1680). The server decides who may, and off keeps every name, status and note. */
export function BaptismFollowUpSwitch({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {
  return (
    <ScopedToolSwitch
      enabled={enabled}
      endpoint={`${endpoint}/settings`}
      formClassName={styles.switch}
      helpClassName={styles.muted}
      offHelp="Turning Baptism follow-up off hides this page and sends no notices. Every name, status and note is kept. Unsaved notes on this page are lost."
      toolName="Baptism follow-up"
    />
  );
}
