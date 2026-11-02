"use client";

import { SubmitButton } from "@/components/submit-button";
import { useState } from "react";
import { Eye, Flag, MessageSquareWarning, Save, ShieldCheck, UsersRound } from "lucide-react";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { EmptyState } from "@/components/empty-state";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";

type StaffCommunity = {
  eventId: string;
  eventSlug: string;
  eventName: string;
  settings: {
    isEnabled: boolean;
    allowNewPosts: boolean;
    allowReplies: boolean;
    conductVersion: number;
    conductText: string;
    retentionDays: number;
  };
  participantCount: number;
  posts: Array<{
    id: string;
    parentId: string | null;
    body: string;
    status: "PUBLISHED" | "HIDDEN" | "REMOVED";
    moderationNote: string | null;
    authorDeletedAt: string | null;
    lastEditedAt: string | null;
    createdAt: string;
    authorName: string;
    authorEmail: string;
    openReports: number;
    revisions: Array<{ body: string; createdAt: string }>;
    replies: Array<{
      id: string;
      parentId: string | null;
      body: string;
      status: "PUBLISHED" | "HIDDEN" | "REMOVED";
      moderationNote: string | null;
      authorDeletedAt: string | null;
      lastEditedAt: string | null;
      createdAt: string;
      authorName: string;
      authorEmail: string;
      openReports: number;
      revisions: Array<{ body: string; createdAt: string }>;
    }>;
  }>;
  nextPostCursor: string | null;
  reports: Array<{
    id: string;
    postId: string;
    reason: string;
    detail: string | null;
    createdAt: string;
    reporterName: string;
    reporterEmail: string;
    authorName: string;
    authorEmail: string;
    postBody: string;
    postStatus: string;
  }>;
};

function when(value: string) {
  return formatInConferenceTime(value, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * True when a moderation or report form holds something other than the status and note it opened with
 * (uncontrolled fields, so the values are read from the form itself).
 */
export function moderationFormEdited(form: HTMLFormElement, baseStatus: string, baseNote: string): boolean {
  const data = new FormData(form);
  return String(data.get("status") ?? baseStatus) !== baseStatus || String(data.get("note") ?? "") !== baseNote;
}

export function CommunityModerationWorkspace({ community }: { community: StaffCommunity }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [posts, setPosts] = useState(community.posts);
  const [nextPostCursor, setNextPostCursor] = useState(community.nextPostCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [settings, setSettings] = useState({
    isEnabled: community.settings.isEnabled,
    allowNewPosts: community.settings.allowNewPosts,
    allowReplies: community.settings.allowReplies,
    conductText: community.settings.conductText,
    retentionDays: String(community.settings.retentionDays),
  });
  const [editedForms, setEditedForms] = useState<ReadonlySet<string>>(new Set());
  const settingsDirty = settings.isEnabled !== community.settings.isEnabled
    || settings.allowNewPosts !== community.settings.allowNewPosts
    || settings.allowReplies !== community.settings.allowReplies
    || settings.conductText !== community.settings.conductText
    || settings.retentionDays !== String(community.settings.retentionDays);
  // Dirty while the controls differ from what is saved, or a post or report form has an unsent change. Every
  // successful save reloads the page, so that is allowed through below (#1468).
  const allowNavigation = useUnsavedChangesGuard(settingsDirty || editedForms.size > 0);
  const trackForm = (key: string, form: HTMLFormElement, baseStatus: string, baseNote: string) => {
    const edited = moderationFormEdited(form, baseStatus, baseNote);
    setEditedForms((current) => {
      if (current.has(key) === edited) return current;
      const next = new Set(current);
      if (edited) next.add(key); else next.delete(key);
      return next;
    });
  };
  const endpoint = `/api/events/${encodeURIComponent(community.eventId)}/community`;

  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "The community change failed.");
      allowNavigation();
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The community change failed.");
      setBusy(false);
    }
  }

  async function loadMorePosts() {
    if (!nextPostCursor) return;
    setLoadingMore(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}?cursor=${encodeURIComponent(nextPostCursor)}`, { cache: "no-store" });
      const result = await response.json() as { message?: string; posts?: StaffCommunity["posts"]; nextPostCursor?: string | null };
      if (!response.ok) throw new Error(result.message ?? "Unable to load earlier conversations.");
      setPosts((current) => [...current, ...(result.posts ?? [])]);
      setNextPostCursor(result.nextPostCursor ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load earlier conversations.");
    } finally {
      setLoadingMore(false);
    }
  }

  function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void action({
      action: "UPDATE_SETTINGS",
      isEnabled: form.get("isEnabled") === "on",
      allowNewPosts: form.get("allowNewPosts") === "on",
      allowReplies: form.get("allowReplies") === "on",
      conductText: String(form.get("conductText") ?? ""),
      retentionDays: Number(form.get("retentionDays")),
    });
  }

  function moderationForm(
    event: React.FormEvent<HTMLFormElement>,
    postId: string,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void action({
      action: "MODERATE_POST",
      postId,
      status: String(form.get("status")),
      note: String(form.get("note") ?? ""),
    });
  }

  function reportForm(
    event: React.FormEvent<HTMLFormElement>,
    reportId: string,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void action({
      action: "RESOLVE_REPORT",
      reportId,
      status: String(form.get("status")),
      note: String(form.get("note") ?? ""),
    });
  }

  return (
    <div className="community-moderation-stack">
      {error && <p className="inline-notice error" role="alert">{error}</p>}

      <section className="panel community-settings-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Safety and availability</p>
            <h2>Community controls</h2>
            <p>Discussion remains private to verified attendees with active registrations.</p>
          </div>
          <span className={`status-chip ${community.settings.isEnabled ? "green" : "gold"}`}>
            {community.settings.isEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <form onSubmit={saveSettings}>
          <div className="community-toggle-grid">
            <label><input checked={settings.isEnabled} onChange={(event) => setSettings((current) => ({ ...current, isEnabled: event.target.checked }))} name="isEnabled" type="checkbox" /> Enable attendee community</label>
            <label><input checked={settings.allowNewPosts} onChange={(event) => setSettings((current) => ({ ...current, allowNewPosts: event.target.checked }))} name="allowNewPosts" type="checkbox" /> Allow new conversations</label>
            <label><input checked={settings.allowReplies} onChange={(event) => setSettings((current) => ({ ...current, allowReplies: event.target.checked }))} name="allowReplies" type="checkbox" /> Allow replies</label>
          </div>
          <label>
            <span>Conduct agreement · version {community.settings.conductVersion}</span>
            <textarea value={settings.conductText} onChange={(event) => setSettings((current) => ({ ...current, conductText: event.target.value }))} maxLength={4000} minLength={40} name="conductText" required rows={5} />
            <small>Changing this text requires every participant to accept the new version before posting again.</small>
          </label>
          <label>
            <span>Delete discussion after the event</span>
            <select value={settings.retentionDays} onChange={(event) => setSettings((current) => ({ ...current, retentionDays: event.target.value }))} name="retentionDays">
              <option value="7">7 days after</option>
              <option value="14">14 days after</option>
              <option value="30">30 days after</option>
              <option value="60">60 days after</option>
              <option value="90">90 days after</option>
              <option value="180">180 days after</option>
              <option value="365">1 year after</option>
            </select>
          </label>
          <SubmitButton icon={<Save size={16} aria-hidden="true" />} iconSize={16} label="Save controls" submitting={busy} submittingLabel="Saving…" />
        </form>
      </section>

      <section className="community-staff-summary" aria-label="Community summary">
        <article><UsersRound size={20} aria-hidden="true" /><strong>{community.participantCount}</strong><span>participants</span></article>
        <article><MessageSquareWarning size={20} aria-hidden="true" /><strong>{posts.length}</strong><span>loaded conversations</span></article>
        <article className={community.reports.length ? "is-warning" : ""}><Flag size={20} aria-hidden="true" /><strong>{community.reports.length}</strong><span>open reports</span></article>
      </section>

      <section className="panel community-reports-panel">
        <div className="section-heading">
          <div><p className="eyebrow">Private moderation queue</p><h2>Open attendee reports</h2></div>
          <ShieldCheck size={21} aria-hidden="true" />
        </div>
        {community.reports.length === 0 ? (
          <EmptyState hint="Nothing to do here. Reports from attendees will appear in this queue." title="No open reports">Attendees have not reported any posts, or every report has been handled.</EmptyState>
        ) : community.reports.map((report) => (
          <article className="community-report-card" key={report.id}>
            <header><strong>{report.reason.toLowerCase()}</strong><time>{when(report.createdAt)}</time></header>
            <p>“{report.postBody}”</p>
            <dl>
              <div><dt>Post author</dt><dd>{report.authorName} · {report.authorEmail}</dd></div>
              <div><dt>Reported by</dt><dd>{report.reporterName} · {report.reporterEmail}</dd></div>
            </dl>
            {report.detail && <p><strong>Reporter detail:</strong> {report.detail}</p>}
            <form onChange={(event) => trackForm(`report:${report.id}`, event.currentTarget, "RESOLVED", "")} onSubmit={(event) => reportForm(event, report.id)}>
              <select defaultValue="RESOLVED" name="status">
                <option value="RESOLVED">Resolve after review</option>
                <option value="DISMISSED">Dismiss report</option>
              </select>
              <input maxLength={500} name="note" placeholder="Private resolution note" />
              <button className="secondary-button" disabled={busy} type="submit">Close report</button>
            </form>
          </article>
        ))}
      </section>

      <section className="panel community-post-review">
        <div className="section-heading">
          <div><p className="eyebrow">Discussion review</p><h2>Posts and replies</h2></div>
          <a className="secondary-button" href={`/account/events/${encodeURIComponent(community.eventSlug)}?preview=staff`}>
            <Eye size={15} aria-hidden="true" /> Preview attendee view
          </a>
        </div>
        {posts.length === 0 ? (
          <EmptyState hint="Posts and replies from attendees will appear here for review." title="No conversations yet">Attendees have not started any discussions for this event.</EmptyState>
        ) : posts.map((post) => (
          <article className="community-staff-post" key={post.id}>
            <header>
              <div><strong>{post.authorName}</strong><small>{post.authorEmail}</small></div>
              <span className={`status-chip ${post.status === "PUBLISHED" ? "green" : "gold"}`}>{post.status.toLowerCase()}</span>
            </header>
            <p>{post.body}</p>
            <small>{when(post.createdAt)} · {post.openReports} open reports{post.authorDeletedAt ? ` · author deleted ${when(post.authorDeletedAt)}` : ""}{post.lastEditedAt ? ` · last edited ${when(post.lastEditedAt)}` : ""}</small>
            {post.revisions.length > 0 && (
              <details className="community-revision-history">
                <summary>{post.revisions.length} earlier version{post.revisions.length === 1 ? "" : "s"}</summary>
                {post.revisions.map((revision, index) => <p key={`${revision.createdAt}:${index}`}><small>{when(revision.createdAt)}</small><br />{revision.body}</p>)}
              </details>
            )}
            <form onChange={(event) => trackForm(`post:${post.id}`, event.currentTarget, post.status, post.moderationNote ?? "")} onSubmit={(event) => moderationForm(event, post.id)}>
              <select defaultValue={post.status} name="status">
                <option value="PUBLISHED">Visible</option>
                <option value="HIDDEN">Hide pending review</option>
                <option value="REMOVED">Remove</option>
              </select>
              <input defaultValue={post.moderationNote ?? ""} maxLength={500} name="note" placeholder="Private moderation note" />
              <button className="secondary-button" disabled={busy} type="submit">Apply</button>
            </form>
            {post.replies.map((reply) => (
              <article className="community-staff-reply" key={reply.id}>
                <header><div><strong>{reply.authorName}</strong><small>{reply.authorEmail}</small></div><span>{reply.status.toLowerCase()}</span></header>
                <p>{reply.body}</p>
                <small>{when(reply.createdAt)}{reply.authorDeletedAt ? ` · author deleted ${when(reply.authorDeletedAt)}` : ""}{reply.lastEditedAt ? ` · last edited ${when(reply.lastEditedAt)}` : ""}</small>
                {reply.revisions.length > 0 && (
                  <details className="community-revision-history">
                    <summary>{reply.revisions.length} earlier version{reply.revisions.length === 1 ? "" : "s"}</summary>
                    {reply.revisions.map((revision, index) => <p key={`${revision.createdAt}:${index}`}><small>{when(revision.createdAt)}</small><br />{revision.body}</p>)}
                  </details>
                )}
                <form onChange={(event) => trackForm(`post:${reply.id}`, event.currentTarget, reply.status, reply.moderationNote ?? "")} onSubmit={(event) => moderationForm(event, reply.id)}>
                  <select defaultValue={reply.status} name="status">
                    <option value="PUBLISHED">Visible</option>
                    <option value="HIDDEN">Hide</option>
                    <option value="REMOVED">Remove</option>
                  </select>
                  <input defaultValue={reply.moderationNote ?? ""} maxLength={500} name="note" placeholder="Private note" />
                  <button className="secondary-button" disabled={busy} type="submit">Apply</button>
                </form>
              </article>
            ))}
          </article>
        ))}
        {nextPostCursor && <button className="secondary-button" disabled={loadingMore} onClick={() => void loadMorePosts()} type="button">{loadingMore ? "Loading…" : "Load earlier conversations"}</button>}
      </section>
    </div>
  );
}
