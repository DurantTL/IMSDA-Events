"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { CLUB_KINDS, clubKindLabels, type ClubKindValue } from "@/modules/organizations/club-kind";
import styles from "./club-kind-control.module.css";

/** A system administrator sets a club's kind, Pathfinder or Adventurer (#1517). The server checks the role again. */
export function ClubKindControl({ organizationId, clubKind }: { organizationId: string; clubKind: ClubKindValue }) {
  const router = useRouter();
  const [choice, setChoice] = useState<ClubKindValue>(clubKind);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  // Unsaved work: a kind chosen but not yet saved (#1452, rule B6).
  useUnsavedChangesGuard(choice !== clubKind);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/organizations/${encodeURIComponent(organizationId)}/club-kind`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubKind: choice }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? "The club kind couldn't be changed.");
      }
      setMessage({ tone: "success", text: savedMessage() });
      router.refresh();
    } catch (caught) {
      setMessage({ tone: "error", text: notSavedMessage(caught instanceof Error ? caught.message : "the club kind couldn't be changed.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.control}>
      <label className={styles.label}>
        Club kind
        <select disabled={busy} onChange={(event) => { setChoice(event.target.value as ClubKindValue); setMessage(null); }} value={choice}>
          {CLUB_KINDS.map((kind) => <option key={kind} value={kind}>{clubKindLabels[kind]}</option>)}
        </select>
      </label>
      <button className="secondary-button" disabled={busy || choice === clubKind} onClick={save} type="button">
        {busy ? "Saving…" : "Save kind"}
      </button>
      <FormMessage alwaysMounted message={message?.text ?? ""} tone={message?.tone ?? "success"} />
    </div>
  );
}
