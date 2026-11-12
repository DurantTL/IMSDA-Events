import { adminHubs, systemNavGroups, clubsAdminRecordsHref, type AdminHubKey } from "@/components/system-navigation";
import { clubsAdminGroups, clubsAdminHomeItem } from "@/components/staff-navigation";
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

/**
 * The five Admin hubs plus Club administration (#1568), the Clubs Administrator's home. Club administration is not an Admin
 * tab: it reuses the same card definitions, model and component, and lists the Clubs area's destinations.
 */
export type HubKey = AdminHubKey | "club-administration";

export type HubViewer = {
  isSystemAdmin: boolean;
  clubsAdmin: boolean;
  siteContentEditor: boolean;
  /** The health record import exists only while the Health Record feature is on (#1232); left out means off. */
  healthImport?: boolean;
};

export type MetricKey =
  | "upcomingEvents" | "unpublishedEvents" | "copyableEvents" | "archivedEvents" | "calendarPublished" | "calendarUnpublished" | "moduleRequests" | "eventTemplates"
  | "clubs" | "applicationsWaiting" | "lateRecords" | "openTransfers" | "clubLeaders" | "clubInvitesWaiting"
  | "staffLogins" | "invitesWaiting"
  | "formsTotal" | "clubFormsOn" | "informationFormsOpen" | "draftForms" | "formTemplates" | "savedQuestions"
  | "readinessAttention" | "readinessToConfirm" | "readinessUnknown" | "emailProblems" | "pausedAreas" | "honors";

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
  /** What the card says when a number it reads is already a key figure on the page (#1733); without it the chip is dropped. */
  statusBesideFigures?: (read: Reader) => CardStatus | null;
};

/** `note` is a line under the label for a caveat the number alone would hide (checks that could not be read). */
type StatDef = { metric: MetricKey; singular: string; plural: string; gate: HubGate; alsoNeeds?: readonly MetricKey[]; note?: (read: Reader) => string | null };
/** `metric` ties an action to a count of work waiting: the action is a filled button only while that count is above 0 (#1733). */
type ActionDef = {
  href: string;
  label: string;
  gate: HubGate;
  metric?: MetricKey;
  /** A second count that also makes the action primary when above 0. */
  alsoMetric?: MetricKey;
  /** When true, a `metric` that could not be read counts as "needs a look" and keeps the action primary. */
  unreadableIsPrimary?: boolean;
};
type GroupDef = { title: string; cards: readonly CardDef[] };
type HubDef = {
  stats: readonly StatDef[];
  actions: readonly ActionDef[];
  groups: readonly GroupDef[];
  /** A group left with one card (a gate removed the others) joins its neighbour, so no row is ever a lone card. */
  regroupLoneCards?: boolean;
};

const systemItems = new Map(systemNavGroups.flatMap((group) => group.items.map((item) => [item.href, item] as const)));

/** The title and one-line description of a registered destination: the registry's words, never a second copy. */
export function destinationText(href: string): { title: string; description: string } {
  const item = systemItems.get(href);
  if (!item) throw new Error(`No registered destination ${href}.`);
  return { title: item.label, description: item.description };
}

/** The Clubs area's own pages (the Clubs Administrator's registry) that the System registry does not list; their title is the registry's. */
const clubsRegistry = new Map([clubsAdminHomeItem, ...clubsAdminGroups.flatMap((group) => group.items)].map((item) => [item.href, item.label] as const));

function cardTitle(card: CardDef): string {
  if (card.title) return card.title;
  const label = clubsRegistry.get(card.href);
  return systemItems.has(card.href) ? destinationText(card.href).title : label ?? destinationText(card.href).title;
}

function cardDescription(card: CardDef): string {
  return card.description ?? destinationText(card.href).description;
}

const count = (n: number, tone: StatusTone, one: string, many = one): CardStatus => ({ tone, text: `${n} ${n === 1 ? one : many}` });
const waiting = (n: number, noun: string, none: string): CardStatus => (n > 0 ? { tone: "review", text: `${n} ${noun}` } : { tone: "ok", text: none });

export const moduleRequestsHref = "/admin/feature-requests";
export const problemReportsHref = "/admin/problem-reports";

/** Cards both the Clubs hub and Club administration show, defined once. */
const clubCards = {
  clubsAndChurches: { href: "/admin/organizations", gate: hubGates.system, metrics: ["clubs"], status: (read) => count(read("clubs")!, "draft", "active club", "active clubs") },
  summary: { href: "/admin/clubs/summary", gate: hubGates.clubs, metrics: ["lateRecords"], status: lateStatus },
  // One list of who leads a club and who is still invited (#1589). The number beside the leaders is the invites waiting for an answer.
  leaders: {
    href: "/admin/clubs/leaders",
    description: "Current leaders, and invites still waiting: directors and deputies from the club import, and registrars and reporters invited by directors.",
    gate: hubGates.clubs,
    metrics: ["clubLeaders", "clubInvitesWaiting"],
    // The Clubs dashboard draws the waiting-invites number itself, so its card says only how many lead (#1733).
    statusBesideFigures: (read) => {
      const leaders = read("clubLeaders");
      return leaders === null ? UNAVAILABLE_STATUS : count(leaders, "draft", "current leader", "current leaders");
    },
    status: (read) => {
      const leaders = read("clubLeaders")!;
      const invites = read("clubInvitesWaiting")!;
      const text = `${leaders} ${leaders === 1 ? "current leader" : "current leaders"} · ${invites} ${invites === 1 ? "invite" : "invites"} waiting`;
      return { tone: invites > 0 ? "review" : "draft", text };
    },
  },
  records: { href: clubsAdminRecordsHref, gate: hubGates.clubs, metrics: ["lateRecords"], status: lateStatus },
  applications: { href: "/admin/clubs/applications", gate: hubGates.clubs, metrics: ["applicationsWaiting"], status: (read) => waiting(read("applicationsWaiting")!, "waiting", "None waiting") },
  transfers: { href: "/admin/clubs/transfers", gate: hubGates.clubs, metrics: ["openTransfers"], status: (read) => waiting(read("openTransfers")!, "open", "None open") },
  sterling: { href: "/admin/organizations/background-checks", gate: hubGates.clubs },
  honors: { href: "/admin/honors", gate: hubGates.clubs, metrics: ["honors"], status: (read) => count(read("honors")!, "draft", "honor", "honors") },
  supplies: { href: "/admin/club-supplies", gate: hubGates.clubs },
  // The page checks `hasClubsAdministration` (system administrator or an active Clubs Administrator): the same people as `hubGates.clubs`.
  conferenceOrders: {
    href: "/admin/club-supplies/conference-orders",
    title: "Conference club orders",
    description: "Patches and pins clubs have ordered, to fill and bill to their churches.",
    gate: hubGates.clubs,
  },
  clubForms: { href: "/admin/club-forms", gate: hubGates.clubs, metrics: ["clubFormsOn"], status: (read) => count(read("clubFormsOn")!, "ok", "form on", "forms on") },
  publicClubForms: { href: "/admin/club-forms/public-page", gate: hubGates.clubs },
} satisfies Record<string, CardDef>;

const clubStats: readonly StatDef[] = [
  { metric: "clubs", singular: "Active club", plural: "Active clubs", gate: hubGates.clubs },
  { metric: "applicationsWaiting", singular: "Application waiting", plural: "Applications waiting", gate: hubGates.clubs },
  { metric: "lateRecords", singular: "Late Monthly Record", plural: "Late Monthly Records", gate: hubGates.clubs },
  { metric: "openTransfers", singular: "Open member transfer", plural: "Open member transfers", gate: hubGates.clubs },
];

const hubDefs: Record<HubKey, HubDef> = {
  events: {
    stats: [
      { metric: "upcomingEvents", singular: "Upcoming published event", plural: "Upcoming published events", gate: hubGates.system },
      { metric: "unpublishedEvents", singular: "Unpublished upcoming event", plural: "Unpublished upcoming events", gate: hubGates.system },
      { metric: "calendarPublished", singular: "Published upcoming calendar item", plural: "Published upcoming calendar items", gate: hubGates.system },
      { metric: "moduleRequests", singular: "Module request waiting", plural: "Module requests waiting", gate: hubGates.system },
    ],
    actions: [{ href: "/event-setup", label: "Create an event", gate: hubGates.system }],
    groups: [
      {
        title: "Start something",
        cards: [
          { href: "/event-setup", gate: hubGates.system },
          { href: "/event-setup/copy", gate: hubGates.system, metrics: ["copyableEvents"], status: (read) => count(read("copyableEvents")!, "draft", "event to copy", "events to copy") },
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
          // The page sends everyone but a system administrator to "no access", so the card has the system gate.
          {
            href: problemReportsHref,
            title: "Problem reports",
            description: "Problems people sent from the Forms help popup, to mark resolved.",
            gate: hubGates.system,
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
    stats: clubStats,
    actions: [{ href: "/admin/clubs/applications", label: "Review applications", gate: hubGates.clubs, metric: "applicationsWaiting" }],
    groups: [
      // The Youth directory (#1685) is for system administrators and Youth Admins; a Clubs Administrator without that grant never sees the card.
      { title: "Directory", cards: [clubCards.clubsAndChurches, clubCards.summary, clubCards.leaders, { href: "/admin/youth", gate: hubGates.system }] },
      { title: "Records", cards: [clubCards.records] },
      { title: "Changes", cards: [clubCards.applications, clubCards.transfers] },
    ],
  },
  // The Clubs Administrator's home (#1568, #1559 item 6): the same pattern, grouped as the approved mockup. The page keeps its own
  // key numbers, so this definition has none; it adds the one main action and a card for every destination of the Clubs area.
  "club-administration": {
    regroupLoneCards: true,
    stats: [],
    actions: [{ href: "/admin/clubs/applications", label: "Review applications", gate: hubGates.clubs, metric: "applicationsWaiting" }],
    groups: [
      { title: "Clubs", cards: [clubCards.summary, clubCards.clubsAndChurches, clubCards.applications, clubCards.transfers, clubCards.sterling] },
      {
        title: "Records and points",
        cards: [
          clubCards.records,
          { href: "/admin/clubs/reports/year-end", description: "Each club's end-of-year report for the club year.", gate: hubGates.clubs },
          { href: "/admin/clubs/summary?view=points#points", description: "Club points for the year, club by club.", gate: hubGates.clubs },
        ],
      },
      {
        title: "Club events and forms",
        cards: [
          { href: "/admin/clubs/summary?view=events#club-events", description: "Which clubs are registered for each club event.", gate: hubGates.clubs },
          clubCards.clubForms,
          clubCards.publicClubForms,
        ],
      },
      { title: "People", cards: [clubCards.leaders, { href: "/admin/people", gate: hubGates.clubs }] },
      {
        title: "Catalogs and imports",
        cards: [
          clubCards.honors,
          clubCards.supplies,
          clubCards.conferenceOrders,
          { href: "/admin/clubs/import", description: "Add or update clubs from a spreadsheet.", gate: hubGates.clubs },
          { href: "/admin/clubs/health-import", description: "Bring club members' health records in from a file.", gate: (v) => hubGates.clubs(v) && v.healthImport === true },
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
          clubCards.clubForms,
          clubCards.publicClubForms,
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
      {
        metric: "readinessAttention",
        singular: "Readiness check needs attention",
        plural: "Readiness checks need attention",
        gate: hubGates.system,
        alsoNeeds: ["readinessUnknown"],
        note: (read) => {
          const unknown = read("readinessUnknown");
          if (unknown === null) return "Some checks could not be read";
          return unknown > 0 ? `${unknown} ${unknown === 1 ? "check" : "checks"} could not be read` : null;
        },
      },
      { metric: "emailProblems", singular: "Failed or bounced email", plural: "Failed or bounced emails", gate: hubGates.system },
      { metric: "pausedAreas", singular: "Area paused", plural: "Areas paused", gate: hubGates.system },
      { metric: "honors", singular: "Honor in the catalog", plural: "Honors in the catalog", gate: hubGates.clubs },
    ],
    actions: [
      { href: "/admin/readiness", label: "Open System readiness", gate: hubGates.system, metric: "readinessAttention", alsoMetric: "readinessUnknown", unreadableIsPrimary: true },
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
            metrics: ["readinessAttention", "readinessToConfirm", "readinessUnknown"],
            // The tile above already says how many need attention and how many could not be read; the card adds only what it does not.
            statusBesideFigures: (read) => {
              const toConfirm = read("readinessToConfirm");
              // The tile has no "to confirm" figure, so an unreadable one is still said here, never hidden.
              if (toConfirm === null) return UNAVAILABLE_STATUS;
              const attention = read("readinessAttention");
              const unknown = read("readinessUnknown");
              const tileSpeaks = attention === null || attention > 0 || unknown === null || unknown > 0;
              return toConfirm > 0 && !tileSpeaks ? { tone: "soon", text: `${toConfirm} to confirm` } : null;
            },
            status: (read) => {
              const attention = read("readinessAttention")!;
              const toConfirm = read("readinessToConfirm")!;
              const unknown = read("readinessUnknown")!;
              if (attention > 0) return { tone: "warn", text: `${attention} need${attention === 1 ? "s" : ""} attention` };
              // A check that could not be read is never "ready".
              if (unknown > 0) return { tone: "soon", text: `${unknown} could not be read` };
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
          clubCards.honors,
          clubCards.supplies,
          clubCards.conferenceOrders,
          { href: "/admin/master-award-rules", gate: hubGates.system },
          clubCards.sterling,
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

/** The one line under the Club administration page's numbers; the page's own header stays as it was. */
export const clubAdministrationDescription = "Every club destination, with its own live status.";

export type HubStat = { key: MetricKey; value: number | null; label: string; display: string; note: string | null };
export type HubCard = { href: string; title: string; description: string; status: CardStatus | null };
export type HubGroup = { title: string; cards: HubCard[] };
export type HubView = {
  key: HubKey;
  title: string;
  description: string;
  stats: HubStat[];
  /** `primary` is false for a link with nothing waiting behind it: the page then has no filled button. */
  action: { href: string; label: string; primary?: boolean } | null;
  groups: HubGroup[];
};

/**
 * What `AdminHub` draws: the intro line and card groups, with key numbers and a main action only when the page has them.
 * An Admin hub (`HubView`) is one; so is the event's More money tools page (#1575), which has neither.
 */
export type HubBody = {
  key: string;
  description: string;
  stats?: readonly HubStat[];
  action?: { href: string; label: string; primary?: boolean } | null;
  groups: readonly HubGroup[];
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

/**
 * A group of one card (a gate removed the others) joins the smaller neighbouring group, so no row is ever a lone card. The
 * group that takes it keeps its heading; with a single group there is nothing to join and it stays.
 */
export function mergeLoneCards<T>(groups: ReadonlyArray<{ title: string; cards: T[] }>): Array<{ title: string; cards: T[] }> {
  const result = groups.map((group) => ({ title: group.title, cards: [...group.cards] }));
  for (let index = 0; index < result.length; ) {
    if (result[index].cards.length !== 1 || result.length === 1) {
      index += 1;
      continue;
    }
    const before = index > 0 ? result[index - 1] : null;
    const after = index < result.length - 1 ? result[index + 1] : null;
    const target = before && after ? (before.cards.length <= after.cards.length ? before : after) : before ?? after!;
    if (target === after) target.cards.unshift(...result[index].cards);
    else target.cards.push(...result[index].cards);
    result.splice(index, 1);
    index = 0;
  }
  return result;
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
const hubAccess: Record<HubKey, HubGate> = {
  "club-administration": hubGates.clubs,
  events: hubGates.system,
  clubs: hubGates.system,
  people: hubGates.system,
  forms: hubGates.clubs,
  catalogs: (v) => hubGates.clubs(v) || hubGates.siteContent(v),
};

/** Whether the viewer may open the hub and sees at least one card on it. */
export function canOpenHub(hub: HubKey, viewer: HubViewer): boolean {
  return hubAccess[hub](viewer) && visibleCards(hubDefs[hub], viewer).length > 0;
}

function visibleCards(def: HubDef, viewer: HubViewer) {
  return def.groups.flatMap((group) => group.cards.filter((card) => card.gate(viewer)));
}

function visibleStats(def: HubDef, viewer: HubViewer) {
  return def.stats.filter((stat) => stat.gate(viewer));
}

/** The metrics the viewer's hub needs: only those of a shown card or a shown number, so nothing hidden is read. */
export function neededMetrics(hub: HubKey, viewer: HubViewer): MetricKey[] {
  const def = hubDefs[hub];
  const keys = new Set<MetricKey>();
  const action = def.actions.find((candidate) => candidate.gate(viewer));
  if (action?.metric) keys.add(action.metric);
  if (action?.alsoMetric) keys.add(action.alsoMetric);
  for (const card of visibleCards(def, viewer)) for (const key of card.metrics ?? []) keys.add(key);
  for (const stat of visibleStats(def, viewer)) {
    keys.add(stat.metric);
    for (const key of stat.alsoNeeds ?? []) keys.add(key);
  }
  return [...keys];
}

/** A main action is a filled button when it has no count (a create action) or when its count is above 0; otherwise it is a plain link. */
export function hubActionIsPrimary(action: { metric?: MetricKey; alsoMetric?: MetricKey; unreadableIsPrimary?: boolean }, read: Reader): boolean {
  if (!action.metric) return true;
  const value = read(action.metric);
  if (value === null) return action.unreadableIsPrimary === true;
  if (value > 0) return true;
  const other = action.alsoMetric ? read(action.alsoMetric) : null;
  return other !== null && other > 0;
}

/** `shownMetrics` are numbers the page draws itself (Club administration's own figures); their card chips are dropped too. */
export function buildHubView(hub: HubKey, viewer: HubViewer, values: MetricValues, shownMetrics: readonly MetricKey[] = []): HubView {
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
      note: stat.note ? stat.note(reading) : null,
    };
  });
  const action = def.actions.find((candidate) => candidate.gate(viewer)) ?? null;
  // A number shown as a key figure is not repeated as a card chip (#1733).
  const statMetrics = new Set<MetricKey>([...stats.map((stat) => stat.key), ...shownMetrics]);
  let shown = def.groups.flatMap((group): Array<{ title: string; cards: HubCard[] }> => {
    const cards = group.cards.filter((card) => card.gate(viewer)).map((card): HubCard => {
      const needs = card.metrics ?? [];
      let status: CardStatus | null = null;
      const repeatsFigure = needs.some((key) => statMetrics.has(key));
      if (card.status && repeatsFigure) status = card.statusBesideFigures ? card.statusBesideFigures(reading) : null;
      else if (card.status) status = needs.some((key) => reading(key) === null) ? UNAVAILABLE_STATUS : card.status(reading);
      return { href: card.href, title: cardTitle(card), description: cardDescription(card), status };
    });
    return cards.length > 0 ? [{ title: group.title, cards }] : [];
  });
  if (def.regroupLoneCards) shown = mergeLoneCards(shown);
  const groups = shown.flatMap((group) => splitGroup(group));
  return {
    key: hub,
    title: hub === "club-administration" ? clubsAdminHomeItem.label : adminHubs[hub].title,
    description: hub === "club-administration" ? clubAdministrationDescription : adminHubs[hub].description,
    stats,
    action: action ? { href: action.href, label: action.label, primary: hubActionIsPrimary(action, reading) } : null,
    groups,
  };
}

