"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, Plus, Save, Send, Trash2, Undo2 } from "lucide-react";
import { useConfirm } from "@/components/use-confirm";
import { homeFeaturedLimit } from "@/modules/events/featured-domain";
import {
  defaultSectionHeadings,
  limits,
  noticeLevelLabels,
  noticeLevels,
  sectionDescriptions,
  type HubAnnouncement,
  type HubContent,
  type HubLink,
  type HubNotice,
  type NoticeLevel,
} from "@/modules/site-content/hub-content-domain";
import type { RevisionSummary } from "@/modules/site-content/hub-content";
import styles from "./site-content-workspace.module.css";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

export type FeaturableEvent = { id: string; name: string; startsOn: string; endsOn: string };

type Props = {
  initialContent: HubContent;
  draft: RevisionSummary | null;
  published: RevisionSummary | null;
  draftDiffers: boolean;
  history: RevisionSummary[];
  events: FeaturableEvent[];
};

const when = (iso: string | null) =>
  iso ? formatInConferenceTime(iso, { dateStyle: "medium", timeStyle: "short" }) : "";

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/-/g, "").slice(0, 12);

function move<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return [...list];
  const copy = [...list];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((item, position) => (position === index ? value : item));
}

async function send(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(result.message ?? "That could not be saved. Try again.");
  return result;
}

function MoveButtons({ index, length, label, onMove, onRemove }: { index: number; length: number; label: string; onMove: (delta: -1 | 1) => void; onRemove?: () => void }) {
  return (
    <span className={styles.rowButtons}>
      <button aria-label={`Move ${label} up`} className="secondary-button" disabled={index === 0} onClick={() => onMove(-1)} type="button"><ArrowUp aria-hidden="true" size={16} /></button>
      <button aria-label={`Move ${label} down`} className="secondary-button" disabled={index === length - 1} onClick={() => onMove(1)} type="button"><ArrowDown aria-hidden="true" size={16} /></button>
      {onRemove && <button aria-label={`Remove ${label}`} className="secondary-button" onClick={onRemove} type="button"><Trash2 aria-hidden="true" size={16} /> Remove</button>}
    </span>
  );
}

function LinkRows({ links, max, onChange, what }: { links: HubLink[]; max: number; onChange: (links: HubLink[]) => void; what: string }) {
  return (
    <div className={styles.stack}>
      {links.map((link, index) => (
        <div className={styles.item} key={index}>
          <div className={styles.fields}>
            <label>Link text
              <input maxLength={limits.navLabel} onChange={(event) => onChange(replaceAt(links, index, { ...link, label: event.target.value }))} value={link.label} />
            </label>
            <label>Address
              <input inputMode="url" maxLength={limits.href} onChange={(event) => onChange(replaceAt(links, index, { ...link, href: event.target.value }))} placeholder="/calendar or https://…" value={link.href} />
            </label>
          </div>
          <MoveButtons index={index} label={`${what} ${index + 1}`} length={links.length} onMove={(delta) => onChange(move(links, index, delta))} onRemove={() => onChange(links.filter((_, position) => position !== index))} />
        </div>
      ))}
      {links.length < max && (
        <div><button className="secondary-button" onClick={() => onChange([...links, { label: "", href: "" }])} type="button"><Plus aria-hidden="true" size={16} /> Add a {what}</button></div>
      )}
    </div>
  );
}

function WindowFields({ value, onChange }: { value: { startsOn?: string; endsOn?: string }; onChange: (next: { startsOn?: string; endsOn?: string }) => void }) {
  return (
    <>
      <label>Show from (optional)
        <input onChange={(event) => onChange({ ...value, startsOn: event.target.value })} type="date" value={value.startsOn ?? ""} />
      </label>
      <label>Show through (optional)
        <input onChange={(event) => onChange({ ...value, endsOn: event.target.value })} type="date" value={value.endsOn ?? ""} />
      </label>
    </>
  );
}

export function SiteContentWorkspace({ initialContent, draft, published, draftDiffers, history, events }: Props) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const statusId = useId();
  const [content, setContent] = useState<HubContent>(initialContent);
  const [savedJson, setSavedJson] = useState(JSON.stringify(initialContent));
  const [hasDraft, setHasDraft] = useState(Boolean(draft));
  // The draft as last seen (its id and updatedAt), sent with every change so a change made by someone else is a conflict, not a silent overwrite.
  const [base, setBase] = useState<{ id: string; updatedAt: string } | null>(draft ? { id: draft.id, updatedAt: draft.updatedAt } : null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState(draft?.note ?? "");
  const [savedNote, setSavedNote] = useState(draft?.note ?? "");
  const dirty = JSON.stringify(content) !== savedJson || note !== savedNote;
  const patch = (next: Partial<HubContent>) => setContent((current) => ({ ...current, ...next }));
  const eventById = new Map(events.map((event) => [event.id, event]));

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await work());
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    const result = await send("/api/admin/site-content/draft", "PUT", { content, note, base }) as { draft?: { id: string; updatedAt: string } };
    const next = result.draft ? { id: result.draft.id, updatedAt: result.draft.updatedAt } : base;
    setBase(next);
    setSavedJson(JSON.stringify(content));
    setSavedNote(note);
    setHasDraft(true);
    return next;
  }

  const onSave = () => run(async () => {
    await saveDraft();
    return "Draft saved. Visitors still see the published version.";
  });

  async function onPublish() {
    if (!(await confirm({
      title: "Publish the homepage and site content?",
      body: <p>Visitors see this version on their next page load. The version showing now is kept in the history, and you can restore it.</p>,
      confirmLabel: "Publish now",
    }))) return;
    await run(async () => {
      const seen = dirty || !hasDraft ? await saveDraft() : base;
      await send("/api/admin/site-content/publish", "POST", { base: seen });
      setHasDraft(false);
      setBase(null);
      return "Published. Visitors now see this version.";
    });
  }

  async function onDiscard() {
    if (!(await confirm({
      title: "Discard the draft?",
      body: <p>Your unpublished changes are thrown away. What visitors see does not change.</p>,
      confirmLabel: "Discard the draft",
      destructive: true,
    }))) return;
    await run(async () => {
      await send("/api/admin/site-content/draft", "DELETE", { base });
      setHasDraft(false);
      setBase(null);
      return "Draft discarded. Reload the page to start again from what is published.";
    });
  }

  async function onRestore(revision: RevisionSummary) {
    if (!(await confirm({
      title: "Restore this version?",
      body: <p>The version from {when(revision.publishedAt ?? revision.createdAt)} is published again as a new version, starting now. Your draft is not changed.</p>,
      confirmLabel: "Restore this version",
    }))) return;
    await run(async () => {
      await send(`/api/admin/site-content/restore/${encodeURIComponent(revision.id)}`, "POST");
      return "Restored and published.";
    });
  }

  const featuredIds = content.featuredEventIds;
  const addableEvents = events.filter((event) => !featuredIds.includes(event.id));
  const [pick, setPick] = useState("");

  return (
    <div className={styles.workspace}>
      {confirmDialog}
      <section aria-labelledby="site-content-state" className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Public homepage</p>
            <h2 id="site-content-state">Homepage &amp; site content</h2>
          </div>
        </div>
        <p className={styles.stateBar}>
          {published
            ? <span className="status-chip green">Published{published.publishedByName ? ` by ${published.publishedByName}` : ""} {when(published.publishedAt)}</span>
            : <span className="status-chip neutral">Nothing published yet: visitors see the standard homepage</span>}
          {dirty
            ? <span className="status-chip gold">Unsaved changes</span>
            : hasDraft && draftDiffers
              ? <span className="status-chip gold">Draft not published</span>
              : <span className="status-chip neutral">No unpublished changes</span>}
        </p>
        <p className={styles.note}>
          Everything here is plain text. Save a draft, preview it, then publish. Visitors see nothing until you publish, and every step is recorded.
        </p>
        <label className={styles.stack}>
          <span>Note for the history (optional) <span className={styles.count}>({note.length}/{limits.revisionNote})</span></span>
          <input maxLength={limits.revisionNote} onChange={(event) => setNote(event.target.value)} value={note} />
        </label>
        <div className={styles.actions}>
          <button className="primary-button" disabled={busy || !dirty} onClick={() => void onSave()} type="button"><Save aria-hidden="true" size={16} /> Save draft</button>
          <a aria-disabled={!hasDraft} className="secondary-button" href={hasDraft ? "/admin/site-content/preview" : undefined} rel="noopener" target="_blank"><Eye aria-hidden="true" size={16} /> Preview<span className="sr-only"> (opens in a new tab)</span></a>
          <button className="primary-button" disabled={busy || (!hasDraft && !dirty)} onClick={() => void onPublish()} type="button"><Send aria-hidden="true" size={16} /> Publish</button>
          <button className="secondary-button" disabled={busy || !hasDraft} onClick={() => void onDiscard()} type="button"><Trash2 aria-hidden="true" size={16} /> Discard draft</button>
        </div>
        <div aria-live="polite" className={styles.status} id={statusId} role="status">
          {message}
          {error ? <span className={styles.error} role="alert">{error}</span> : null}
        </div>
        {dirty && <p className={styles.note}>Save the draft before you preview, so the preview shows these changes.</p>}
      </section>

      <section aria-labelledby="site-content-notices" className="panel">
        <div className="section-heading"><div><h2 id="site-content-notices">Notices</h2></div></div>
        <p className="field-help" style={{ margin: "4px 0 0" }}>A banner at the top of the homepage, the calendar and the events pages. Use it for closures and urgent news. Up to {limits.notices}.</p>
        <div className={styles.stack}>
          {content.notices.map((notice, index) => {
            const update = (next: Partial<HubNotice>) => patch({ notices: replaceAt(content.notices, index, { ...notice, ...next }) });
            return (
              <div className={styles.item} key={notice.id}>
                <div className={styles.fields}>
                  <label>Level
                    <select onChange={(event) => update({ level: event.target.value as NoticeLevel })} value={notice.level}>
                      {noticeLevels.map((level) => <option key={level} value={level}>{noticeLevelLabels[level]}</option>)}
                    </select>
                  </label>
                  <label className={styles.wide}>Message <span className={styles.count}>({notice.message.length}/{limits.noticeMessage})</span>
                    <textarea maxLength={limits.noticeMessage} onChange={(event) => update({ message: event.target.value })} rows={2} value={notice.message} />
                  </label>
                  <label>Link text (optional)
                    <input maxLength={limits.linkLabel} onChange={(event) => update({ linkLabel: event.target.value })} value={notice.linkLabel ?? ""} />
                  </label>
                  <label>Link address (optional)
                    <input inputMode="url" maxLength={limits.href} onChange={(event) => update({ linkHref: event.target.value })} placeholder="/calendar or https://…" value={notice.linkHref ?? ""} />
                  </label>
                  <WindowFields onChange={update} value={notice} />
                </div>
                <MoveButtons index={index} label={`notice ${index + 1}`} length={content.notices.length} onMove={(delta) => patch({ notices: move(content.notices, index, delta) })} onRemove={() => patch({ notices: content.notices.filter((_, position) => position !== index) })} />
              </div>
            );
          })}
          {content.notices.length < limits.notices && (
            <div><button className="secondary-button" onClick={() => patch({ notices: [...content.notices, { id: newId(), level: "INFO", message: "" }] })} type="button"><Plus aria-hidden="true" size={16} /> Add a notice</button></div>
          )}
        </div>
      </section>

      <section aria-labelledby="site-content-announcements" className="panel">
        <div className="section-heading"><div><h2 id="site-content-announcements">Announcements</h2></div></div>
        <p className="field-help" style={{ margin: "4px 0 0" }}>Short items in the Announcements section of the homepage. The section is hidden while none are showing. Up to {limits.announcements}.</p>
        <div className={styles.stack}>
          {content.announcements.map((announcement, index) => {
            const update = (next: Partial<HubAnnouncement>) => patch({ announcements: replaceAt(content.announcements, index, { ...announcement, ...next }) });
            return (
              <div className={styles.item} key={announcement.id}>
                <div className={styles.fields}>
                  <label className={styles.wide}>Title <span className={styles.count}>({announcement.title.length}/{limits.announcementTitle})</span>
                    <input maxLength={limits.announcementTitle} onChange={(event) => update({ title: event.target.value })} value={announcement.title} />
                  </label>
                  <label className={styles.wide}>Text <span className={styles.count}>({announcement.body.length}/{limits.announcementBody})</span>
                    <textarea maxLength={limits.announcementBody} onChange={(event) => update({ body: event.target.value })} rows={3} value={announcement.body} />
                  </label>
                  <label>Link text (optional)
                    <input maxLength={limits.linkLabel} onChange={(event) => update({ linkLabel: event.target.value })} value={announcement.linkLabel ?? ""} />
                  </label>
                  <label>Link address (optional)
                    <input inputMode="url" maxLength={limits.href} onChange={(event) => update({ linkHref: event.target.value })} placeholder="/events or https://…" value={announcement.linkHref ?? ""} />
                  </label>
                  <WindowFields onChange={update} value={announcement} />
                </div>
                <MoveButtons index={index} label={`announcement ${index + 1}`} length={content.announcements.length} onMove={(delta) => patch({ announcements: move(content.announcements, index, delta) })} onRemove={() => patch({ announcements: content.announcements.filter((_, position) => position !== index) })} />
              </div>
            );
          })}
          {content.announcements.length < limits.announcements && (
            <div><button className="secondary-button" onClick={() => patch({ announcements: [...content.announcements, { id: newId(), title: "", body: "" }] })} type="button"><Plus aria-hidden="true" size={16} /> Add an announcement</button></div>
          )}
        </div>
      </section>

      <section aria-labelledby="site-content-sections" className="panel">
        <div className="section-heading"><div><h2 id="site-content-sections">Homepage sections</h2></div></div>
        <p className="field-help" style={{ margin: "4px 0 0" }}>Choose which sections show, their order, and their headings. A blank heading keeps the standard one.</p>
        <div className={styles.stack}>
          {content.sections.map((section, index) => (
            <div className={styles.item} key={section.key}>
              <div className={styles.itemHead}>
                <h3>{defaultSectionHeadings[section.key]}</h3>
                <MoveButtons index={index} label={defaultSectionHeadings[section.key]} length={content.sections.length} onMove={(delta) => patch({ sections: move(content.sections, index, delta) })} />
              </div>
              <p className={styles.note}>{sectionDescriptions[section.key]}</p>
              <div className={styles.fields}>
                <label className={styles.check}>
                  <input checked={section.visible} onChange={(event) => patch({ sections: replaceAt(content.sections, index, { ...section, visible: event.target.checked }) })} type="checkbox" />
                  Show this section
                </label>
                <label>Heading (optional)
                  <input maxLength={limits.heading} onChange={(event) => patch({ sections: replaceAt(content.sections, index, { ...section, heading: event.target.value }) })} placeholder={defaultSectionHeadings[section.key]} value={section.heading ?? ""} />
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="site-content-featured" className="panel">
        <div className="section-heading"><div><h2 id="site-content-featured">Featured events</h2></div></div>
        <p className="field-help" style={{ margin: "4px 0 0" }}>
          Pick up to {homeFeaturedLimit} events for the homepage, in order. Only public, published events show. With none picked, the homepage uses the events marked featured in their settings.
        </p>
        <div className={styles.stack}>
          {featuredIds.length === 0 && <p className={styles.note}>None picked: the homepage uses the events marked featured in their settings.</p>}
          {featuredIds.map((id, index) => {
            const event = eventById.get(id);
            return (
              <div className={styles.item} key={id}>
                <div className={styles.itemHead}>
                  <strong>{index + 1}. {event ? `${event.name} (${event.startsOn})` : "An event that is no longer public or upcoming (it will not show)"}</strong>
                  <MoveButtons index={index} label={event?.name ?? `event ${index + 1}`} length={featuredIds.length} onMove={(delta) => patch({ featuredEventIds: move(featuredIds, index, delta) })} onRemove={() => patch({ featuredEventIds: featuredIds.filter((other) => other !== id) })} />
                </div>
              </div>
            );
          })}
          {featuredIds.length < homeFeaturedLimit && (
            <div className={styles.fields}>
              <label>Add an event
                <select onChange={(event) => setPick(event.target.value)} value={pick}>
                  <option value="">Choose an event…</option>
                  {addableEvents.map((event) => <option key={event.id} value={event.id}>{event.name} ({event.startsOn})</option>)}
                </select>
              </label>
              <div>
                <button className="secondary-button" disabled={!pick} onClick={() => { patch({ featuredEventIds: [...featuredIds, pick] }); setPick(""); }} type="button"><Plus aria-hidden="true" size={16} /> Add to featured</button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="site-content-nav" className="panel">
        <div className="section-heading"><div><h2 id="site-content-nav">Header links</h2></div></div>
        <p className="field-help" style={{ margin: "4px 0 0" }}>Extra links in the header of the public pages, before Sign in. Up to {limits.navLinks}.</p>
        <LinkRows links={content.navLinks} max={limits.navLinks} onChange={(navLinks) => patch({ navLinks })} what="header link" />
      </section>

      <section aria-labelledby="site-content-footer" className="panel">
        <div className="section-heading"><div><h2 id="site-content-footer">Footer</h2></div></div>
        <p className="field-help" style={{ margin: "4px 0 0" }}>The bottom of the homepage. The help phone and email are set in Platform settings and still show.</p>
        <div className={styles.stack}>
          <label>Verse or tagline <span className={styles.count}>({(content.footer.verse ?? "").length}/{limits.verse})</span>
            <input maxLength={limits.verse} onChange={(event) => patch({ footer: { ...content.footer, verse: event.target.value } })} value={content.footer.verse ?? ""} />
          </label>
          <label>Contact lines (one per line, up to {limits.footerContactLines})
            <textarea onChange={(event) => patch({ footer: { ...content.footer, contactLines: event.target.value.split("\n") } })} rows={4} value={content.footer.contactLines.join("\n")} />
          </label>
          <LinkRows links={content.footer.links} max={limits.footerLinks} onChange={(links) => patch({ footer: { ...content.footer, links } })} what="footer link" />
        </div>
      </section>

      <section aria-labelledby="site-content-categories" className="panel">
        <div className="section-heading"><div><h2 id="site-content-categories">Calendar categories</h2></div></div>
        <p className="field-help" style={{ margin: "4px 0 0" }}>
          Shape the Category choices on the events page. Hiding a category only removes the choice: its events stay listed. Names are not case sensitive.
        </p>
        <div className={styles.fields}>
          <label>Show first, in this order (one per line)
            <textarea onChange={(event) => patch({ calendarCategories: { ...content.calendarCategories, order: event.target.value.split("\n") } })} rows={5} value={content.calendarCategories.order.join("\n")} />
          </label>
          <label>Hide from the choices (one per line)
            <textarea onChange={(event) => patch({ calendarCategories: { ...content.calendarCategories, hidden: event.target.value.split("\n") } })} rows={5} value={content.calendarCategories.hidden.join("\n")} />
          </label>
        </div>
      </section>

      <section aria-labelledby="site-content-history" className="panel">
        <div className="section-heading"><div><h2 id="site-content-history">Publish history</h2></div></div>
        {history.length === 0 ? <p className={styles.note}>Nothing has been published yet.</p> : (
          <ul className={styles.history}>
            {history.map((revision) => (
              <li key={revision.id}>
                <span className={styles.historyText}>
                  <strong>{revision.status === "PUBLISHED" ? "Showing now" : "Earlier version"}{revision.restoredFromId ? " (restored)" : ""}</strong>
                  <span>{when(revision.publishedAt ?? revision.createdAt)} by {revision.publishedByName ?? revision.createdByName ?? "someone no longer on the team"}</span>
                  {revision.note && <span>{revision.note}</span>}
                </span>
                {revision.status === "SUPERSEDED" && (
                  <button aria-label={`Restore the version from ${when(revision.publishedAt ?? revision.createdAt)}`} className="secondary-button" disabled={busy} onClick={() => void onRestore(revision)} type="button"><Undo2 aria-hidden="true" size={16} /> Restore this version</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
