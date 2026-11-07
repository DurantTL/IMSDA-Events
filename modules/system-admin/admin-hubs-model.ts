import { adminHubs, systemNavGroups, clubsAdminRecordsHref, type AdminHubKey } from "@/components/system-navigation";
import { pluralize } from "@/lib/pluralize";

/**
 * The five Admin hub pages (#1569): pure model, no database access and no authorization of its own beyond the gates it
 * is handed. A hub shows a few key numbers, one main action, then a card for each destination with a live status.
 *
 * Rules the model keeps:
 * - A card is shown only when the viewer can open the page it links to (`gate`), and the data for a card or a number is
 *   only asked for when that card or number is shown (`neededMetrics`).
 * - A value that could not be read is `null` and shows as "Unavailable". It is never turned into a zero, "None" or "All ready".
 * - A value that was not asked for is absent (`undefined`) and is treated the same way as unreadable, so a card can never
 *   claim health from data nobody read.
 * - Every card and the main action are links only. Nothing here approves, publishes, sends or changes a record.
 */
export type { AdminHubKey };

export type HubViewer = { isSystemAdmin: boolean; clubsAdmin: boolean; siteContentEditor: boolean };

export type MetricKey =
  | "upcomingEvents" | "unpublishedEvents" | "pastEvents" | "archivedEvents" | "calendarThisMonth" | "calendarUnpublished" | "moduleRequests" | "eventTemplates"
  | "clubs" | "applicationsWaiting" | "lateRecords" | "openTransfers" | "clubLeaders"
  | "staffLogins" | "invitesWaiting"
  | "formsTotal" | "clubFormsOn" | "informationFormsOpen" | "draftForms" | "formTemplates" | "savedQuestions"
  | "readinessAttention" | "readinessToConfirm" | "emailProblems" | "pausedAreas" | "honors";

/** `null` is "could not be read"; a missing key is "not asked for". */
export type MetricValues = Partial<Record<MetricKey, number | null>>;

export type HubGate = (viewer: HubViewer) => boolean;
export const hubGates = {
  system: ((v) => v.isSystemAdmin) as HubGate,
  clubs: ((v) => v.isSystemAdmin || v.clubsAdmin) as HubGate,
  siteContent: ((v) => v.isSystemAdmin || v.siteContentEditor) as HubGate,
};

export type StatusTone = "ok" | "warn" | "review" | "soon" | "draft";
export type CardStatus = { tone: StatusTone; text: string };

export const UNAVAILABLE_STATUS: CardStatus = { tone: "draft", text: "Unavailable" };

type Reader = (key: MetricKey) => number | null;

type CardDef = {
  href: string;
  title?: string;
  description?: string;
  gate: HubGate;
  metrics?: readonly MetricKey[];
  status?: (read: Reader) => CardStatus | null;
};

type StatDef = { metric: MetricKey; singular: string; plural: string; gate: HubGate };
type ActionDef = { href: string; label: string; gate: HubGate };
type GroupDef = { title: string; cards: readonly CardDef[] };
type HubDef = { stats: readonly StatDef[]; actions: readonly ActionDef[]; groups: readonly GroupDef[] };

const systemItems = new Map(systemNavGroups.flatMap((group) => group.items.map((item) => [item.href, item] as const)));

/** The title and one-line description of a registered destination: the registry's words, never a second copy. */
export function destinationText(href: string): { title: string; description: string } {
  const item = systemItems.get(href);
  if (!item) throw new Error(`No registered destination ${href}.`);
  return { title: item.label, description: item.description };
}

const count = (n: number, tone: StatusTone, one: string, many = one): CardStatus => ({ tone, text: `${n} ${n === 1 ? one : many}` });
const waiting = (n: number, noun: string, none: string): CardStatus => (n > 0 ? { tone: "review", text: `${n} ${noun}` } : { tone: "ok", text: none });

export const moduleRequestsHref = "/admin/feature-requests";

const hubDefs: Record<AdminHubKey, HubDef> = {
  events: {
    stats: [
      { metric: "upcomingEvents", singular: "Upcoming published event", plural: "Upcoming published events", gate: hubGates.system },
      { metric: "unpublishedEvents", singular: "Unpublished upcoming event", plural: "Unpublished upcoming events", gate: hubGates.system },
      { metric: "calendarThisMonth", singular: "Calendar item this month", plural: "Calendar items this month", gate: hubGates.system },
      { metric: "moduleRequests", singular: "Module request waiting", plural: "Module requests waiting", gate: hubGates.system },
    ],
    actions: [{ href: "/event-setup", label: "Create an event", gate: hubGates.system }],
    groups: [
      {
        title: "Start something",
        cards: [
          { href: "/event-setup", gate: hubGates.system },
          { href: "/event-setup/copy", gate: hubGates.system, metrics: ["pastEvents"], status: (read) => count(read("pastEvents")!, "draft", "past event", "past events") },
        ],
      },
      {
        title: "Plan and publish",
        cards: [
          {
            href: "/admin/calendar",
            gate: hubGates.system,
            metrics: ["calendarUnpublished"],
            status: (read) => {
              const n = read("calendarUnpublished")!;
              return n > 0 ? { tone: "warn", text: `${n} ${n === 1 ? "item" : "items"} unpublished` } : { tone: "ok", text: "All published" };
            },
          },
          {
            href: moduleRequestsHref,
            title: "Event module requests",
            description: "Event staff asking for an event module to be turned on.",
            gate: hubGates.system,
            metrics: ["moduleRequests"],
            status: (read) => waiting(read("moduleRequests")!, "to review", "None waiting"),
          },
        ],
      },
      {
        title: "Library",
        cards: [
          { href: "/admin/event-templates", gate: hubGates.system, metrics: ["eventTemplates"], status: (read) => count(read("eventTemplates")!, "draft", "template", "templates") },
          { href: "/archived-events", gate: hubGates.system, metrics: ["archivedEvents"], status: (read) => count(read("archivedEvents")!, "draft", "archived event", "archived events") },
        ],
      },
    ],
  },
  clubs: {
    stats: [
      { metric: "clubs", singular: "Active club", plural: "Active clubs", gate: hubGates.clubs },
      { metric: "applicationsWaiting", singular: "Application waiting", plural: "Applications waiting", gate: hubGates.clubs },
      { metric: "lateRecords", singular: "Late Monthly Record", plural: "Late Monthly Records", gate: hubGates.clubs },
      { metric: "openTransfers", singular: "Open member transfer", plural: "Open member transfers", gate: hubGates.clubs },
    ],
    actions: [{ href: "/admin/clubs/applications", label: "Review applications", gate: hubGates.clubs }],
    groups: [
      {
        title: "Directory",
        cards: [
          { href: "/admin/organizations", gate: hubGates.system, metrics: ["clubs"], status: (read) => count(read("clubs")!, "draft", "active club", "active clubs") },
          { href: "/admin/clubs/summary", gate: hubGates.clubs, metrics: ["lateRecords"], status: lateStatus },
          { href: "/admin/clubs/leaders", gate: hubGates.clubs, metrics: ["clubLeaders"], status: (read) => count(read("clubLeaders")!, "draft", "current leader", "current leaders") },
        ],
      },
      { title: "Records", cards: [{ href: clubsAdminRecordsHref, gate: hubGates.clubs, metrics: ["lateRecords"], status: lateStatus }] },
      {
        title: "Changes",
        cards: [
          { href: "/admin/clubs/applications", gate: hubGates.clubs, metrics: ["applicationsWaiting"], status: (read) => waiting(read("applicationsWaiting")!, "waiting", "None waiting") },
          { href: "/admin/clubs/transfers", gate: hubGates.clubs, metrics: ["openTransfers"], status: (read) => waiting(read("openTransfers")!, "open", "None open") },
        ],
      },
    ],
  },
  people: {
    stats: [
      { metric: "staffLogins", singular: "Active staff login", plural: "Active staff logins", gate: hubGates.system },
      { metric: "invitesWaiting", singular: "Invite waiting", plural: "Invites waiting", gate: hubGates.system },
    ],
    actions: [{ href: "/admin/people", label: "Invite someone", gate: hubGates.system }],
    groups: [
      {
        title: "Access",
        cards: [{ href: "/admin/people", gate: hubGates.system, metrics: ["invitesWaiting"], status: (read) => waiting(read("invitesWaiting")!, `${pluralize(read("invitesWaiting")!, "invite")} waiting`, "No invites waiting") }],
      },
      // No number for sealed health records: reading break-glass and legal-hold records needs the health privacy acknowledgment that page asks for.
      { title: "Health records", cards: [{ href: "/admin/health-access", gate: hubGates.system }] },
    ],
  },
  forms: {
    stats: [
      { metric: "formsTotal", singular: "Form", plural: "Forms", gate: hubGates.system },
      { metric: "clubFormsOn", singular: "Club form on", plural: "Club forms on", gate: (v) => !v.isSystemAdmin && v.clubsAdmin },
      { metric: "draftForms", singular: "Event form draft", plural: "Event form drafts", gate: hubGates.system },
      { metric: "formTemplates", singular: "Form template", plural: "Form templates", gate: hubGates.system },
      { metric: "savedQuestions", singular: "Saved question", plural: "Saved questions", gate: hubGates.system },
    ],
    actions: [
      { href: "/admin/forms", label: "See all forms", gate: hubGates.system },
      { href: "/admin/club-forms", label: "Open club forms", gate: hubGates.clubs },
    ],
    groups: [
      {
        title: "All forms",
        cards: [
          { href: "/admin/forms", gate: hubGates.system, metrics: ["formsTotal"], status: (read) => count(read("formsTotal")!, "draft", "form", "forms") },
          { href: "/admin/information-forms", gate: hubGates.system, metrics: ["informationFormsOpen"], status: (read) => count(read("informationFormsOpen")!, "ok", "open", "open") },
        ],
      },
      {
        title: "Club forms",
        cards: [
          { href: "/admin/club-forms", gate: hubGates.clubs, metrics: ["clubFormsOn"], status: (read) => count(read("clubFormsOn")!, "ok", "form on", "forms on") },
          { href: "/admin/club-forms/public-page", gate: hubGates.clubs },
        ],
      },
      {
        title: "Building blocks",
        cards: [
          { href: "/admin/form-templates", gate: hubGates.system, metrics: ["formTemplates"], status: (read) => count(read("formTemplates")!, "draft", "template", "templates") },
          { href: "/admin/question-library", gate: hubGates.system, metrics: ["savedQuestions"], status: (read) => count(read("savedQuestions")!, "draft", "saved question", "saved questions") },
        ],
      },
    ],
  },
  catalogs: {
    stats: [
      { metric: "readinessAttention", singular: "Readiness check needs attention", plural: "Readiness checks need attention", gate: hubGates.system },
      { metric: "emailProblems", singular: "Failed or bounced email", plural: "Failed or bounced emails", gate: hubGates.system },
      { metric: "pausedAreas", singular: "Area paused", plural: "Areas paused", gate: hubGates.system },
      { metric: "honors", singular: "Honor in the catalog", plural: "Honors in the catalog", gate: hubGates.clubs },
    ],
    actions: [
      { href: "/admin/readiness", label: "Open System readiness", gate: hubGates.system },
      { href: "/admin/honors", label: "Open the Honor catalog", gate: hubGates.clubs },
      { href: "/admin/site-content", label: "Edit homepage & site content", gate: hubGates.siteContent },
    ],
    groups: [
      {
        title: "System health",
        cards: [
          {
            href: "/admin/readiness",
            gate: hubGates.system,
            metrics: ["readinessAttention", "readinessToConfirm"],
            status: (read) => {
              const attention = read("readinessAttention")!;
              const toConfirm = read("readinessToConfirm")!;
              if (attention > 0) return { tone: "warn", text: `${attention} need${attention === 1 ? "s" : ""} attention` };
              return toConfirm > 0 ? { tone: "soon", text: `${toConfirm} to confirm` } : { tone: "ok", text: "All ready" };
            },
          },
          { href: "/admin/system-report", gate: hubGates.system },
          {
            href: "/admin/pauses",
            gate: hubGates.system,
            metrics: ["pausedAreas"],
            status: (read) => (read("pausedAreas")! > 0 ? { tone: "warn", text: `${read("pausedAreas")} paused` } : { tone: "ok", text: "Nothing paused" }),
          },
        ],
      },
      {
        title: "Website and email",
        cards: [
          { href: "/admin/site-content", gate: hubGates.siteContent },
          {
            href: "/admin/email",
            gate: hubGates.system,
            metrics: ["emailProblems"],
            status: (read) => (read("emailProblems")! > 0 ? { tone: "warn", text: `${read("emailProblems")} failed or bounced` } : { tone: "ok", text: "None failed or bounced" }),
          },
          { href: "/admin/analytics", gate: hubGates.system },
        ],
      },
      {
        title: "Catalogs",
        cards: [
          { href: "/admin/honors", gate: hubGates.clubs, metrics: ["honors"], status: (read) => count(read("honors")!, "draft", "honor", "honors") },
          { href: "/admin/club-supplies", gate: hubGates.clubs },
          { href: "/admin/master-award-rules", gate: hubGates.system },
          { href: "/admin/organizations/background-checks", gate: hubGates.clubs },
        ],
      },
      { title: "Settings", cards: [{ href: "/admin/settings", gate: hubGates.system }] },
    ],
  },
};

function lateStatus(read: Reader): CardStatus {
  const n = read("lateRecords")!;
  return n > 0 ? { tone: "warn", text: `${n} late` } : { tone: "ok", text: "None late" };
}

export type HubStat = { key: MetricKey; value: number | null; label: string; display: string };
export type HubCard = { href: string; title: string; description: string; status: CardStatus | null };
export type HubGroup = { title: string; cards: HubCard[] };
export type HubView = {
  key: AdminHubKey;
  title: string;
  description: string;
  stats: HubStat[];
  action: { href: string; label: string } | null;
  groups: HubGroup[];
};

/** The largest group drawn as one grid; a bigger one is split in two so no row is ever a lone card. */
export const MAX_GROUP_CARDS = 6;

/** A group of more than six cards becomes two groups of near-equal size; the second keeps the heading. */
export function splitGroup<T>(group: { title: string; cards: readonly T[] }): Array<{ title: string; cards: T[] }> {
  if (group.cards.length <= MAX_GROUP_CARDS) return [{ title: group.title, cards: [...group.cards] }];
  const first = Math.ceil(group.cards.length / 2);
  return [
    { title: group.title, cards: group.cards.slice(0, first) },
    { title: `${group.title} (more)`, cards: group.cards.slice(first) },
  ];
}

/** Cards per row at desktop width for a group of `size` cards: 1, 2, 3 or 4 across, and 5 is 3 + 2, 6 is 3 + 3. */
export function cardRowSizes(size: number): number[] {
  if (size <= 0) return [];
  if (size <= 4) return [size];
  if (size === 5) return [3, 2];
  if (size === 6) return [3, 3];
  const rows: number[] = [];
  let left = size;
  while (left > 0) {
    const row = left === 4 ? 4 : left === 5 ? 3 : Math.min(3, left);
    rows.push(row);
    left -= row;
  }
  return rows;
}

/** Who may open each hub page: the same people the Admin tab is shown to (`areaTabSpecs.admin`). */
const hubAccess: Record<AdminHubKey, HubGate> = {
  events: hubGates.system,
  clubs: hubGates.system,
  people: hubGates.system,
  forms: hubGates.clubs,
  catalogs: (v) => hubGates.clubs(v) || hubGates.siteContent(v),
};

/** Whether the viewer may open the hub and sees at least one card on it. */
export function canOpenHub(hub: AdminHubKey, viewer: HubViewer): boolean {
  return hubAccess[hub](viewer) && visibleCards(hubDefs[hub], viewer).length > 0;
}

function visibleCards(def: HubDef, viewer: HubViewer) {
  return def.groups.flatMap((group) => group.cards.filter((card) => card.gate(viewer)));
}

function visibleStats(def: HubDef, viewer: HubViewer) {
  return def.stats.filter((stat) => stat.gate(viewer));
}

/** The metrics the viewer's hub needs: only those of a shown card or a shown number, so nothing hidden is read. */
export function neededMetrics(hub: AdminHubKey, viewer: HubViewer): MetricKey[] {
  const def = hubDefs[hub];
  const keys = new Set<MetricKey>();
  for (const card of visibleCards(def, viewer)) for (const key of card.metrics ?? []) keys.add(key);
  for (const stat of visibleStats(def, viewer)) keys.add(stat.metric);
  return [...keys];
}

export function buildHubView(hub: AdminHubKey, viewer: HubViewer, values: MetricValues): HubView {
  const def = hubDefs[hub];
  const reading = (key: MetricKey): number | null => {
    const value = values[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const stats = visibleStats(def, viewer).map((stat): HubStat => {
    const value = reading(stat.metric);
    return {
      key: stat.metric,
      value,
      label: value === 1 ? stat.singular : stat.plural,
      display: value === null ? "Unavailable" : value.toLocaleString("en-US"),
    };
  });
  const action = def.actions.find((candidate) => candidate.gate(viewer)) ?? null;
  const groups = def.groups.flatMap((group): HubGroup[] => {
    const cards = group.cards.filter((card) => card.gate(viewer)).map((card): HubCard => {
      const needs = card.metrics ?? [];
      const text = card.href === moduleRequestsHref ? null : destinationText(card.href);
      let status: CardStatus | null = null;
      if (card.status) status = needs.some((key) => reading(key) === null) ? UNAVAILABLE_STATUS : card.status(reading);
      return {
        href: card.href,
        title: card.title ?? text!.title,
        description: card.description ?? text!.description,
        status,
      };
    });
    return cards.length > 0 ? splitGroup({ title: group.title, cards }) : [];
  });
  return {
    key: hub,
    title: adminHubs[hub].title,
    description: adminHubs[hub].description,
    stats,
    action: action ? { href: action.href, label: action.label } : null,
    groups,
  };
}

