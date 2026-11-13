"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/use-confirm";
import { PROFILE_PHOTO_UNREADABLE, shrinkProfilePhoto } from "@/components/profile-photo-resize";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import styles from "./profile-photo-card.module.css";

export function initialsOf(displayName: string) {
  return displayName.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

/**
 * The staff member's own profile photo (#1640): add, change or remove it. The browser shrinks the photo first; the
 * server checks it again, drops hidden camera data and stores two small sizes. No photo means initials, as before.
 */
export function ProfilePhotoCard({
  displayName,
  photo,
}: {
  displayName: string;
  photo: { userId: string; version: number | null; removedByStaffAt: string | null };
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const hasPhoto = photo.version !== null;

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const blob = await shrinkProfilePhoto(file);
      const body = new FormData();
      body.append("file", blob, "profile-photo.jpg");
      const response = await fetch("/api/profile/photo", { method: "POST", body });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(typeof result.message === "string" ? result.message : "The photo could not be saved. Please try again.");
      }
      setMessage("Your profile photo was saved.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : PROFILE_PHOTO_UNREADABLE);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    const confirmed = await confirm({
      title: "Remove your profile photo",
      body: "The stored photo is deleted. Your initials show instead. You can add a photo again at any time.",
      confirmLabel: "Remove photo",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/profile/photo", { method: "DELETE" });
      if (!response.ok) throw new Error("The photo could not be removed. Please try again.");
      setMessage("Your profile photo was removed.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The photo could not be removed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="profile-photo-heading" className={`panel ${styles.card}`}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Staff account</p>
          <h2 id="profile-photo-heading">Profile photo</h2>
        </div>
      </div>
      {photo.removedByStaffAt && !hasPhoto && (
        <p className="inline-notice" role="status">
          A staff member removed your profile photo on {formatInConferenceTime(photo.removedByStaffAt, { dateStyle: "medium" })}. You can add a different one.
        </p>
      )}
      <div className={styles.row}>
        {hasPhoto
          // eslint-disable-next-line @next/next/no-img-element -- a signed-in route, not a static asset
          ? <img alt="" className={styles.photo} height={96} src={`/api/profile-photos/${encodeURIComponent(photo.userId)}?size=full&v=${photo.version}`} width={96} />
          : <span aria-hidden="true" className={styles.initials}>{initialsOf(displayName)}</span>}
        <div className={styles.actions}>
          <input
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            hidden
            disabled={busy}
            id="profile-photo-input"
            onChange={(event) => { void choose(event.target.files?.[0]); }}
            ref={inputRef}
            type="file"
          />
          <button className="secondary-button" disabled={busy} onClick={() => inputRef.current?.click()} type="button">
            <Camera aria-hidden="true" size={16} />
            {hasPhoto ? "Change photo" : "Add a profile photo"}
          </button>
          {hasPhoto && (
            <button className="secondary-button" disabled={busy} onClick={() => { void remove(); }} type="button">
              <Trash2 aria-hidden="true" size={16} />
              Remove photo
            </button>
          )}
        </div>
      </div>
      <p className={`field-help ${styles.help}`}>
        Shown only to you and to staff who already see you on staff lists. Never shown on public pages, emails, exports or name badges. Location and other hidden photo data are removed.
      </p>
      <div role="status">{message && <p className="auth-success">{message}</p>}</div>
      <div role="alert">{error && <p className="form-error">{error}</p>}</div>
      {confirmDialog}
    </section>
  );
}
