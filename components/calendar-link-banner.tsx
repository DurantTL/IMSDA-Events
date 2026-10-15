"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CalendarLinkNotice } from "@/modules/calendar/event-links";
import { formatDateRange } from "@/modules/calendar/domain";

type CalendarLinkBannerProps = {
  eventId: string;
  notice: CalendarLinkNotice;
  /** Update and Keep are offered to system administrators only; the server checks again. */
  canAnswer: boolean;
};

/**
 * The event's side of a linked calendar item (#445). When the item's dates move
 * (Google moved it, or staff edited it), nothing changes on its own: the banner
 * asks, previews what Update changes and what it leaves alone, and applies
 * only the choice a staff member clicks. A removed item only warns.
 */
export function CalendarLinkBanner({ eventId, notice, canAnswer }: CalendarLinkBannerProps) {
  const router = useRouter();
  const prompt = notice.datePrompt;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<"update" | "keep" | null>(null);

  async function answer(decision: "update" | "keep") {
    if (!prompt) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/calendar/events/${encodeURIComponent(eventId)}/date-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, startsOn: prompt.itemStartsOn, endsOn: prompt.itemEndsOn }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "That could not be saved.");
      setDone(decision);
      // The event's dates are part of the form below, so load them again.
      if (decision === "update") router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="calendar-link-banner-stack">
      {notice.sourceRemoved && (
        <div className="inline-notice clone-warning calendar-link-banner" role="status" data-testid="calendar-source-removed-banner">
          <p>This event&apos;s calendar item is no longer in Google Calendar. The registration event is unchanged: it was not removed or cancelled. Decide whether it should still go ahead.</p>
        </div>
      )}
      {done === "keep" && (
        <div className="inline-notice calendar-link-banner" role="status">Keeping the current registration dates. This is recorded in the event&apos;s history.</div>
      )}
      {done === "update" && (
        <div className="inline-notice calendar-link-banner" role="status">Registration dates updated. This is recorded in the event&apos;s history. Check the dates listed below as unchanged.</div>
      )}
      {prompt && !done && (
        <section className="inline-notice clone-warning calendar-link-banner" role="region" aria-label="Calendar date change" data-testid="calendar-date-banner">
          <p><strong>{prompt.message}</strong></p>
          <dl className="calendar-link-preview">
            {prompt.preview.changes.map((change) => (
              <div key={change.label}>
                <dt>{change.label}</dt>
                <dd>{change.from} becomes {change.to}</dd>
              </div>
            ))}
          </dl>
          {prompt.preview.unchanged.length > 0 && (
            <>
              <p>These stay as they are. Update changes only the event dates.</p>
              <ul className="calendar-link-unchanged">
                {prompt.preview.unchanged.map((item) => (
                  <li key={`${item.label}-${item.value}`} className={item.needsAttention ? "needs-attention" : ""}>
                    {item.label}: {item.value}{item.note ? `. ${item.note}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p>{prompt.pricingNote}</p>
          {prompt.preview.blockedReason && <p className="form-error" role="alert">{prompt.preview.blockedReason}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {canAnswer ? (
            <div className="calendar-link-actions">
              <button className="primary-button" disabled={busy || prompt.preview.blockedReason !== null} onClick={() => answer("update")} type="button">
                Update to {formatDateRange(prompt.itemStartsOn, prompt.itemEndsOn)}
              </button>
              <button className="secondary-button" disabled={busy} onClick={() => answer("keep")} type="button">Keep current dates</button>
            </div>
          ) : (
            <p>A system administrator chooses whether to update the dates or keep them.</p>
          )}
        </section>
      )}
    </div>
  );
}
