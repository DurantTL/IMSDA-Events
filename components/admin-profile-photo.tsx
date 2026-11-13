"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useConfirm } from "@/components/use-confirm";
import styles from "./profile-photo-card.module.css";

/**
 * A system administrator's view of a staff member's profile photo, with the one action allowed on it: removing an
 * inappropriate photo (#1640). The removal is logged and the person is told on their own profile page.
 */
export function AdminProfilePhoto({ userId, version, displayName }: { userId: string; version: number; displayName: string }) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    const confirmed = await confirm({
      title: `Remove ${displayName}'s profile photo`,
      body: "The stored photo is deleted and the person is told on their profile page that a staff member removed it. The removal is recorded.",
      confirmLabel: "Remove photo",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/profile-photos/${encodeURIComponent(userId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("The photo could not be removed. Please try again.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The photo could not be removed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="admin-profile-photo-heading" className={`panel ${styles.card}`}>
      <h2 id="admin-profile-photo-heading">Profile photo</h2>
      <div className={styles.row}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed-in route, not a static asset */}
        <img alt="" className={styles.photo} height={96} src={`/api/profile-photos/${encodeURIComponent(userId)}?size=full&v=${version}`} width={96} />
        <div className={styles.actions}>
          <button className="secondary-button" disabled={busy} onClick={() => { void remove(); }} type="button">
            <Trash2 aria-hidden="true" size={16} />
            Remove photo
          </button>
        </div>
      </div>
      <p className={`field-help ${styles.help}`}>Only remove a photo that is not appropriate. The person can add a different one.</p>
      <div role="alert">{error && <p className="form-error">{error}</p>}</div>
      {confirmDialog}
    </section>
  );
}
