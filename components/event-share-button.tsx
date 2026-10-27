"use client";

import { useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";

export type ShareOutcome = "shared" | "cancelled" | "copied" | "failed";

/**
 * Share the event (#1214): the native share sheet when the device has one (cancelling it is a quiet no-op), otherwise
 * copy the link the way the calendar panel does. Exported so the steps can be tested without a browser.
 */
export async function shareOrCopy(
  data: { title: string; url: string },
  nav: Pick<Navigator, "share" | "clipboard"> | { share?: undefined; clipboard?: { writeText(text: string): Promise<void> } },
): Promise<ShareOutcome> {
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title: data.title, url: data.url });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
      // Any other share failure falls back to copying below.
    }
  }
  try {
    await nav.clipboard!.writeText(data.url);
    return "copied";
  } catch {
    return "failed";
  }
}

/** "Share this event". Renders nothing without a URL (an unpublished or archived event has no shareable address). */
export function EventShareButton({ title, url }: { title: string; url?: string | null }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  if (!url) return null;

  async function share() {
    const outcome = await shareOrCopy({ title, url: url! }, navigator);
    if (outcome !== "copied" && outcome !== "failed") return;
    setState(outcome);
    if (timer.current !== null) window.clearTimeout(timer.current);
    // The copied label goes back after a few seconds; the failed field stays so the link can be selected.
    if (outcome === "copied") timer.current = window.setTimeout(() => setState("idle"), 3000);
  }

  return (
    <div className="public-event-share">
      <button className="public-event-share-button" onClick={() => void share()} type="button">
        <Share2 size={16} aria-hidden="true" />{" "}
        {state === "copied" ? <>Link copied <span aria-hidden="true">✓</span></> : "Share this event"}
      </button>
      {state === "failed" && (
        <label className="public-event-share-field">
          <span>Copy this link to share the event</span>
          <input onFocus={(event) => event.currentTarget.select()} readOnly type="text" value={url} />
        </label>
      )}
      <p aria-live="polite" className="sr-only" role="status">
        {state === "copied" ? "Link copied." : state === "failed" ? "Could not copy the link. It is shown below to copy yourself." : ""}
      </p>
    </div>
  );
}
