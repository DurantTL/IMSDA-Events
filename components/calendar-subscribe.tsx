"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CalendarPlus, Check, ChevronDown, Copy, ExternalLink, Link2 } from "lucide-react";
import type { CalendarSubscribeLinks } from "@/modules/calendar/subscribe";

/** One "Add these dates to my calendar" button that opens the choice of calendar apps for the public feed (#444, #1203). */
export function CalendarSubscribe({ links }: { links: CalendarSubscribeLinks }) {
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    function away(event: PointerEvent) {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
  }

  // "Added ✓" is a short confirmation (#1211); the button returns to its own name so the menu stays findable.
  function markAdded() {
    setAdded(true);
    window.setTimeout(() => setAdded(false), 4000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(links.feedUrl);
      setCopied("copied");
      markAdded();
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied(null), 3000);
  }

  return (
    <section aria-labelledby="calendar-subscribe-heading" className="calendar-subscribe-panel" id="subscribe" onKeyDown={onKeyDown} ref={panel}>
      <div>
        <h2 id="calendar-subscribe-heading"><CalendarPlus size={18} aria-hidden="true" /> Add to your calendar</h2>
        <p>Subscribe once and every conference date stays up to date in your own calendar app.</p>
      </div>
      <div className="calendar-subscribe-menu">
        <button
          aria-controls="calendar-subscribe-options"
          aria-expanded={open}
          className="primary-button calendar-subscribe-toggle"
          onClick={() => setOpen((value) => !value)}
          ref={button}
          type="button"
        >
          {added ? <Check size={16} aria-hidden="true" /> : <CalendarPlus size={16} aria-hidden="true" />} {added ? "Added" : "Add these dates to my calendar"}{added && <span aria-hidden="true"> ✓</span>} <ChevronDown size={16} aria-hidden="true" />
        </button>
        <ul className="calendar-subscribe-options" hidden={!open} id="calendar-subscribe-options" onClick={(event) => { if (event.target instanceof Element && event.target.closest("a")) markAdded(); }}>
          <li><a href={links.google} rel="noreferrer" target="_blank">Google Calendar <ExternalLink size={14} aria-hidden="true" /></a></li>
          <li><a href={links.outlook} rel="noreferrer" target="_blank">Outlook.com <ExternalLink size={14} aria-hidden="true" /></a></li>
          <li><a href={links.outlookWork} rel="noreferrer" target="_blank">Outlook (work or school) <ExternalLink size={14} aria-hidden="true" /></a></li>
          <li><a href={links.apple}>Apple Calendar</a></li>
          <li><a href={links.feedUrl}><Link2 size={14} aria-hidden="true" /> ICS link</a></li>
          <li>
            <button onClick={() => void copy()} type="button">
              {copied === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied === "copied" ? "Copied" : "Copy link"}{copied === "copied" && <span aria-hidden="true"> ✓</span>}
            </button>
          </li>
        </ul>
      </div>
      <p aria-live="polite" className="calendar-subscribe-status" role="status">
        {added && copied !== "copied" ? "Added to calendar." : copied === "copied" ? "Calendar link copied." : copied === "failed" ? `Copy this link instead: ${links.feedUrl}` : ""}
      </p>
    </section>
  );
}
