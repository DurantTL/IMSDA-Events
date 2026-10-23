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
import type { AlertFeed } from "@/modules/notifications/feed-model";

export const ATTENTION_ENDPOINT = "/api/admin/attention";
export const ALERT_FEED_ENDPOINT = "/api/admin/alert-feed";
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
  initialFeed = null,
}: {
  /** Render the panel already open (used by render tests). */
  defaultOpen?: boolean;
  /** A summary to show before any read (used by render tests). */
  initial?: AttentionSummary | null;
  /** The alert feed to show before any read (used by render tests). */
  initialFeed?: AlertFeed | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [summary, setSummary] = useState<AttentionSummary | null>(initial);
  const [state, setState] = useState<LoadState>(initial ? "ready" : "idle");
  const [feed, setFeed] = useState<AlertFeed | null>(initialFeed);
  const [feedFailed, setFeedFailed] = useState(false);
  const [feedBusy, setFeedBusy] = useState(false);
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

  /** The alert feed (#1033) is read beside the counts; its failure never hides them, nor theirs the feed. */
  const loadFeed = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(ALERT_FEED_ENDPOINT, { cache: "no-store", credentials: "same-origin", signal });
      if (!response.ok) throw new Error("alert feed request failed");
      const body = (await response.json()) as { feed?: AlertFeed };
      if (!body.feed || typeof body.feed.unreadCount !== "number" || !Array.isArray(body.feed.items)) throw new Error("unexpected response");
      setFeed(body.feed);
      setFeedFailed(false);
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      setFeedFailed(true);
    }
  }, []);

  /** Marks one item, or everything up to the newest item shown, read. The server answers with the new feed. */
  const changeFeed = useCallback(async (body: { action: "read"; id: string } | { action: "read-all"; cutoff?: string }) => {
    setFeedBusy(true);
    try {
      const response = await fetch(ALERT_FEED_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("alert feed update failed");
      const parsed = (await response.json()) as { feed?: AlertFeed };
      if (parsed.feed) setFeed(parsed.feed);
      setFeedFailed(false);
    } catch {
      setFeedFailed(true);
    } finally {
      setFeedBusy(false);
    }
  }, []);

  // The first read waits until the browser is idle, so the badge never competes with the page itself.
  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    const start = () => { void load(controller.signal); void loadFeed(controller.signal); };
    const idle = (window as unknown as { requestIdleCallback?: (callback: () => void) => number; cancelIdleCallback?: (id: number) => void });
    const handle = idle.requestIdleCallback ? idle.requestIdleCallback(start) : window.setTimeout(start, 300);
    return () => {
      controller.abort();
      if (idle.requestIdleCallback) idle.cancelIdleCallback?.(handle);
      else window.clearTimeout(handle);
    };
  }, [initial, load, loadFeed]);

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
    if (next && !initial) { void load(); void loadFeed(); }
  }

  // Unread alerts plus the live counts. Some records can appear in both, so this is a badge, not a count of unique records;
  // the panel keeps the two lists apart.
  const total = summary === null && feed === null ? null : (summary?.total ?? 0) + (feed?.unreadCount ?? 0);
  const unreadItems = feed?.items.filter((item) => !item.read) ?? [];

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
          <section aria-label="Recent alerts" className="attention-group alert-feed">
            <div className="alert-feed-head">
              <h3>Recent alerts{feed && feed.unreadCount > 0 ? `, ${feed.unreadCount} unread` : ""}</h3>
              {unreadItems.length > 0 && (
                <button
                  className="alert-feed-action"
                  disabled={feedBusy}
                  onClick={() => { void changeFeed({ action: "read-all", cutoff: feed?.items[0]?.occurredAt }); }}
                  type="button"
                >
                  Mark all read
                </button>
              )}
            </div>
            {feedFailed && <p className="attention-note" role="status">Alerts could not be loaded. The rest of the page is unaffected.</p>}
            {feed && feed.items.length === 0 && !feedFailed && <p role="status">No alerts in the last 90 days.</p>}
            {feed && feed.items.length > 0 && (
              <ul>
                {feed.items.map((item) => (
                  <li className="alert-feed-item" data-read={item.read ? "true" : "false"} key={item.id}>
                    {item.href && isSafeAttentionHref(item.href)
                      ? (
                        <Link
                          className="attention-item"
                          href={item.href}
                          onClick={() => { if (!item.read) void changeFeed({ action: "read", id: item.id }); setOpen(false); }}
                        >
                          <span><strong className="alert-feed-name">{item.alertName}</strong>{item.read ? "" : <span className="alert-feed-unread"> (unread)</span>}<br />{item.summary}</span>
                        </Link>
                      )
                      : (
                        <span className="attention-item">
                          <span><strong className="alert-feed-name">{item.alertName}</strong>{item.read ? "" : <span className="alert-feed-unread"> (unread)</span>}<br />{item.summary}</span>
                        </span>
                      )}
                    {!item.read && (
                      <button
                        aria-label={`Mark read: ${item.alertName}`}
                        className="alert-feed-action"
                        disabled={feedBusy}
                        onClick={() => { void changeFeed({ action: "read", id: item.id }); }}
                        type="button"
                      >
                        Mark read
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {summary?.partial && <p className="attention-note">Some checks could not be read, so this list may be incomplete.</p>}
          {summary?.truncated && <p className="attention-note">Only the {DIRECTORY_REVIEW_EVENT_LIMIT_LABEL} most recent events were checked for directory review.</p>}
        </div>
      )}
    </div>
  );
}
