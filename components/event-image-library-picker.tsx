"use client";

import { useCallback, useEffect, useState } from "react";
import type { EventAssetRecord } from "@/modules/events/asset-repository";
import type { ImageLibraryRecord } from "@/modules/events/image-library";
import styles from "./event-image-library-picker.module.css";

/**
 * The shared header image library, as a picker inside the banner editor (#1913). The server decides who may use it
 * (event editors only) and what a "use" does; this only asks and shows.
 */

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

async function readJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown> & { message?: string }>;
}

function LibraryCard({
  eventId,
  image,
  busy,
  onUse,
  onChanged,
  onError,
}: {
  eventId: string;
  image: ImageLibraryRecord;
  busy: boolean;
  onUse: (image: ImageLibraryRecord) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [tagText, setTagText] = useState(image.tags.join(", "));
  const [saving, setSaving] = useState(false);

  async function patch(body: { tags?: string[]; retired?: boolean }) {
    setSaving(true);
    onError("");
    try {
      const response = await fetch(`/api/events/${eventId}/image-library/${image.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.message ?? "That change could not be saved.");
      onChanged();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "That change could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const when = formatDate(image.sourceEventStartsAt);
  return (
    <li className={styles.card} data-retired={image.retired}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.thumb} src={image.url} alt="" loading="lazy" />
      <p className={styles.name}>{image.displayName}</p>
      {image.retired && <p className={styles.retiredBadge}>Retired</p>}
      <p className={styles.meta}>
        {image.sourceEventTitle ? `From ${image.sourceEventTitle}` : "Uploaded to the library"}
        {when ? `, ${when}` : ""}
      </p>
      <p className={styles.meta}>
        {formatSize(image.byteSize)}. Used by {image.usage.eventCount} event{image.usage.eventCount === 1 ? "" : "s"}
        {image.usage.eventTitles.length > 0 ? `: ${image.usage.eventTitles.join(", ")}` : ""}
      </p>
      {image.tags.length > 0 && (
        <ul className={styles.tags} aria-label="Tags">
          {image.tags.map((tag) => <li className={styles.tag} key={tag}>{tag}</li>)}
        </ul>
      )}
      <div className={styles.tagForm}>
        <label>
          Tags (separate with commas)
          <input value={tagText} maxLength={400} onChange={(event) => setTagText(event.target.value)} />
        </label>
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.quiet}`} disabled={saving} onClick={() => patch({ tags: tagText.split(",") })}>
            Save tags
          </button>
          <button type="button" className={`${styles.button} ${styles.quiet}`} disabled={saving} onClick={() => patch({ retired: !image.retired })}>
            {image.retired ? "Restore" : "Retire"}
          </button>
        </div>
      </div>
      {!image.retired && (
        <button type="button" className={styles.button} disabled={busy} onClick={() => onUse(image)}>
          Use this image
        </button>
      )}
    </li>
  );
}

export function EventImageLibraryPicker({
  eventId,
  onChoose,
  onClose,
}: {
  eventId: string;
  /** Called with the event's updated file list and the chosen file once the library image is in the event. */
  onChoose: (result: { assets: EventAssetRecord[]; asset: EventAssetRecord; altText: string }) => void;
  onClose: () => void;
}) {
  const [images, setImages] = useState<ImageLibraryRecord[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [year, setYear] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (tag) params.set("tag", tag);
        if (/^\d{4}$/.test(year)) params.set("year", year);
        if (showRetired) params.set("includeRetired", "true");
        const response = await fetch(`/api/events/${eventId}/image-library?${params}`, { signal: controller.signal });
        const result = await readJson(response);
        if (!response.ok) throw new Error(result.message ?? "The image library could not be loaded.");
        setImages(result.images as ImageLibraryRecord[]);
        setAllTags(result.tags as string[]);
        setError("");
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "The image library could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [eventId, query, tag, year, showRetired, reload]);

  const refresh = useCallback(() => setReload((count) => count + 1), []);

  async function use(image: ImageLibraryRecord) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`/api/events/${eventId}/image-library/${image.id}/use`, { method: "POST" });
      const result = await readJson(response);
      if (!response.ok || !result.asset || !result.assets) {
        throw new Error(result.message ?? "That image could not be used.");
      }
      onChoose({ assets: result.assets as EventAssetRecord[], asset: result.asset as EventAssetRecord, altText: image.altText });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That image could not be used.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/events/${eventId}/image-library`, { method: "POST", body });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.message ?? "That image could not be uploaded.");
      setStatus(result.created ? "Added to the library." : "That image is already in the library.");
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That image could not be uploaded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Image library">
      <div className={styles.head}>
        <h3 className={styles.title}>Image library</h3>
        <button type="button" className={`${styles.button} ${styles.quiet}`} onClick={onClose}>Close library</button>
      </div>
      <div className={styles.filters}>
        <label>
          Search
          <input type="search" value={query} maxLength={80} placeholder="Event name, file name or tag" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          Tag
          <select value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="">All tags</option>
            {allTags.map((name) => <option value={name} key={name}>{name}</option>)}
          </select>
        </label>
        <label>
          Year of the event
          <input inputMode="numeric" value={year} maxLength={4} placeholder="2026" onChange={(event) => setYear(event.target.value.replace(/\D/g, ""))} />
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={showRetired} onChange={(event) => setShowRetired(event.target.checked)} />
          Show retired
        </label>
      </div>
      <label className={styles.upload}>
        Upload to library (PNG, JPEG or WebP)
        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }} />
      </label>
      <p className={`${styles.message} ${styles.error}`} role="alert">{error}</p>
      <p className={`${styles.message} ${styles.status}`} role="status">{loading ? "Loading images." : status}</p>
      {!loading && images.length === 0 && !error && (
        <p className={styles.meta}>No images match. Upload one above, or clear the search.</p>
      )}
      <ul className={styles.grid}>
        {images.map((image) => (
          <LibraryCard
            key={`${image.id}-${image.tags.join("|")}-${image.retired}`}
            eventId={eventId}
            image={image}
            busy={busy}
            onUse={use}
            onChanged={refresh}
            onError={setError}
          />
        ))}
      </ul>
    </section>
  );
}
