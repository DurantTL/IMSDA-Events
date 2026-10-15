"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CalendarLinkNotice } from "@/modules/calendar/event-links";
import { formatDateRange } from "@/modules/calendar/domain";

type CalendarLinkBannerProps = {
  eventId: string;
  notice: CalendarLinkNotice;
};

/**
 * The event's side of a linked calendar item (#445). When the item's dates move
 * (Google moved it, or staff edited it), nothing changes on its own: the banner
 * asks, previews what Update changes and what it leaves alone, and applies
 * only the choice a staff member clicks. A removed item only warns.
 *
 * After an answer the page is loaded again with `calendarDates=updated|kept`, which
 * remounts the settings form with the event's current dates (so a later save can't
 * write the old ones back) and shows the confirmation (`CalendarDatesConfirmation`).
 */
export function CalendarLinkBanner({ eventId, notice }: CalendarLinkBannerProps) {
  const router = useRouter();
  const prompt = notice.datePrompt;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      router.replace(`/more/event-settings?event=${encodeURIComponent(eventId)}&calendarDates=${decision === "update" ? "updated" : "kept"}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
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
      {prompt && (
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
          {prompt.preview.notes.map((note) => <p key={note}>{note}</p>)}
          <p>{prompt.pricingNote}</p>
          {prompt.preview.blockedReason && <p className="form-error" role="alert">{prompt.preview.blockedReason}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="calendar-link-actions">
            <button className="primary-button" disabled={busy || prompt.preview.blockedReason !== null} onClick={() => answer("update")} type="button">
              Update to {formatDateRange(prompt.itemStartsOn, prompt.itemEndsOn)}
            </button>
            <button className="secondary-button" disabled={busy} onClick={() => answer("keep")} type="button">Keep current dates</button>
          </div>
        </section>
      )}
    </div>
  );
}

/** The confirmation shown after Update or Keep, from the page's own address, so it survives the reload. */
export function CalendarDatesConfirmation({ outcome }: { outcome: "updated" | "kept" }) {
  return (
    <div className="inline-notice calendar-link-banner" role="status" data-testid="calendar-dates-confirmation">
      {outcome === "updated"
        ? "Registration dates updated to match the calendar. This is recorded in the event's history. Check the dates listed as unchanged in the question you just answered."
        : "Keeping the current registration dates. This is recorded in the event's history."}
    </div>
  );
}
