"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Bell } from "lucide-react";
import {
  attentionBadgeText,
  attentionButtonName,
  isSafeAttentionHref,
  type AttentionSummary,
} from "@/modules/system-admin/attention-model";

export const ATTENTION_ENDPOINT = "/api/admin/attention";
const DIRECTORY_REVIEW_EVENT_LIMIT_LABEL = 10;

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * The system administrator notification bell (#1032). The shell renders it only
 * for system administrators, and the endpoint checks again. It never blocks the
 * page: the first read happens after the page is up, and a failed read leaves the
 * bell working with a plain "could not be loaded" message. The list is read again
 * each time the panel opens.
 *
 * It is a disclosure, like the staff account menu: Escape and outside clicks
 * close it, Escape returns focus to the button, and opening moves focus to the
 * panel heading so a keyboard user starts at the top of the list.
 */
export function AdminAttentionBell({
  defaultOpen = false,
  initial = null,
}: {
  /** Render the panel already open (used by render tests). */
  defaultOpen?: boolean;
  /** A summary to show before any read (used by render tests). */
  initial?: AttentionSummary | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [summary, setSummary] = useState<AttentionSummary | null>(initial);
  const [state, setState] = useState<LoadState>(initial ? "ready" : "idle");
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelId = useId();

  const load = useCallback(async (signal?: AbortSignal) => {
    setState((current) => (current === "ready" ? current : "loading"));
    try {
      const response = await fetch(ATTENTION_ENDPOINT, { cache: "no-store", credentials: "same-origin", signal });
      if (!response.ok) throw new Error("attention request failed");
      const body = (await response.json()) as { attention?: AttentionSummary };
      if (!body.attention || typeof body.attention.total !== "number" || !Array.isArray(body.attention.groups)) throw new Error("unexpected response");
      setSummary(body.attention);
      setState("ready");
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      setState("error");
    }
  }, []);

  // The first read waits until the browser is idle, so the badge never competes with the page itself.
  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    const start = () => { void load(controller.signal); };
    const idle = (window as unknown as { requestIdleCallback?: (callback: () => void) => number; cancelIdleCallback?: (id: number) => void });
    const handle = idle.requestIdleCallback ? idle.requestIdleCallback(start) : window.setTimeout(start, 300);
    return () => {
      controller.abort();
      if (idle.requestIdleCallback) idle.cancelIdleCallback?.(handle);
      else window.clearTimeout(handle);
    };
  }, [initial, load]);

  useEffect(() => {
    if (!open) return;
    headingRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Focus goes back to the bell only when it was inside the panel; otherwise the person is somewhere else on the page.
      const focusWasInside = anchorRef.current?.contains(document.activeElement) ?? false;
      setOpen(false);
      if (focusWasInside) triggerRef.current?.focus();
    }
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !initial) void load();
  }

  const total = summary?.total ?? null;

  return (
    <div
      className="menu-anchor"
      onBlur={(event) => {
        // Tabbing out of the panel closes it. A null target (a click on plain text, a window switch) is left to the
        // outside-click handler.
        const next = event.relatedTarget as Node | null;
        if (open && next && !event.currentTarget.contains(next)) setOpen(false);
      }}
      ref={anchorRef}
    >
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={attentionButtonName(total)}
        className="avatar attention-bell"
        onClick={toggle}
        ref={triggerRef}
        type="button"
      >
        <Bell aria-hidden="true" size={19} />
        {total !== null && total > 0 && <span aria-hidden="true" className="attention-badge">{attentionBadgeText(total)}</span>}
      </button>
      {open && (
        <div aria-label="Notifications" className="header-popover attention-popover" id={panelId} role="group">
          <h2 className="attention-heading" ref={headingRef} tabIndex={-1}>Needs attention</h2>
          {state === "loading" && !summary && <p role="status">Checking…</p>}
          {state === "error" && <p role="status">Notifications could not be loaded. The rest of the page is unaffected.</p>}
          {summary && summary.groups.length === 0 && state !== "error" && <p role="status">Nothing needs attention.</p>}
          {summary?.groups.map((group) => (
            <section aria-label={group.title} className="attention-group" key={group.key}>
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item.key}>
                    {isSafeAttentionHref(item.href)
                      ? (
                        <Link className="attention-item" href={item.href} onClick={() => setOpen(false)}>
                          <strong>{item.count}</strong>
                          <span>{item.label}</span>
                        </Link>
                      )
                      : <span className="attention-item"><strong>{item.count}</strong><span>{item.label}</span></span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {summary?.partial && <p className="attention-note">Some checks could not be read, so this list may be incomplete.</p>}
          {summary?.truncated && <p className="attention-note">Only the {DIRECTORY_REVIEW_EVENT_LIMIT_LABEL} most recent events were checked for directory review.</p>}
        </div>
      )}
    </div>
  );
}
