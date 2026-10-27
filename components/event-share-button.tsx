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

/** What the polite live region says for each state; exported so the wording is testable without a DOM. */
export function shareStatusMessage(state: "idle" | "copied" | "failed") {
  return state === "copied" ? "Link copied." : state === "failed" ? "Could not copy the link. It is shown below to copy yourself." : "";
}

/** "Share this event". Renders nothing without a URL (an unpublished or archived event has no shareable address). */
export function EventShareButton({ title, url }: { title: string; url?: string | null }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [status, setStatus] = useState("");
  const timer = useRef<number | null>(null);
  const announceTimer = useRef<number | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (announceTimer.current !== null) window.clearTimeout(announceTimer.current);
  }, []);
  // The field appears on a failed copy: move focus into it and select the link so it can be copied by hand.
  useEffect(() => {
    if (state === "failed") {
      field.current?.focus();
      field.current?.select();
    }
  }, [state]);
  if (!url) return null;

  async function share() {
    const outcome = await shareOrCopy({ title, url: url! }, navigator);
    if (outcome !== "copied" && outcome !== "failed") return;
    setState(outcome);
    // A repeat failure keeps the field mounted, so the effect above does not re-run: focus it here.
    if (outcome === "failed") {
      field.current?.focus();
      field.current?.select();
    }
    // Clear, then set on a later tick, so a repeat of the same result is announced again.
    setStatus("");
    if (announceTimer.current !== null) window.clearTimeout(announceTimer.current);
    announceTimer.current = window.setTimeout(() => setStatus(shareStatusMessage(outcome)), 50);
    if (timer.current !== null) window.clearTimeout(timer.current);
    // The copied label goes back after a few seconds; the failed field stays so the link can be selected.
    if (outcome === "copied") timer.current = window.setTimeout(() => { setState("idle"); setStatus(""); }, 3000);
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
          <input onFocus={(event) => event.currentTarget.select()} ref={field} readOnly type="text" value={url} />
        </label>
      )}
      <p aria-live="polite" className="sr-only" role="status">
        {status}
      </p>
    </div>
  );
}
