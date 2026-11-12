"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CLUB_KINDS, clubKindLabels, type ClubKindValue } from "@/modules/organizations/club-kind";
import styles from "./club-kind-control.module.css";

/** A system administrator sets a club's kind, Pathfinder or Adventurer (#1517). The server checks the role again. */
export function ClubKindControl({ organizationId, clubKind }: { organizationId: string; clubKind: ClubKindValue }) {
  const router = useRouter();
  const [choice, setChoice] = useState<ClubKindValue>(clubKind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
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
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The club kind couldn't be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.control}>
      <label className={styles.label}>
        Club kind
        <select disabled={busy} onChange={(event) => setChoice(event.target.value as ClubKindValue)} value={choice}>
          {CLUB_KINDS.map((kind) => <option key={kind} value={kind}>{clubKindLabels[kind]}</option>)}
        </select>
      </label>
      <button className="secondary-button" disabled={busy || choice === clubKind} onClick={save} type="button">
        {busy ? "Saving…" : "Save kind"}
      </button>
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}
