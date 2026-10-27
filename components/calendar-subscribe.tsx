"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { CalendarPlus, Check, ChevronDown, Copy, ExternalLink, Link2 } from "lucide-react";
import type { CalendarSubscribeLinks } from "@/modules/calendar/subscribe";

/**
 * One "Add these dates to my calendar" button that opens the choice of calendar apps for the public feed (#444, #1203).
 * `variant="button"` (#1249) is the compact page-header form: just "Add to my calendar" with the same choices in a popover
 * under it, no heading or sentence.
 */
export function CalendarSubscribe({ links, variant = "panel" }: { links: CalendarSubscribeLinks; variant?: "panel" | "button" }) {
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement | HTMLDivElement>(null);

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

  async function copy() {
    try {
      await navigator.clipboard.writeText(links.feedUrl);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied(null), 3000);
  }

  const compact = variant === "button";
  const toggle = (
    <button
      aria-controls="calendar-subscribe-options"
      aria-expanded={open}
      className="primary-button calendar-subscribe-toggle"
      onClick={() => setOpen((value) => !value)}
      ref={button}
      type="button"
    >
      <CalendarPlus size={16} aria-hidden="true" /> {compact ? "Add to my calendar" : "Add these dates to my calendar"} <ChevronDown size={16} aria-hidden="true" />
    </button>
  );
  const options = (
    <ul className="calendar-subscribe-options" hidden={!open} id="calendar-subscribe-options">
      <li><a href={links.google} rel="noreferrer" target="_blank">Google Calendar <ExternalLink size={14} aria-hidden="true" /></a></li>
      <li><a href={links.outlook} rel="noreferrer" target="_blank">Outlook.com <ExternalLink size={14} aria-hidden="true" /></a></li>
      <li><a href={links.outlookWork} rel="noreferrer" target="_blank">Outlook (work or school) <ExternalLink size={14} aria-hidden="true" /></a></li>
      <li><a href={links.apple}>Apple Calendar</a></li>
      <li><a href={links.feedUrl}><Link2 size={14} aria-hidden="true" /> ICS link</a></li>
      <li>
        <button onClick={() => void copy()} type="button">
          {copied === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} Copy link
        </button>
      </li>
    </ul>
  );
  const status = (
    <p aria-live="polite" className="calendar-subscribe-status" role="status">
      {copied === "copied" ? "Calendar link copied." : copied === "failed" ? `Copy this link instead: ${links.feedUrl}` : ""}
    </p>
  );

  if (compact) {
    return (
      <div className="calendar-subscribe-compact" id="subscribe" onKeyDown={onKeyDown} ref={panel as RefObject<HTMLDivElement>}>
        {toggle}
        <div className="calendar-subscribe-popover" hidden={!open}>
          {options}
          {status}
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="calendar-subscribe-heading" className="calendar-subscribe-panel" id="subscribe" onKeyDown={onKeyDown} ref={panel}>
      <div>
        <h2 id="calendar-subscribe-heading"><CalendarPlus size={18} aria-hidden="true" /> Add to your calendar</h2>
        <p>Subscribe once and every conference date stays up to date in your own calendar app.</p>
      </div>
      <div className="calendar-subscribe-menu">
        {toggle}
        {options}
      </div>
      {status}
    </section>
  );
}
