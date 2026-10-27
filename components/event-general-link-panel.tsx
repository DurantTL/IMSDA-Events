"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Copy, Link2 } from "lucide-react";
import { useConfirm } from "@/components/use-confirm";

export type GeneralLinkPanelSettings = {
  enabled: boolean;
  eligible: boolean;
  problem: string | null;
  isPublished: boolean;
  pendingCount: number;
};

/**
 * The event's general registration link (#931), for event administrators: one public address where club directors with no
 * account register a team. Shows the address to copy, and links to the teams waiting for a club.
 */
export function EventGeneralLinkPanel({ eventId, publicUrl, initialSettings }: { eventId: string; publicUrl: string; initialSettings: GeneralLinkPanelSettings }) {
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const [settings, setSettings] = useState(initialSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function toggle(enabled: boolean) {
    // One click changes what the public can open, so the consequence is shown first (#1258). Cancel changes nothing.
    const confirmed = await askConfirm({
      title: enabled ? "Turn on the general registration link" : "Turn off the general registration link",
      confirmLabel: enabled ? "Turn the link on" : "Turn the link off",
      body: enabled ? (
        <p>
          Anyone with the link can register a club team for this event without an account. A team whose director is not a current
          director or deputy of the club waits in <strong>Teams waiting for a club</strong> until you confirm it. You can turn it off again.
        </p>
      ) : (
        <p>
          The public registration page stops working right away and shows &ldquo;not found&rdquo; to anyone who opens the link you shared.
          Teams already registered or waiting stay where they are. You can turn it on again.
        </p>
      ),
    });
    if (!confirmed) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/general-link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const result = await response.json().catch(() => ({})) as { settings?: GeneralLinkPanelSettings; message?: string };
      if (!response.ok || !result.settings) {
        setError(result.message ?? "The setting couldn't be saved.");
        return;
      }
      setSettings(result.settings);
      setNotice(enabled ? "The general registration link is on." : "The general registration link is off.");
    } catch {
      setError("We couldn't reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setNotice("Link copied.");
    } catch {
      setNotice("Select the link and copy it.");
    }
  }

  return (
    <section className="panel" aria-labelledby="general-link-heading" id="general-link">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Club registration</p>
          <h2 id="general-link-heading"><Link2 aria-hidden="true" size={18} /> General registration link</h2>
          <p>
            One public link for every club, to share by email, newsletter or social media. A club director with no account registers
            a team and picks the club from the directory. When the director&rsquo;s email is a current director or deputy of that
            club the team is attached right away; otherwise it waits for you to confirm or change the club.
          </p>
        </div>
      </div>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {notice && <div className="inline-notice" role="status"><CheckCircle2 aria-hidden="true" size={14} /> {notice}</div>}
      <label className="checkbox-label">
        <input checked={settings.enabled} disabled={busy || (!settings.eligible && !settings.enabled)} onChange={(event) => void toggle(event.target.checked)} type="checkbox" />
        <span>
          <strong>Turn on the general registration link</strong>
          <small>For club events billed to the church. Turning it off hides the page; teams already waiting stay in the list.</small>
        </span>
      </label>
      {settings.problem && <p className="field-help" role="status">{settings.problem}</p>}
      {settings.enabled && !settings.isPublished && <p className="field-help" role="status">The event is not published yet, so the link shows &ldquo;not found&rdquo; until it is.</p>}
      {settings.enabled && (
        <div className="form-stack">
          <label htmlFor="general-link-url">Link to share</label>
          <div className="intro-actions">
            <input id="general-link-url" readOnly onFocus={(event) => event.currentTarget.select()} value={publicUrl} />
            <button className="secondary-button" onClick={() => void copy()} type="button"><Copy aria-hidden="true" size={15} /> Copy link</button>
          </div>
        </div>
      )}
      {settings.enabled && (
        <p>
          <Link className="text-button" href={`/people/pending-teams?event=${encodeURIComponent(eventId)}`}>
            Teams waiting for a club{settings.pendingCount > 0 ? ` (${settings.pendingCount})` : ""}
          </Link>
        </p>
      )}
      {confirmDialog}
    </section>
  );
}
