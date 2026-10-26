import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BellRing,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Archive,
  Map as MapIcon,
  MailCheck,
  RefreshCw,
  MailWarning,
  ShieldCheck,
  TentTree,
  Timer,
  UsersRound,
} from "lucide-react";
import { getCurrentSession } from "@/modules/access/current-session";
import { getSystemAdminDashboard, getSystemHealth } from "@/modules/system-admin/repository";
import { buildHealthSignals, healthPanelNote } from "@/modules/system-admin/health-model";
import { getAdminAttentionSummary } from "@/modules/system-admin/attention-repository";
import { listAlertFeed } from "@/modules/notifications/feed";
import { logError } from "@/lib/logger";
import {
  buildHomeValues,
  buildWorkList,
  commonTaskHrefs,
  groupWorkRows,
  nextEventNote,
  readTimeLabel,
  systemHomeTabs,
} from "@/modules/system-admin/home-model";
import type { SetupWarningKind } from "@/modules/system-admin/dashboard";
import { ActionsMenu } from "@/components/actions-menu";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { registrationStatusLabel } from "@/modules/events/public-registration-status";
import { ModuleRequestQueue } from "@/components/module-request-queue";
import { formatRequestDate } from "@/modules/event-modules/request-domain";
import { listPendingModuleRequests } from "@/modules/event-modules/requests";
import { getReleaseIdentity } from "@/lib/release";
import packageInfo from "@/package.json";
import styles from "./system-admin.module.css";
import { eventFeaturesItem, staffPageTitles } from "@/components/staff-navigation";
import { systemNavGroups } from "@/components/system-navigation";

export const metadata: Metadata = { title: staffPageTitles.systemManagement };

/** Where the build plan lives. The command center shows live state, not the plan. */
const ROADMAP_URL = "https://github.com/DurantTL/imsda-events/issues/98";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function dateRange(start: Date, end: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone,
  }).formatRange(start, end);
}

function countdown(timing: string, daysUntilStart: number | null) {
  if (timing === "IN_PROGRESS") return "Happening now";
  if (daysUntilStart === null) return null;
  if (daysUntilStart <= 1) return "Starts tomorrow";
  return `Starts in ${daysUntilStart} days`;
}

const warningHref: Record<SetupWarningKind, string> = {
  UNPUBLISHED: "/more/event-settings",
  NO_PUBLISHED_FORM: "/registration-builder",
  IMPORT_ISSUES: "/imports",
  IMPORT_WARNINGS: "/imports",
  DELIVERY_ISSUES: "/communications?view=deliveries",
};

function withEvent(href: string, eventQuery: string) {
  return `${href}${href.includes("?") ? "&" : "?"}${eventQuery}`;
}

const healthClass = {
  ok: styles.healthOk,
  warn: styles.healthWarn,
  bad: styles.healthBad,
  unknown: styles.healthUnknown,
};

type Settled<T> = { ok: true; value: T } | { ok: false };

/** Runs one panel's read; a failure is logged (never shown) and becomes "unavailable" for that panel only. */
async function settle<T>(panel: string, read: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await read };
  } catch (error) {
    logError(`System home panel could not load: ${panel}`, error);
    return { ok: false };
  }
}

function Unavailable({ what }: { what: string }) {
  return (
    <p className={styles.unavailable} role="status">
      <CircleAlert aria-hidden="true" size={16} />
      <span><strong>Unavailable.</strong> {what} could not be read just now. This is not zero and not &ldquo;all clear&rdquo;. Reload to try again.</span>
    </p>
  );
}

export default async function SystemAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ unavailable?: string }>;
}) {
  // `resolveEventContext` sends a system administrator here with
  // `?unavailable=1` for an event id that isn't available (#465) — the same
  // wording as the staff picker, so nothing reveals whether it exists.
  const unavailable = (await searchParams).unavailable === "1";
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");

  // Each panel reads on its own (#1182): a failed read leaves that panel "unavailable" and the others keep their data.
  const [dashboardRead, healthRead, requestsRead, attentionRead, feedRead] = await Promise.all([
    settle("events", getSystemAdminDashboard()),
    settle("system health", getSystemHealth()),
    settle("feature requests", listPendingModuleRequests()),
    settle("attention", getAdminAttentionSummary()),
    settle("alert feed", listAlertFeed(user.id)),
  ]);
  const dashboard = dashboardRead.ok ? dashboardRead.value : null;
  const health = healthRead.ok ? healthRead.value : null;
  const moduleRequests = requestsRead.ok ? requestsRead.value : null;
  const attention = attentionRead.ok ? attentionRead.value : null;
  const unreadFeed = feedRead.ok ? feedRead.value.unreadCount : null;
  const currentEvents = dashboard ? dashboard.events.filter((event) => event.timing !== "PAST") : [];
  const pastEvents = dashboard ? dashboard.events.filter((event) => event.timing === "PAST") : [];
  const homeValues = buildHomeValues({
    events: dashboard ? { upcomingEventCount: dashboard.summary.upcomingEventCount, generatedAt: dashboard.generatedAt, nextEventNote: nextEventNote(dashboard.events) } : null,
    attention,
  });
  const work = buildWorkList(attention, moduleRequests ? moduleRequests.length : null);
  const workGroups = groupWorkRows(work.rows);
  const navItems = systemNavGroups.flatMap((group) => group.items);
  // The Archived events destination comes from the shared System navigation, which lists it once.
  const archivedEventsHref = navItems.find((item) => item.label === "Archived events")?.href ?? "/archived-events";
  const commonTasks = commonTaskHrefs.flatMap(({ href, heading, label }) => {
    const item = navItems.find((candidate) => candidate.href === href);
    return item ? [{ heading, item: label ? { ...item, label } : item }] : [];
  });
  const release = getReleaseIdentity();
  // Only the Catalogs and settings group stays as a directory: every other group is a Common tasks group above it.
  const catalogGroups = systemNavGroups.filter((group) => group.key === "system-catalogs");

  const healthReadAt = new Date().toISOString();
  const healthSignals = buildHealthSignals({
    health,
    unresolvedAlertCount: dashboard ? dashboard.summary.unresolvedAlertCount : null,
    attention,
    readAt: healthReadAt,
  });
  const healthNote = healthPanelNote(healthSignals);
  const healthIcons = { "email-sweep": Timer, "email-queue": MailCheck, "open-alerts": BellRing, "email-delivery": MailWarning } as const;

  const directoryReview = attention ? attention.groups.flatMap((group) => group.items).find((item) => item.key === "directory-review") : undefined;
  const directoryReviewCount = !attention || attention.unreadable.includes("directory-review") ? null : directoryReview?.count ?? 0;
  const display = (value: number | null) => (value === null ? "Unavailable" : String(value));

  const updatedAt = readTimeLabel(dashboard ? dashboard.generatedAt : healthReadAt);

  return (
    <section className={`page-stack ${styles.workspace}`}>
      <DashboardTabs label="System administration sections" tabs={systemHomeTabs} currentKey="overview" />
      {unavailable && (
        <div className="inline-notice error" role="status">
          <span>That event isn&rsquo;t available. It may not exist, or this account may not have access to it. Choose an event below to continue.</span>
        </div>
      )}
      <section className={styles.hero} aria-labelledby="system-home-heading">
        <div>
          <span className={styles.adminBadge}><ShieldCheck aria-hidden="true" size={16} /> System administrator</span>
          <p className="eyebrow">All events</p>
          <h2 id="system-home-heading">System administration</h2>
          <p>Everything waiting across every event. Each link opens the page that can change the record; nothing on this page approves or changes anything.</p>
          {updatedAt && <p className={styles.updated} data-testid="updated-stamp">Updated {updatedAt}</p>}
        </div>
        <p className={styles.identity} data-testid="signed-in-identity">
          Signed in as <strong>{user.displayName}</strong>
          <small>{user.email}</small>
        </p>
      </section>

      <section aria-labelledby="summary-heading" className={styles.summarySection}>
        <h2 id="summary-heading" className="sr-only">Summary</h2>
        <div className={styles.metrics} data-testid="home-summary">
          {homeValues.map((item) => {
            const readAt = readTimeLabel(item.readAt);
            return (
              <article key={item.key} data-value-key={item.key} data-unavailable={item.value === null ? "true" : undefined}>
                <span className={styles.metricIcon}>
                  {item.key === "upcoming-events" ? <TentTree aria-hidden="true" size={20} /> : item.key === "failed-email" ? <MailCheck aria-hidden="true" size={20} /> : <UsersRound aria-hidden="true" size={20} />}
                </span>
                <strong>{display(item.value)}</strong>
                <p>{item.label}</p>
                {item.note && <small className={styles.metricNote}>{item.note}</small>}
                <small>{item.value === null ? `${item.unit}: could not be read just now.` : `${item.unit}. ${item.scope}`}{readAt ? ` Read at ${readAt}.` : ""}</small>
                {item.href && <small><Link href={item.href}>{item.linkLabel}</Link></small>}
              </article>
            );
          })}
        </div>
        <section className={styles.totals} aria-labelledby="totals-heading">
          <h3 id="totals-heading">All non-archived events, including past ones</h3>
          {dashboard ? (
            <>
              <ul>
                <li><strong>{dashboard.summary.attendeeCount}</strong> expected attendees</li>
                <li><strong>{dashboard.summary.registrationCount}</strong> active registrations</li>
                <li><strong>{dashboard.summary.operationalIssueCount}</strong> operational exceptions <small>(failed or rejected imports and email delivery issues, plus {dashboard.summary.unresolvedAlertCount} open system alerts, which are platform-wide)</small></li>
              </ul>
              <p><strong>Platform-wide, not per event:</strong> {dashboard.summary.activeUserCount} active staff accounts ({dashboard.summary.pendingUserCount} pending, {dashboard.summary.systemAdminCount} system admins).</p>
            </>
          ) : <Unavailable what="The event totals" />}
        </section>
      </section>

      <section className={`panel ${styles.workPanel}`} id="platform-work" aria-labelledby="platform-work-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">Across all events</p>
            <h2 id="platform-work-heading">Work across the platform</h2>
            <p>Separate workflows, each with its own count and its own reviewers. These are not added together: one record can appear in more than one row, and a row is not a number of people.</p>
          </div>
          {attention && <span>Read at {readTimeLabel(attention.generatedAt)}</span>}
        </div>
        {work.attentionFailed && <Unavailable what="The waiting-work checks (applications, approvals, email and scheduled-email problems)" />}
        {!work.attentionFailed && work.unavailable.length > 0 && (
          <p className={styles.unavailable} role="status">
            <CircleAlert aria-hidden="true" size={16} />
            <span><strong>Unavailable:</strong> {work.unavailable.join(", ")}. A check that is missing here may still have work waiting, so do not read its absence as none.</span>
          </p>
        )}
        {work.truncated && <p className="quiet-copy">Directory review reads only the most recent events, so that list may be longer than shown.</p>}
        {workGroups.map((group) => (
          <section key={group.title} className={styles.workGroup} aria-label={group.title}>
            <h3>{group.title}</h3>
            <ul className={styles.workList}>
              {group.rows.map((row) => (
                <li key={row.key} className={styles.workRow} data-work-key={row.key}>
                  <span className={styles.rowCount}>{row.count === null ? "Unavailable" : `${row.atLeast ? "At least " : ""}${row.count}`}</span>
                  <span className={styles.rowLabel}>
                    {row.label}
                    {row.reviewOnly && <small>Review list only: not counted in the notification badge.</small>}
                  </span>
                  <Link className={styles.rowLink} href={row.href}>{row.linkLabel}<ArrowRight aria-hidden="true" size={14} /></Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!work.attentionFailed && work.unavailable.length === 0 && work.rows.length === 0 && (
          <p className="quiet-copy">Nothing is waiting in the checks above. Directory review, the email queue and the other checks are listed on the health panel and in Notifications.</p>
        )}
        <details className={styles.distinct}>
          <summary>How these numbers differ</summary>
          <p>Each is its own quantity with its own definition. None of them is a total of the others. The notification bell badge adds Notification list items and Unread alerts.</p>
          <dl>
            <div><dt>Operational exceptions</dt><dd>{dashboard ? dashboard.summary.operationalIssueCount : "Unavailable"}: failed or rejected import runs and email delivery issues on all non-archived events, plus open system alerts.</dd></div>
            <div><dt>Notification list items</dt><dd>{attention && attention.unreadable.length === 0 ? attention.total : attention ? `${attention.total} (some checks unavailable)` : "Unavailable"}: the waiting, email and health items above, except feature requests and the review-only directory list.</dd></div>
            <div><dt>Directory entries to review</dt><dd>{directoryReviewCount !== null && attention?.truncated ? `At least ${directoryReviewCount}` : display(directoryReviewCount)}: a review list for recent events, not an alert.</dd></div>
            <div><dt>Unread alerts in your feed</dt><dd>{display(unreadFeed)}: alert-feed items you have not read, shown only to you.</dd></div>
          </dl>
        </details>
      </section>

      <section className="panel module-requests" id="module-requests" aria-labelledby="module-requests-heading">
        <div className={styles.sectionHeading}>
          <div><p className="eyebrow">Event modules</p><h2 id="module-requests-heading" tabIndex={-1}>Feature requests</h2><p>Event admins asking for a feature to be turned on. Approving turns it on for that event; declining needs a reason. Only the buttons in this list decide a request.</p></div>
          <span>{moduleRequests ? `${moduleRequests.length} waiting` : "Unavailable"}</span>
        </div>
        {moduleRequests === null
          ? <Unavailable what="The feature-request list" />
          : moduleRequests.length === 0
            ? <p className="quiet-copy">No requests are waiting.</p>
            : <ModuleRequestQueue requests={moduleRequests.map((request) => ({
                id: request.id,
                eventId: request.eventId,
                eventName: request.eventName,
                moduleTitle: request.moduleTitle,
                requesterName: request.requesterName,
                reason: request.reason,
                createdLabel: formatRequestDate(request.createdAt),
              }))} />}
      </section>

      <section className={styles.primaryColumn} id="upcoming-events" aria-labelledby="upcoming-events-heading">
        <div className={styles.sectionHeading}>
          <div><p className="eyebrow">Not archived, not ended</p><h2 id="upcoming-events-heading">Upcoming events</h2><p>Events in progress or still to come, from all non-archived events. Open the event workspace that owns the underlying record.</p></div>
          <span>{dashboard ? `${currentEvents.length} upcoming` : "Unavailable"}</span>
        </div>

        {!dashboard && <Unavailable what="The event list" />}
        <div className={styles.eventList}>
          {currentEvents.map((event) => {
            const query = `event=${encodeURIComponent(event.id)}`;
            const when = countdown(event.timing, event.daysUntilStart);
            return (
              <article className={styles.eventCard} key={event.id}>
                <div className={styles.eventMain}>
                  <div className={styles.eventTitle}>
                    <span className={styles.eventBadges}>
                      <span className={`${styles.phase} ${event.registrationPhase === "OPEN" && event.publishedFormCount > 0 ? styles.phaseOpen : ""}`}>{registrationStatusLabel(event.registrationPhase, event.publishedFormCount > 0)}</span>
                      {when && <span className={styles.countdown}>{when}</span>}
                    </span>
                    <h3>{event.name}</h3>
                    <p>{dateRange(event.startsAt, event.endsAt, event.timezone)} · {event.location ?? "Location pending"}</p>
                  </div>
                  <div className={styles.eventButtons}>
                    <Link className={`primary-button ${styles.openEvent}`} href={`/overview?${query}`}>Open event <ArrowRight aria-hidden="true" size={15} /></Link>
                    <ActionsMenu label="Event links" ariaLabel={`Event links for ${event.name}`}>
                      <li><Link href={`/registration-builder?${query}`}>Form</Link></li>
                      <li><Link href={withEvent(eventFeaturesItem.href, query)}>Features</Link></li>
                      <li><Link href={`/finance/square-payments?${query}`}>Square matching</Link></li>
                      <li><Link href={`/more/promo-codes?${query}`}>Promo codes</Link></li>
                      <li><Link href={`/staff?${query}`}>Team</Link></li>
                      <li><Link href={`/more/health?${query}`}>Health</Link></li>
                      <li><Link href={`/more/event-settings?${query}`}>Settings</Link></li>
                    </ActionsMenu>
                  </div>
                </div>

                <div className={styles.eventStats}>
                  <span><strong>{event.activeRegistrationCount}</strong><small>Registrations</small></span>
                  <span><strong>{event.attendeeCount}</strong><small>Attendees</small></span>
                  <span><strong>{event.checkedInCount}</strong><small>Checked in</small></span>
                  <span><strong>{event.waitingCount}</strong><small>Waitlisted</small></span>
                  <span>
                    <Link href={`/finance?${query}`} title="Money still owed on active registrations">
                      <strong>{money(event.ledgerBalanceCents)}</strong><small>Outstanding balance</small>
                    </Link>
                  </span>
                </div>

                <div className={styles.eventWarnings}>
                  {event.setupWarnings.length === 0
                    ? <span className={styles.ready}><CheckCircle2 aria-hidden="true" size={14} /> No setup or delivery exceptions detected</span>
                    : event.setupWarnings.map((warning) => (
                      <Link
                        className={warning.exception ? styles.exception : undefined}
                        href={withEvent(warningHref[warning.kind], query)}
                        key={warning.kind}
                      >
                        <CircleAlert aria-hidden="true" size={14} /> {warning.label}
                      </Link>
                    ))}
                </div>
              </article>
            );
          })}
          {dashboard && currentEvents.length === 0 && (
            <div className={styles.emptyState} data-testid="starter-state">
              <CalendarPlus aria-hidden="true" size={24} />
              <strong>No upcoming events</strong>
              <p>Start by creating an event, or copy a past one. This page does not show email, payment or readiness as set up: check Email, Platform settings and System readiness for that.</p>
              <p className={styles.starterLinks}>
                <Link className="primary-button" href="/event-setup">Create event</Link>
                <Link href="/event-setup/copy">Copy a past event</Link>
                <Link href="/admin/form-templates">Form templates</Link>
              </p>
            </div>
          )}
        </div>

        {dashboard && (
          <div className={styles.allEvents}>
            <Link href={archivedEventsHref}><Archive aria-hidden="true" size={14} /> Archived events</Link>
            {pastEvents.length > 0 && (
              <details className={styles.pastEvents}>
                <summary>{pastEvents.length} past {pastEvents.length === 1 ? "event" : "events"} (not archived)</summary>
                <div>
                  {pastEvents.map((event) => (
                    <Link href={`/overview?event=${encodeURIComponent(event.id)}`} key={event.id}>
                      <span><strong>{event.name}</strong><small>{dateRange(event.startsAt, event.endsAt, event.timezone)}</small></span>
                      <ArrowRight aria-hidden="true" size={15} />
                    </Link>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      <section className={`panel ${styles.commonTasks}`} aria-labelledby="common-tasks-heading" data-testid="common-tasks">
        <div className={styles.sectionHeading}>
          <div><p className="eyebrow">Common tasks</p><h2 id="common-tasks-heading">Set up and manage</h2></div>
        </div>
        <div className={styles.commonGrid}>
          {[...new Set(commonTasks.map((task) => task.heading))].map((heading) => (
            <div key={heading}>
              <h3>{heading}</h3>
              <ul>
                {commonTasks.filter((task) => task.heading === heading).map(({ item }) => (
                  <li key={item.href}><Link href={item.href}>{item.label}</Link><small>{item.description}</small></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.health} id="system-health" aria-labelledby="system-health-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">Live</p>
            <h2 id="system-health-heading">System health</h2>
            <p>Only what was measured: each signal says what was checked, when, and what it found. A reading that could not be made is shown as unavailable, never as healthy or zero.</p>
          </div>
          <Link className={styles.fullReport} href="/admin/email">Full health report <ArrowRight aria-hidden="true" size={14} /></Link>
        </div>
        {!health && <Unavailable what="System health" />}
        {healthNote && <p className={styles.healthNote} role="status" data-testid="health-note">{healthNote}</p>}
        <div className={styles.healthGrid} data-testid="health-signals">
          {healthSignals.map(({ key, name, checked, state, label, detail, freshness, when, items }) => {
            const Icon = healthIcons[key];
            return (
              <article key={key} data-signal={key} data-freshness={freshness}>
                <div className={styles.healthHead}>
                  <span className={styles.moduleIcon}><Icon aria-hidden="true" size={18} /></span>
                  <strong>{name}</strong>
                  <em className={healthClass[state]}>{label}</em>
                </div>
                <dl className={styles.healthFacts}>
                  <div><dt>Checked</dt><dd>{checked}</dd></div>
                  <div><dt>Result</dt><dd>{detail}</dd></div>
                  <div><dt>When</dt><dd>{when}</dd></div>
                </dl>
                {items && (
                  <ul className={styles.alertList}>
                    {items.map((summary, index) => <li key={`${index}-${summary}`}>{summary}</li>)}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
        <p className={styles.healthScope}>
          This is live health only. The implemented Sterling Volunteers check-in rules, go-live sign-offs and any setup still to do are on{" "}
          <Link href="/admin/readiness">System readiness</Link>. Ticks there are records of what a person did; they are not health readings.
        </p>
      </section>

      <nav className={styles.tasks} aria-label="Catalogs and settings">
        {catalogGroups.map((group) => {
          const cards = group.items.map(({ href, label, description, icon: Icon }) => (
            <Link className={styles.taskCard} href={href} key={href}>
              <span className={styles.taskIcon}><Icon aria-hidden="true" size={18} /></span>
              <span className={styles.taskText}><strong>{label}</strong><small>{description}</small></span>
            </Link>
          ));
          // The grid is sized to the group's tile count so a short group never strands one tile (see the stylesheet).
          const grid = <div className={styles.taskGrid} data-count={group.items.length}>{cards}</div>;
          // Catalogs and settings start closed; a disclosure needs no script, so it also works before hydration.
          return group.collapsedByDefault ? (
            <details className={styles.taskGroup} key={group.key} data-testid={`task-group-${group.key}`}>
              <summary><h2>{group.label}</h2><ChevronDown aria-hidden="true" size={16} /></summary>
              {grid}
            </details>
          ) : (
            <section className={styles.taskGroup} key={group.key} aria-labelledby={`task-group-${group.key}`} data-testid={`task-group-${group.key}`}>
              <h2 id={`task-group-${group.key}`}>{group.label}</h2>
              {grid}
            </section>
          );
        })}
      </nav>

      <div className={styles.footerCards}>
        <section className={styles.scope}>
          <MapIcon aria-hidden="true" size={20} />
          <div>
            <strong>Build roadmap</strong>
            <p>
              What is being built next, and in what order, is kept in{" "}
              <a href={ROADMAP_URL} rel="noreferrer" target="_blank">GitHub issue #98</a>.
              This page only shows what is live.
            </p>
          </div>
        </section>

        <section className={styles.scope}>
          <RefreshCw aria-hidden="true" size={20} />
          <div>
            <strong>System version</strong>
            <p>
              App v{packageInfo.version}
              {release.sha ? ` · release ${release.sha.slice(0, 7)}` : " · release commit unknown"}
              {release.buildId ? ` · build ${release.buildId}` : ""}
            </p>
            <p>Changes when this deployment last changed. Compare after a deploy to confirm it took.</p>
          </div>
        </section>
      </div>
    </section>
  );
}
