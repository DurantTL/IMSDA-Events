"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage, notSavedMessage } from "@/components/form-message";
import { guardedNavigate } from "@/components/unsaved-changes-registry";

/**
 * The on/off switch of an optional club-event tool (Recognitions #1683, Baptism follow-up #1680). PUTs `{ enabled }` to
 * `endpoint`; the server decides who may. Turning a tool off reloads the page, so it asks first while any form on the page holds
 * unsaved changes. `offHelp` is the sentence shown while the tool is on, saying what off does (and that the data is kept).
 */
export function ScopedToolSwitch({ endpoint, enabled, toolName, offHelp, formClassName, helpClassName }: {
  endpoint: string;
  enabled: boolean;
  toolName: string;
  offHelp: string;
  formClassName?: string;
  helpClassName?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  // One confirmation at a time: the button stays disabled while the unsaved-changes dialog is open.
  async function request() {
    setAsking(true);
    try {
      await guardedNavigate(() => { void change(); });
    } finally {
      setAsking(false);
    }
  }

  async function change() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(notSavedMessage(body.message ?? "Try again.")); return; }
      router.refresh();
    } catch {
      setError(notSavedMessage("Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={formClassName}>
      {enabled && <p className={helpClassName}>{offHelp}</p>}
      <button className={enabled ? "secondary-button" : "primary-button"} disabled={busy || asking} onClick={() => { void request(); }} type="button">{busy ? "Saving…" : enabled ? `Turn ${toolName} off` : `Turn ${toolName} on`}</button>
      <FormMessage alwaysMounted message={error} tone="error" />
    </div>
  );
}
